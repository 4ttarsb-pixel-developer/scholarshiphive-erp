'use strict';
/**
 * Pure attendance engine: turns raw check-in/out sessions, leave, holidays,
 * schedules and approved corrections into ONE official status per employee-day.
 *
 * The server is the only place lateness and durations are calculated; the
 * web dashboard and Flutter app only display the results.
 *
 * Each day gets exactly one status, so a day can never be deducted twice
 * (e.g. a rejected leave with no attendance is simply "Absent").
 */
const { zonedToUtc, addDays, weekdayOf, minutesOfTime } = require('../utils/time');

const MISSING_CHECKOUT_BUFFER_MS = 4 * 3600 * 1000; // open session this long after shift end => missing check-out
const EARLY_CHECKIN_WINDOW_MS = 6 * 3600 * 1000;    // check-in up to 6h before shift start belongs to that shift

function shiftWindow(date, shift, tz) {
  const start = zonedToUtc(date, shift.start_time, tz);
  let durMin = minutesOfTime(shift.end_time) - minutesOfTime(shift.start_time);
  if (durMin <= 0) durMin += 24 * 60; // overnight shift
  const end = new Date(start.getTime() + durMin * 60000);
  return { start, end, overnight: minutesOfTime(shift.end_time) <= minutesOfTime(shift.start_time) };
}

/**
 * Business (shift) date for a check-in instant. For an overnight shift (21:00–06:00)
 * a check-in at 01:30 belongs to the previous calendar date.
 */
function businessDateFor(checkInAt, tz, shiftForDate) {
  const { zonedParts } = require('../utils/time');
  const local = zonedParts(checkInAt, tz).date;
  const t = new Date(checkInAt).getTime();
  for (const d of [local, addDays(local, -1)]) {
    const shift = shiftForDate(d);
    if (!shift) continue;
    const w = shiftWindow(d, shift, tz);
    if (t >= w.start.getTime() - EARLY_CHECKIN_WINDOW_MS && t <= w.end.getTime()) {
      // Prefer the previous date only when it is an overnight shift still in progress.
      if (d !== local && !w.overnight) continue;
      return d;
    }
  }
  return local;
}

