'use strict';
const knex = require('../db');
const payroll = require('./payroll.service');
const { policyFor, scheduleResolver } = require('./policy.service');
const { audit } = require('./audit.service');
const { isValidDate, isValidTime, zonedToUtc, addDays, weekdayOf, minutesOfTime } = require('../utils/time');
const { badRequest, conflict, notFound, forbidden } = require('../utils/errors');

const STATUSES = ['Present', 'Absent', 'PaidLeave', 'UnpaidLeave', 'Holiday', 'WeeklyOff', 'Recompute'];

/** Convert HH:MM wall-clock times for a shift date into instants (overnight aware). */
async function toInstants(employee, date, checkIn, checkOut, db) {
  const policy = await policyFor(date, db);
  const tz = policy.timezone;
  const schedule = await scheduleResolver(employee, db);
  const shift = schedule(date, weekdayOf(date)).shift;
  const overnight = shift && minutesOfTime(shift.end_time) <= minutesOfTime(shift.start_time);
  let inAt = null; let outAt = null;
  if (checkIn) {
    // For an overnight shift a check-in after midnight but before the shift end belongs to the next calendar day.
    const inDate = overnight && minutesOfTime(checkIn) < minutesOfTime(shift.end_time) ? addDays(date, 1) : date;
    inAt = zonedToUtc(inDate, checkIn, tz);
  }
  if (checkOut) {
    let outDate = date;
    if (overnight && minutesOfTime(checkOut) <= minutesOfTime(shift.end_time) + 360) outDate = addDays(date, 1);
    outAt = zonedToUtc(outDate, checkOut, tz);
    if (inAt && outAt <= inAt) outAt = zonedToUtc(addDays(outDate, 1), checkOut, tz);
  }
  return { inAt, outAt };
}

function dto(c) {
  return {
    id: c.id, employeeId: c.employee_id, employeeCode: c.employee_code, employeeName: c.full_name,
    attendanceDate: c.attendance_date, requestedStatus: c.requested_status,
    requestedCheckIn: c.requested_check_in, requestedCheckOut: c.requested_check_out,
    reason: c.reason, status: c.status, requestedBy: c.requested_by_name, decidedBy: c.decided_by_name,
    decidedAt: c.decided_at, decisionNote: c.decision_note, createdAt: c.created_at,
  };
}

function query(db = knex) {
  return db('attendance_corrections as c')
    .join('employees as e', 'e.id', 'c.employee_id')
    .leftJoin('users as ru', 'ru.id', 'c.requested_by')
    .leftJoin('users as du', 'du.id', 'c.decided_by')
    .select('c.*', 'e.employee_code', 'e.full_name', 'ru.full_name as requested_by_name', 'du.full_name as decided_by_name');
}

async function list({ status, employeeId } = {}) {
  const q = query().orderBy('c.created_at', 'desc').limit(1000);
  if (status) q.where('c.status', status);
  if (employeeId) q.where('c.employee_id', employeeId);
  return (await q).map(dto);
}

/**
 * Request a correction (HR) or apply one directly (approver with autoApprove).
 * "Present" without a check-in time is allowed as a request (it shows as a
 * Missing check-in blocker) but must carry a time before it can be approved.
 */
async function request(input, actor, { canApprove, ip, events }) {
  const employeeId = Number(input.employeeId);
  const date = input.attendanceDate;
  const status = input.requestedStatus;
  const reason = String(input.reason || '').trim();
  if (!Number.isInteger(employeeId)) throw badRequest('Select an employee.');
  if (!isValidDate(date)) throw badRequest('Enter a valid attendance date.');
  if (!STATUSES.includes(status)) throw badRequest('Invalid attendance status.');
  if (reason.length < 5) throw badRequest('A correction reason of at least 5 characters is required.');
  if (input.checkIn && !isValidTime(input.checkIn)) throw badRequest('Check-in must be HH:MM.');
  if (input.checkOut && !isValidTime(input.checkOut)) throw badRequest('Check-out must be HH:MM.');
  if (status !== 'Present' && (input.checkIn || input.checkOut)) throw badRequest('Times can only be given for a Present correction.');
  const autoApprove = !!input.autoApprove;
  if (autoApprove && !canApprove) throw forbidden('You can request corrections but not approve them.');
  if (autoApprove && status === 'Present' && !input.checkIn) throw badRequest('A check-in time is required to approve a Present correction.');

  return knex.transaction(async (trx) => {
    const emp = await trx('employees').where({ id: employeeId }).first();
    if (!emp) throw notFound('Employee not found.');
    await payroll.assertNotLocked(employeeId, date, trx, 'This attendance correction');
    const { inAt, outAt } = await toInstants(emp, date, input.checkIn, input.checkOut, trx);
    const pending = await trx('attendance_corrections').where({ employee_id: employeeId, attendance_date: date, status: 'Pending' }).forUpdate().first();
    if (pending) {
      if (!autoApprove) throw conflict(`A correction for ${date} is already pending (#${pending.id}).`);
      await trx('attendance_corrections').where({ id: pending.id }).update({ status: 'Superseded', decided_by: actor.id, decided_at: new Date(), decision_note: 'Superseded by direct correction', updated_at: new Date() });
    }
    const [row] = await trx('attendance_corrections').insert({
      employee_id: employeeId, attendance_date: date, requested_status: status,
      requested_check_in: inAt, requested_check_out: outAt, reason,
      status: autoApprove ? 'Approved' : 'Pending', requested_by: actor.id,
      decided_by: autoApprove ? actor.id : null, decided_at: autoApprove ? new Date() : null,
      decision_note: autoApprove ? 'Applied directly by authorised user' : null,
    }).returning('*');
    await audit(trx, {
      actor, action: autoApprove ? 'Attendance corrected' : 'Attendance correction requested', entityType: 'attendance_correction', entityId: row.id, ip,
      detail: `${emp.full_name} (${emp.employee_code}) ${date} → ${status}${input.checkIn ? ` in ${input.checkIn}` : ''}${input.checkOut ? ` out ${input.checkOut}` : ''} · ${reason}`,
    });
    await payroll.recalcForDate(employeeId, date, trx);
    events.add('attendance.changed', { employeeId, date });
    events.add('payroll.changed', { employeeId });
    return dto(await query(trx).where('c.id', row.id).first());
  });
}

