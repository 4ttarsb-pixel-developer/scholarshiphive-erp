'use strict';
const knex = require('../db');
const payroll = require('./payroll.service');
const { audit } = require('./audit.service');
const { D, isValidMoneyInput } = require('../utils/money');
const { isValidDate, monthStart } = require('../utils/time');
const { badRequest, conflict, notFound } = require('../utils/errors');

function dto(a) {
  return {
    id: a.id, employeeId: a.employee_id, employeeCode: a.employee_code, employeeName: a.full_name,
    amount: a.amount, monthlyRecovery: a.monthly_recovery, remainingBalance: a.remaining_balance,
    recovered: D(a.amount).minus(D(a.remaining_balance)).toFixed(2),
    advanceDate: a.advance_date, recoveryStartMonth: a.recovery_start_month, status: a.status, reason: a.reason,
    isDemo: a.is_demo, createdBy: a.created_by_name, approvedBy: a.approved_by_name, approvedAt: a.approved_at, createdAt: a.created_at,
    installmentsRemaining: D(a.remaining_balance).gt(0) ? D(a.remaining_balance).dividedBy(D(a.monthly_recovery)).ceil().toNumber() : 0,
  };
}

function query(db = knex) {
  return db('salary_advances as a').join('employees as e', 'e.id', 'a.employee_id')
    .leftJoin('users as cu', 'cu.id', 'a.created_by').leftJoin('users as au', 'au.id', 'a.approved_by')
    .select('a.*', 'e.employee_code', 'e.full_name', 'cu.full_name as created_by_name', 'au.full_name as approved_by_name');
}

async function list({ employeeId, status } = {}) {
  const q = query().orderBy('a.id', 'desc');
  if (employeeId) q.where('a.employee_id', employeeId);
  if (status) q.where('a.status', status);
  const rows = (await q).map(dto);
  const rec = await knex('advance_recoveries as r').join('payroll_records as p', 'p.id', 'r.payroll_record_id')
    .join('payroll_periods as pp', 'pp.id', 'p.period_id')
    .whereIn('r.advance_id', rows.map((x) => x.id)).orderBy('r.id')
    .select('r.advance_id', 'r.amount', 'r.balance_after', 'r.recovered_at', 'pp.period_month');
  for (const a of rows) a.recoveries = rec.filter((r) => r.advance_id === a.id);
  return rows;
}

async function create(input, actor, { canApprove, ip, events }) {
  const employeeId = Number(input.employeeId);
  if (!Number.isInteger(employeeId)) throw badRequest('Select an employee.');
  if (!isValidMoneyInput(input.amount, { allowZero: false })) throw badRequest('Advance amount must be a positive PKR amount.');
  if (!isValidMoneyInput(input.monthlyRecovery, { allowZero: false })) throw badRequest('Monthly recovery must be a positive PKR amount.');
  if (D(input.monthlyRecovery).gt(D(input.amount))) throw badRequest('Monthly recovery cannot exceed the advance amount.');
  if (!isValidDate(input.advanceDate)) throw badRequest('Enter a valid advance date.');
  if (String(input.reason || '').trim().length < 5) throw badRequest('Give a reason of at least 5 characters.');
  const startMonth = monthStart(input.recoveryStartMonth || input.advanceDate);
  if (input.approveNow && !canApprove) throw badRequest('You are not authorised to approve advances.');
  return knex.transaction(async (trx) => {
    const emp = await trx('employees').where({ id: employeeId }).first();
    if (!emp) throw notFound('Employee not found.');
    if (await payroll.isLocked(employeeId, startMonth, trx)) throw conflict(`Payroll for ${startMonth.slice(0, 7)} is approved; start recovery in a later month.`);
    const [a] = await trx('salary_advances').insert({
      employee_id: employeeId, amount: D(input.amount).toFixed(2), monthly_recovery: D(input.monthlyRecovery).toFixed(2),
      remaining_balance: D(input.amount).toFixed(2), advance_date: input.advanceDate, recovery_start_month: startMonth,
      status: input.approveNow ? 'Active' : 'Pending', reason: String(input.reason).trim(), is_demo: !!input.isDemo,
      created_by: actor.id, approved_by: input.approveNow ? actor.id : null, approved_at: input.approveNow ? new Date() : null,
    }).returning('*');
    await audit(trx, { actor, action: input.approveNow ? 'Advance issued' : 'Advance requested', entityType: 'salary_advance', entityId: a.id, ip, detail: `${emp.full_name}: PKR ${a.amount}, installment PKR ${a.monthly_recovery} from ${startMonth.slice(0, 7)}` });
    if (input.approveNow) await payroll.recalc(employeeId, startMonth, trx);
    events.add('advances.changed', { employeeId });
    events.add('payroll.changed', { employeeId });
    return dto(await query(trx).where('a.id', a.id).first());
  });
}

async function decide(id, decision, actor, { ip, events, note }) {
  if (!['approve', 'reject', 'cancel'].includes(decision)) throw badRequest('Invalid decision.');
  return knex.transaction(async (trx) => {
    const a = await trx('salary_advances').where({ id }).forUpdate().first();
    if (!a) throw notFound('Advance not found.');
    if (a.status !== 'Pending') throw conflict(`Advance is already ${a.status}.`);
    const status = decision === 'approve' ? 'Active' : decision === 'reject' ? 'Rejected' : 'Cancelled';
    if (status === 'Active' && await payroll.isLocked(a.employee_id, a.recovery_start_month, trx)) {
      const next = await payroll.nextOpenMonth(a.employee_id, a.recovery_start_month, trx);
      await trx('salary_advances').where({ id }).update({ recovery_start_month: next });
    }
    await trx('salary_advances').where({ id }).update({
      status, approved_by: status === 'Active' ? actor.id : null, approved_at: status === 'Active' ? new Date() : null, updated_at: new Date(),
    });
    await audit(trx, { actor, action: `Advance ${status === 'Active' ? 'approved & disbursed' : status.toLowerCase()}`, entityType: 'salary_advance', entityId: id, ip, detail: `PKR ${a.amount}${note ? ` · ${note}` : ''}` });
    const fresh = await trx('salary_advances').where({ id }).first();
    await payroll.recalc(a.employee_id, fresh.recovery_start_month, trx);
    events.add('advances.changed', { employeeId: a.employee_id });
    events.add('payroll.changed', { employeeId: a.employee_id });
    return dto(await query(trx).where('a.id', id).first());
  });
}

async function outstandingTotal() {
  const r = await knex('salary_advances').where({ status: 'Active' }).sum('remaining_balance as s').first();
  return D(r.s || 0).toFixed(2);
}

module.exports = { list, create, decide, outstandingTotal, dto };