/** Merge overlapping away intervals inside [startMs, endMs] and return seconds. */
function mergedAwaySeconds(logs, startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  const intervals = [];
  for (const log of logs || []) {
    const rs = new Date(log.disconnected_at).getTime();
    const re = log.reconnected_at ? new Date(log.reconnected_at).getTime() : endMs;
    if (!Number.isFinite(rs) || !Number.isFinite(re)) continue;
    const s = Math.max(startMs, rs);
    const e = Math.min(endMs, re);
    if (e > s) intervals.push([s, e]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0; let cs = null; let ce = null;
  for (const [s, e] of intervals) {
    if (cs === null) { cs = s; ce = e; continue; }
    if (s <= ce) ce = Math.max(ce, e); else { total += ce - cs; cs = s; ce = e; }
  }
  if (cs !== null) total += ce - cs;
  return Math.max(0, Math.floor(total / 1000));
}

/** Metrics for one session (same formula as the Cloudflare Worker: span − merged away time). */
function sessionMetrics(session, logs, nowMs) {
  const startMs = new Date(session.check_in_at).getTime();
  const endMs = session.check_out_at ? new Date(session.check_out_at).getTime() : (session.is_active ? nowMs : startMs);
  const span = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const away = Math.min(span, mergedAwaySeconds(logs, startMs, endMs));
  return { totalSpanSeconds: span, networkAwaySeconds: away, actualOfficeSeconds: Math.max(0, span - away) };
}

function durationText(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Compute official day records.
 * @param {object} input
 * @param {object} input.employee           {id, joining_date, leaving_date}
 * @param {string[]} input.dates            dates to compute
 * @param {string} input.today              today's date in business tz
 * @param {number} input.nowMs
 * @param {string} input.tz
 * @param {object} input.policy             normalised policy
 * @param {(date:string, weekday:number)=>{working:boolean, shift:object}} input.schedule
 * @param {Map<string,object>} input.holidays
 * @param {object[]} input.sessions         sessions with .logs[]
 * @param {object[]} input.leaves           Approved + Pending leave rows
 * @param {Map<string,object>} input.approvedCorrections latest approved correction per date
 * @param {Map<string,object>} input.pendingCorrections  pending correction per date
 */
function computeDays(input) {
  const { employee, dates, today, nowMs, tz, policy, schedule, holidays, sessions, leaves,
    approvedCorrections, pendingCorrections } = input;
  const byDate = new Map();
  for (const s of sessions) {
    if (!byDate.has(s.business_date)) byDate.set(s.business_date, []);
    byDate.get(s.business_date).push(s);
  }

  const out = [];
  for (const date of dates) {
    const weekday = weekdayOf(date);
    const sched = schedule(date, weekday);
    const shift = sched.shift;
    const win = shift ? shiftWindow(date, shift, tz) : null;
    const rec = {
      attendance_date: date,
      shift_id: shift ? shift.id : null,
      scheduled_start: win ? win.start : null,
      scheduled_end: win ? win.end : null,
      actual_check_in: null,
      actual_check_out: null,
      worked_seconds: 0,
      away_seconds: 0,
      late_minutes: 0,
      early_departure_minutes: 0,
      status: 'Absent',
      leave_request_id: null,
      leave_fraction: 0,
      leave_pay_type: null,
      is_overridden: false,
      correction_id: null,
      correction_reason: null,
      source: 'system',
      scheduled_working: sched.working && !holidays.has(date),
      holiday: holidays.get(date) || null,
      notes: [],
    };

    // 1. Employment window
    if (date < employee.joining_date || (employee.leaving_date && date > employee.leaving_date)) {
      rec.status = 'NotEmployed';
      out.push(rec);
      continue;
    }

    // 2. Aggregate sessions of this business date
    const daySessions = byDate.get(date) || [];
    let firstIn = null; let lastOut = null; let openSession = false; let dangling = false;
    for (const s of daySessions) {
      const m = sessionMetrics(s, s.logs, nowMs);
      rec.worked_seconds += m.actualOfficeSeconds;
      rec.away_seconds += m.networkAwaySeconds;
      const ci = new Date(s.check_in_at);
      if (!firstIn || ci < firstIn) firstIn = ci;
      if (s.check_out_at) {
        const co = new Date(s.check_out_at);
        if (!lastOut || co > lastOut) lastOut = co;
      }
      if (s.is_active) openSession = true;
      if (!s.is_active && !s.check_out_at) dangling = true;
    }
    if (openSession || dangling) lastOut = null;

    // 3. Approved correction overrides everything for that day
    const corr = approvedCorrections.get(date);
    if (corr && corr.requested_status !== 'Recompute') {
      rec.is_overridden = true;
      rec.correction_id = corr.id;
      rec.correction_reason = corr.reason;
      rec.source = 'admin_correction';
      const st = corr.requested_status;
      if (st === 'Present') {
        rec.actual_check_in = corr.requested_check_in ? new Date(corr.requested_check_in) : firstIn;
        rec.actual_check_out = corr.requested_check_out ? new Date(corr.requested_check_out) : lastOut;
        if (rec.actual_check_in && rec.actual_check_out) {
          rec.worked_seconds = Math.max(0, Math.floor((rec.actual_check_out - rec.actual_check_in) / 1000) - rec.away_seconds);
        }
        applyTiming(rec, win, policy, rec.scheduled_working);
        rec.status = rec.late_minutes > policy.graceMinutes && rec.scheduled_working ? 'Late' : 'Present';
      } else {
        rec.status = st;
        if (st === 'PaidLeave' || st === 'UnpaidLeave') {
          rec.leave_fraction = 1;
          rec.leave_pay_type = st === 'PaidLeave' ? 'Paid' : 'Unpaid';
        }
      }
      out.push(rec);
      continue;
    }

    rec.actual_check_in = firstIn;
    rec.actual_check_out = lastOut;

    const leave = leaves.find((l) => l.status === 'Approved' && l.start_date <= date && l.end_date >= date);
    const pending = leaves.find((l) => l.status === 'Pending' && l.start_date <= date && l.end_date >= date);
    const holiday = holidays.get(date);

    // 4. Non-working days (holiday / weekly off) — worked anyway => Present, never late, never absent
    if (holiday || !sched.working) {
      if (daySessions.length) {
        rec.status = 'Present';
        rec.notes.push(holiday ? `Worked on holiday: ${holiday.name}` : 'Worked on weekly off day');
      } else {
        rec.status = holiday ? 'Holiday' : 'WeeklyOff';
      }
      out.push(rec);
      continue;
    }

    // 5. Approved leave
    if (leave) {
      rec.leave_request_id = leave.id;
      rec.leave_fraction = Number(leave.day_fraction);
      rec.leave_pay_type = leave.pay_type;
      if (daySessions.length && rec.leave_fraction === 1) {
        // Came to work despite full-day leave: attendance wins, leave not consumed.
        rec.leave_request_id = null; rec.leave_fraction = 0; rec.leave_pay_type = null;
        rec.notes.push('Attended on an approved leave day; leave not deducted');
      } else if (!daySessions.length && rec.leave_fraction === 1) {
        rec.status = leave.pay_type === 'Unpaid' ? 'UnpaidLeave' : 'PaidLeave';
        out.push(rec);
        continue;
      }
    }

    // 6. Attendance present
    if (daySessions.length) {
      const halfDayLeave = rec.leave_fraction === 0.5;
      applyTiming(rec, win, policy, !halfDayLeave);
      const pastShift = win && nowMs > win.end.getTime() + MISSING_CHECKOUT_BUFFER_MS;
      if (dangling || (openSession && pastShift)) {
        rec.status = 'MissingCheckOut';
      } else {
        rec.status = rec.late_minutes > policy.graceMinutes ? 'Late' : 'Present';
      }
      out.push(rec);
      continue;
    }

    // 7. No attendance
    if (pendingCorrections.has(date) && pendingCorrections.get(date).requested_status === 'Present') {
      rec.status = 'MissingCheckIn';
      rec.notes.push('Present claimed without a punch; correction pending');
    } else if (pending && !leave) {
      rec.status = 'PendingLeave';
      rec.leave_request_id = pending.id;
    } else if (date > today || (date === today && win && nowMs < win.end.getTime())) {
      rec.status = 'Upcoming';
    } else {
      rec.status = 'Absent'; // includes rejected leave with no attendance; half-day leave remainder
      const rejected = leaves.find((l) => l.status === 'Rejected' && l.start_date <= date && l.end_date >= date);
      if (rejected) rec.notes.push('Leave request was rejected');
    }
    out.push(rec);
  }
  return out;
}

function applyTiming(rec, win, policy, penalisable) {
  if (!win || !rec.actual_check_in || !penalisable) {
    rec.late_minutes = 0;
    rec.early_departure_minutes = 0;
    return;
  }
  rec.late_minutes = Math.max(0, Math.floor((rec.actual_check_in - win.start) / 60000));
  rec.early_departure_minutes = rec.actual_check_out
    ? Math.max(0, Math.floor((win.end - rec.actual_check_out) / 60000)) : 0;
}

module.exports = { computeDays, shiftWindow, businessDateFor, mergedAwaySeconds, sessionMetrics, durationText };