async function decide(id, { decision, note, checkIn, checkOut }, actor, { ip, events }) {
  if (!['Approved', 'Rejected'].includes(decision)) throw badRequest('Decision must be Approved or Rejected.');
  if (checkIn && !isValidTime(checkIn)) throw badRequest('Check-in must be HH:MM.');
  if (checkOut && !isValidTime(checkOut)) throw badRequest('Check-out must be HH:MM.');
  return knex.transaction(async (trx) => {
    const c = await trx('attendance_corrections').where({ id }).forUpdate().first();
    if (!c) throw notFound('Correction not found.');
    if (c.status !== 'Pending') throw conflict(`This correction is already ${c.status}.`);
    await payroll.assertNotLocked(c.employee_id, c.attendance_date, trx, 'This correction');
    const patch = { status: decision, decided_by: actor.id, decided_at: new Date(), decision_note: note || null, updated_at: new Date() };
    if (decision === 'Approved' && c.requested_status === 'Present') {
      const emp = await trx('employees').where({ id: c.employee_id }).first();
      if (checkIn || checkOut) {
        const { inAt, outAt } = await toInstants(emp, c.attendance_date, checkIn, checkOut, trx);
        if (inAt) patch.requested_check_in = inAt;
        if (outAt) patch.requested_check_out = outAt;
      }
      if (!patch.requested_check_in && !c.requested_check_in) {
        throw badRequest('Provide the actual check-in time to approve a Present correction.');
      }
    }
    await trx('attendance_corrections').where({ id }).update(patch);
    await audit(trx, { actor, action: `Attendance correction ${decision.toLowerCase()}`, entityType: 'attendance_correction', entityId: id, ip, detail: `${c.attendance_date} ${c.requested_status}${note ? ` · ${note}` : ''}` });
    await payroll.recalcForDate(c.employee_id, c.attendance_date, trx);
    events.add('attendance.changed', { employeeId: c.employee_id, date: c.attendance_date });
    events.add('payroll.changed', { employeeId: c.employee_id });
    return dto(await query(trx).where('c.id', id).first());
  });
}

/** Manager review of a severe-late day. The configured deduction still applies. */
async function review(employeeId, date, note, actor, { ip, events }) {
  if (!note || String(note).trim().length < 5) throw badRequest('A review note of at least 5 characters is required.');
  return knex.transaction(async (trx) => {
    await payroll.assertNotLocked(employeeId, date, trx, 'This review');
    await payroll.recalcForDate(employeeId, date, trx);
    const rec = await trx('attendance_records').where({ employee_id: employeeId, attendance_date: date }).forUpdate().first();
    if (!rec) throw notFound('Attendance record not found.');
    await trx('attendance_records').where({ id: rec.id }).update({ reviewed: true, review_note: String(note).trim(), reviewed_by: actor.id, reviewed_at: new Date() });
    await audit(trx, { actor, action: 'Severe lateness reviewed', entityType: 'attendance_record', entityId: rec.id, ip, detail: `${date} (${rec.late_minutes} min) · ${String(note).trim()}` });
    await payroll.recalcForDate(employeeId, date, trx);
    events.add('attendance.changed', { employeeId, date });
    events.add('payroll.changed', { employeeId });
    return { ok: true };
  });
}

module.exports = { list, request, decide, review, toInstants, dto };
