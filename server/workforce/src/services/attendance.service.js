'use strict';
const knex = require('../db');
const config = require('../config');
const { policyFor, scheduleResolver } = require('./policy.service');
const engine = require('./attendance-engine');
const { eachDate, todayInTz, zonedParts, addDays } = require('../utils/time');
const { uuid } = require('../utils/crypto');

/** Load everything needed to compute an employee's days in [start, end]. */
async function loadContext(employeeId, start, end, db = knex) {
  const employee = await db('employees').where({ id: employeeId }).first();
  if (!employee) throw new Error(`Employee ${employeeId} not found`);
  const policy = await policyFor(end, db);
  const schedule = await scheduleResolver(employee, db);
  const holidaysRows = await db('holidays').whereBetween('holiday_date', [start, end]);
  const holidays = new Map(holidaysRows.map((h) => [h.holiday_date, h]));
  const sessions = await db('attendance_sessions')
    .where({ employee_id: employeeId })
    .whereBetween('business_date', [start, end])
    .orderBy('check_in_at');
  const ids = sessions.map((s) => s.session_id);
  const logs = ids.length ? await db('network_disconnect_logs').whereIn('session_id', ids) : [];
  for (const s of sessions) s.logs = logs.filter((l) => l.session_id === s.session_id);
  const leaves = await db('leave_requests')
    .where({ employee_id: employeeId })
    .whereIn('status', ['Approved', 'Pending', 'Rejected'])
    .where('start_date', '<=', end).where('end_date', '>=', start)
    .orderBy('id', 'desc');
  const corrections = await db('attendance_corrections')
    .where({ employee_id: employeeId })
    .whereBetween('attendance_date', [start, end])
    .whereIn('status', ['Approved', 'Pending'])
    .orderBy([{ column: 'decided_at', order: 'desc' }, { column: 'id', order: 'desc' }]);
  const approvedCorrections = new Map();
  const pendingCorrections = new Map();
  for (const c of corrections) {
    if (c.status === 'Approved' && !approvedCorrections.has(c.attendance_date)) approvedCorrections.set(c.attendance_date, c);
    if (c.status === 'Pending') pendingCorrections.set(c.attendance_date, c);
  }
  return { employee, policy, schedule, holidays, sessions, leaves, approvedCorrections, pendingCorrections };
}

/**
 * Recompute official attendance for an employee over [start, end] and upsert
 * attendance_records (one row per day). Manager review flags are preserved
 * unless the lateness itself changed.
 */
async function recomputeRange(employeeId, start, end, db = knex) {
  const ctx = await loadContext(employeeId, start, end, db);
  const tz = ctx.policy.timezone || config.businessTimezone;
  const days = engine.computeDays({
    employee: ctx.employee,
    dates: eachDate(start, end),
    today: todayInTz(tz),
    nowMs: Date.now(),
    tz,
    policy: ctx.policy,
    schedule: ctx.schedule,
    holidays: ctx.holidays,
    sessions: ctx.sessions,
    leaves: ctx.leaves,
    approvedCorrections: ctx.approvedCorrections,
    pendingCorrections: ctx.pendingCorrections,
  });

  const existing = await db('attendance_records').where({ employee_id: employeeId }).whereBetween('attendance_date', [start, end]);
  const prev = new Map(existing.map((r) => [r.attendance_date, r]));
  const now = new Date();
  const rows = days.map((d) => {
    const old = prev.get(d.attendance_date);
    const keepReview = old && old.reviewed && old.late_minutes === d.late_minutes && old.status === d.status;
    d.reviewed = !!keepReview;
    d.review_note = keepReview ? old.review_note : null;
    return {
      employee_id: employeeId,
      attendance_date: d.attendance_date,
      shift_id: d.shift_id,
      scheduled_start: d.scheduled_start,
      scheduled_end: d.scheduled_end,
      actual_check_in: d.actual_check_in,
      actual_check_out: d.actual_check_out,
      worked_seconds: d.worked_seconds,
      away_seconds: d.away_seconds,
      late_minutes: d.late_minutes,
      early_departure_minutes: d.early_departure_minutes,
      status: d.status,
      leave_request_id: d.leave_request_id,
      leave_fraction: d.leave_fraction,
      is_overridden: d.is_overridden,
      correction_id: d.correction_id,
      correction_reason: d.correction_reason,
      source: d.source,
      reviewed: d.reviewed,
      review_note: d.review_note,
      reviewed_by: keepReview ? old.reviewed_by : null,
      reviewed_at: keepReview ? old.reviewed_at : null,
      computed_at: now,
      updated_at: now,
    };
  });
  if (rows.length) {
    await db('attendance_records').insert(rows).onConflict(['employee_id', 'attendance_date']).merge();
  }
  return { days, policy: ctx.policy, employee: ctx.employee, pendingCorrections: [...ctx.pendingCorrections.values()] };
}

