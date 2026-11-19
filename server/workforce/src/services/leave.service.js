'use strict';
const knex = require('../db');
const payroll = require('./payroll.service');
const { audit } = require('./audit.service');
const { isValidDate, eachDate } = require('../utils/time');
const { badRequest, conflict, notFound } = require('../utils/errors');

function dto(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code || null,
    employeeName: r.full_name || r.username,
    username: r.username,
    leaveType: r.leave_type,
    startDate: r.start_date,
    endDate: r.end_date,
    dayFraction: Number(r.day_fraction),
    reason: r.reason,
    status: r.status,
    payType: r.pay_type,
    decisionNote: r.decision_note,
    decidedBy: r.decided_by_name || null,
    decidedAt: r.decided_at,
    source: r.source,
    createdAt: r.created_at,
    days: eachDate(r.start_date, r.end_date).length * Number(r.day_fraction),
  };
}

function query(db = knex) {
  return db('leave_requests as l')
    .leftJoin('employees as e', 'e.id', 'l.employee_id')
    .leftJoin('users as du', 'du.id', 'l.decided_by')
    .select('l.*', 'e.employee_code', 'e.full_name', 'du.full_name as decided_by_name');
}

async function list({ status, employeeId, month, search } = {}) {
  const q = query().orderBy([{ column: 'l.status', order: 'desc' }, { column: 'l.start_date', order: 'desc' }]);
  if (status) q.where('l.status', status);
  if (employeeId) q.where('l.employee_id', employeeId);
  if (month) {
    const { monthEnd } = require('../utils/time');
    q.where('l.start_date', '<=', monthEnd(month)).where('l.end_date', '>=', month);
  }
  if (search) {
    const like = `%${String(search).toLowerCase()}%`;
    q.where((w) => w.whereRaw('lower(e.full_name) like ?', [like]).orWhereRaw('lower(l.username) like ?', [like]).orWhereRaw('lower(e.employee_code) like ?', [like]));
  }
  return (await q.limit(1000)).map(dto);
}

function inferHalfDay(leaveType) { return /half/i.test(String(leaveType || '')); }

async function apply({ employeeId, userId, username, leaveType, startDate, endDate, halfDay, reason, department, source }, actor, { ip, events }) {
  if (!isValidDate(startDate)) throw badRequest('Enter a valid leave start date.');
  const end = endDate || startDate;
  if (!isValidDate(end) || end < startDate) throw badRequest('End date must be on or after the start date.');
  const half = halfDay !== undefined ? !!halfDay : inferHalfDay(leaveType);
  if (half && end !== startDate) throw badRequest('A half-day leave must be a single date.');
  if (eachDate(startDate, end).length > 60) throw badRequest('A single leave request cannot exceed 60 days.');
  return knex.transaction(async (trx) => {
    if (employeeId) {
      for (const d of eachDate(startDate, end)) await payroll.assertNotLocked(employeeId, d, trx, 'This leave');
      const overlap = await trx('leave_requests').where({ employee_id: employeeId }).whereIn('status', ['Pending', 'Approved'])
        .where('start_date', '<=', end).where('end_date', '>=', startDate).first();
      if (overlap) throw conflict(`An overlapping ${overlap.status.toLowerCase()} leave request already exists (#${overlap.id}).`);
    }
    const [row] = await trx('leave_requests').insert({
      employee_id: employeeId || null, user_id: userId || null, username: username || null,
      leave_type: leaveType || (half ? 'Half-Day Leave' : 'Full-Day Leave'), start_date: startDate, end_date: end,
      day_fraction: half ? 0.5 : 1, reason: String(reason || '').slice(0, 2000), department: department || null,
      status: 'Pending', source: source || 'web',
      employee_signature: `Digitally Signed by ${String(username || actor?.username || '').toUpperCase()} (${new Date().toISOString().slice(0, 19).replace('T', ' ')})`,
    }).returning('*');
    await audit(trx, { actor, action: 'Leave requested', entityType: 'leave_request', entityId: row.id, ip, detail: `${username || ''} ${startDate}${end !== startDate ? ` → ${end}` : ''} ${row.leave_type}` });
    if (employeeId) {
      await payroll.recalcDates(employeeId, eachDate(startDate, end), trx);
      events.add('leave.changed', { employeeId });
      events.add('payroll.changed', { employeeId });
    }
    return dto(row);
  });
}

/**
 * Approve (Paid/Unpaid) or reject. Locked months are refused. Draft payroll for
 * every affected month is recalculated inside the same transaction.
 */
async function decide(id, { decision, payType, note }, actor, { ip, events }) {
  if (!['Approved', 'Rejected'].includes(decision)) throw badRequest('Decision must be Approved or Rejected.');
  if (decision === 'Approved' && !['Paid', 'Unpaid'].includes(payType)) throw badRequest('Choose whether the approved leave is Paid or Unpaid.');
  return knex.transaction(async (trx) => {
    const l = await trx('leave_requests').where({ id }).forUpdate().first();
    if (!l) throw notFound('Leave request not found.');
    if (l.status !== 'Pending') throw conflict(`This leave is already ${l.status}.`);
    if (l.employee_id) for (const d of eachDate(l.start_date, l.end_date)) await payroll.assertNotLocked(l.employee_id, d, trx, 'This leave decision');
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await trx('leave_requests').where({ id }).update({
      status: decision, pay_type: decision === 'Approved' ? payType : null, decision_note: note || null,
      decided_by: actor.id, decided_at: new Date(), updated_at: new Date(),
      supervisor_signature: decision === 'Approved' ? `Digitally Signed & Approved by ${actor.fullName} (${stamp})` : `Rejected by ${actor.fullName} (${stamp})`,
    });
    await audit(trx, {
      actor, action: `Leave ${decision.toLowerCase()}`, entityType: 'leave_request', entityId: id, ip,
      detail: `${l.username || l.employee_id} ${l.start_date}${l.end_date !== l.start_date ? ` → ${l.end_date}` : ''}${decision === 'Approved' ? ` (${payType})` : ''}${note ? ` · ${note}` : ''}`,
    });
    if (l.employee_id) {
      await payroll.recalcDates(l.employee_id, eachDate(l.start_date, l.end_date), trx);
      events.add('leave.changed', { employeeId: l.employee_id });
      events.add('payroll.changed', { employeeId: l.employee_id });
    }
    return dto(await query(trx).where('l.id', id).first());
  });
}

async function cancel(id, actor, { ip, events, ownEmployeeId }) {
  return knex.transaction(async (trx) => {
    const l = await trx('leave_requests').where({ id }).forUpdate().first();
    if (!l) throw notFound('Leave request not found.');
    if (ownEmployeeId && l.employee_id !== ownEmployeeId) throw notFound('Leave request not found.');
    if (l.status !== 'Pending') throw conflict('Only pending leave can be cancelled.');
    await trx('leave_requests').where({ id }).update({ status: 'Cancelled', updated_at: new Date() });
    await audit(trx, { actor, action: 'Leave cancelled', entityType: 'leave_request', entityId: id, ip });
    if (l.employee_id) {
      await payroll.recalcDates(l.employee_id, eachDate(l.start_date, l.end_date), trx);
      events.add('leave.changed', { employeeId: l.employee_id });
      events.add('payroll.changed', { employeeId: l.employee_id });
    }
    return { ok: true };
  });
}

module.exports = { list, apply, decide, cancel, dto, query };