/** Shift date a check-in belongs to (handles overnight shifts). */
async function businessDateFor(employee, instant, db = knex) {
  const policy = await policyFor(zonedParts(instant, config.businessTimezone).date, db);
  const tz = policy.timezone;
  if (!employee) return zonedParts(instant, tz).date;
  const schedule = await scheduleResolver(employee, db);
  const { weekdayOf } = require('../utils/time');
  return engine.businessDateFor(instant, tz, (d) => schedule(d, weekdayOf(d)).shift);
}

/**
 * Login / check-in. Reuses an open session of the same business date (Flutter
 * "alreadyCheckedIn"). An open session from an earlier date is closed as
 * "missing check-out" (kept for correction) and a new session is started.
 * The partial unique index guarantees there is never more than one open session.
 */
async function checkIn(user, { deviceId, ip, source = 'mobile', at = new Date() }, db = knex) {
  const employee = user.employee_id ? await db('employees').where({ id: user.employee_id }).first() : null;
  const businessDate = await businessDateFor(employee, at, db);
  const open = await db('attendance_sessions').where({ user_id: user.id, is_active: true }).forUpdate().first();
  if (open) {
    if (open.business_date === businessDate) return { session: open, alreadyCheckedIn: true, closedStale: null };
    await db('attendance_sessions').where({ id: open.id }).update({
      is_active: false, closed_reason: 'superseded_missing_checkout', updated_at: new Date(),
    });
  }
  const [session] = await db('attendance_sessions').insert({
    session_id: uuid(), user_id: user.id, employee_id: user.employee_id || null, business_date: businessDate,
    check_in_at: at, check_in_ip: ip || null, device_id: deviceId || null, is_active: true, source,
  }).returning('*');
  return { session, alreadyCheckedIn: false, closedStale: open && open.business_date !== businessDate ? open : null };
}

async function checkOut(sessionUuid, { ip, report, at = new Date() }, db = knex) {
  const s = await db('attendance_sessions').where({ session_id: sessionUuid }).forUpdate().first();
  if (!s || !s.is_active) return null;
  const [closed] = await db('attendance_sessions').where({ id: s.id }).update({
    is_active: false, check_out_at: at, check_out_ip: ip || null, report: report ?? null,
    closed_reason: 'checkout', updated_at: new Date(),
  }).returning('*');
  // Close any open disconnect interval at checkout so it counts as away time.
  const open = await db('network_disconnect_logs').where({ session_id: sessionUuid }).whereNull('reconnected_at').orderBy('id', 'desc').first();
  if (open) {
    await db('network_disconnect_logs').where({ id: open.id }).update({
      reconnected_at: at, duration_seconds: Math.max(0, Math.floor((at - new Date(open.disconnected_at)) / 1000)),
    });
  }
  return closed;
}

async function sessionMetrics(sessionRow, db = knex) {
  const logs = await db('network_disconnect_logs').where({ session_id: sessionRow.session_id });
  const m = engine.sessionMetrics(sessionRow, logs, Date.now());
  return {
    ...m,
    totalSpanText: engine.durationText(m.totalSpanSeconds),
    networkAwayText: engine.durationText(m.networkAwaySeconds),
    actualOfficeTimeText: engine.durationText(m.actualOfficeSeconds),
  };
}

/** Legacy admin attendance DTO (identical field names to the Cloudflare Worker). */
async function enrichLegacyRows(rows, db = knex) {
  const ids = rows.map((r) => r.session_id);
  const logs = ids.length ? await db('network_disconnect_logs').whereIn('session_id', ids) : [];
  const nowMs = Date.now();
  return rows.map((r) => {
    const m = engine.sessionMetrics(r, logs.filter((l) => l.session_id === r.session_id), nowMs);
    const checkIn = r.check_in_at ? new Date(r.check_in_at).toISOString() : '';
    return {
      id: r.id,
      sessionId: r.session_id,
      username: r.username,
      user: r.username,
      employeeCode: r.employee_code || null,
      date: r.business_date || checkIn.slice(0, 10),
      checkIn,
      checkOut: r.check_out_at ? new Date(r.check_out_at).toISOString() : null,
      checkInIp: r.check_in_ip,
      checkOutIp: r.check_out_ip,
      report: r.report,
      status: r.is_active ? 'Active' : (r.check_out_at ? 'Checked Out' : 'Missing Check-out'),
      totalSpanSeconds: m.totalSpanSeconds,
      networkAwaySeconds: m.networkAwaySeconds,
      actualOfficeSeconds: m.actualOfficeSeconds,
      totalSpanText: engine.durationText(m.totalSpanSeconds),
      networkAwayText: engine.durationText(m.networkAwaySeconds),
      actualOfficeTimeText: engine.durationText(m.actualOfficeSeconds),
      completedEightHours: m.actualOfficeSeconds >= 8 * 3600,
    };
  });
}

module.exports = { loadContext, recomputeRange, businessDateFor, checkIn, checkOut, sessionMetrics, enrichLegacyRows, addDays };
