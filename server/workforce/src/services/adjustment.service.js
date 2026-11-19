'use strict';
const knex = require('../db');
const payroll = require('./payroll.service');
const { audit } = require('./audit.service');
const { D, isValidMoneyInput } = require('../utils/money');
const { monthStart } = require('../utils/time');
const { badRequest, conflict, notFound } = require('../utils/errors');

const CATEGORIES = ['BONUS', 'OTHER_DEDUCTION', 'COMMISSION_REVERSAL', 'COMMISSION_CORRECTION', 'ATTENDANCE_CORRECTION', 'OTHER'];

function dto(a) {
  return {
    id: a.id, employeeId: a.employee_id, employeeCode: a.employee_code, employeeName: a.full_name,
    periodMonth: a.period_month, adjustmentType: a.adjustment_type, category: a.category, amount: a.amount,
    reason: a.reason, status: a.status, sourceRef: a.source_ref, createdBy: a.created_by_name,
    decidedBy: a.decided_by_name, decidedAt: a.decided_at, createdAt: a.created_at,
  };
}
function query(db = knex) {
  return db('payroll_adjustments as a').join('employees as e', 'e.id', 'a.employee_id')
    .leftJoin('users as cu', 'cu.id', 'a.created_by').leftJoin('users as du', 'du.id', 'a.decided_by')
    .select('a.*', 'e.employee_code', 'e.full_name', 'cu.full_name as created_by_name', 'du.full_name as decided_by_name');
}

async function list({ month, employeeId, status } = {}) {
  const q = query().orderBy('a.id', 'desc');
  if (month) q.where('a.period_month', month);
  if (employeeId) q.where('a.employee_id', employeeId);
  if (status) q.where('a.status', status);
  return (await q).map(dto);
}

/**
 * Create a bonus / authorised deduction / correction. Users holding payroll.approve
 * can apply it immediately (approveNow); otherwise it is Pending and blocks approval.
 */
async function create(input, actor, { canApprove, ip, events }) {
  const employeeId = Number(input.employeeId);
  const month = monthStart(input.periodMonth);
  const type = input.adjustmentType;
  if (!['EARNING', 'DEDUCTION'].includes(type)) throw badRequest('Adjustment type must be EARNING or DEDUCTION.');
  const category = input.category || (type === 'EARNING' ? 'BONUS' : 'OTHER_DEDUCTION');
  if (!CATEGORIES.includes(category)) throw badRequest('Invalid adjustment category.');
  if (!isValidMoneyInput(input.amount, { allowZero: false })) throw badRequest('Amount must be a positive PKR value.');
  if (String(input.reason || '').trim().length < 5) throw badRequest('Reason / authorisation (min 5 characters) is required.');
  const approveNow = !!input.approveNow && canApprove;
  return knex.transaction(async (trx) => {
    const emp = await trx('employees').where({ id: employeeId }).first();
    if (!emp) throw notFound('Employee not found.');
    if (await payroll.isLocked(employeeId, month, trx)) {
      throw conflict(`Payroll for ${month.slice(0, 7)} is locked. Add the correction to the next open month.`);
    }
    const [a] = await trx('payroll_adjustments').insert({
      employee_id: employeeId, period_month: month, adjustment_type: type, category, amount: D(input.amount).toFixed(2),
      reason: String(input.reason).trim(), status: approveNow ? 'Approved' : 'Pending', created_by: actor.id,
      decided_by: approveNow ? actor.id : null, decided_at: approveNow ? new Date() : null,
    }).returning('*');
    await audit(trx, { actor, action: approveNow ? 'Payroll adjustment applied' : 'Payroll adjustment requested', entityType: 'payroll_adjustment', entityId: a.id, ip, detail: `${emp.full_name} ${month.slice(0, 7)} ${type} ${category} PKR ${a.amount}: ${a.reason}` });
    await payroll.recalc(employeeId, month, trx);
    events.add('payroll.changed', { employeeId, month });
    return dto(await query(trx).where('a.id', a.id).first());
  });
}

async function decide(id, decision, actor, { ip, events, note }) {
  const status = { approve: 'Approved', reject: 'Rejected', cancel: 'Cancelled' }[decision];
  if (!status) throw badRequest('Invalid decision.');
  return knex.transaction(async (trx) => {
    const a = await trx('payroll_adjustments').where({ id }).forUpdate().first();
    if (!a) throw notFound('Adjustment not found.');
    if (a.status !== 'Pending' && !(status === 'Cancelled' && a.status === 'Approved')) throw conflict(`Adjustment is already ${a.status}.`);
    if (await payroll.isLocked(a.employee_id, a.period_month, trx)) throw conflict('That payroll month is locked.');
    await trx('payroll_adjustments').where({ id }).update({ status, decided_by: actor.id, decided_at: new Date(), updated_at: new Date() });
    await audit(trx, { actor, action: `Payroll adjustment ${status.toLowerCase()}`, entityType: 'payroll_adjustment', entityId: id, ip, detail: `${a.category} PKR ${a.amount}${note ? ` · ${note}` : ''}` });
    await payroll.recalc(a.employee_id, a.period_month, trx);
    events.add('payroll.changed', { employeeId: a.employee_id, month: a.period_month });
    return dto(await query(trx).where('a.id', id).first());
  });
}

/**
 * "Edit bonus / deductions" from the salary review modal (preserved from the HTML):
 * sets the approved BONUS and OTHER_DEDUCTION totals for the month by adding the
 * difference as new authorised adjustments, so history is never rewritten.
 */
async function setBonusAndDeduction(employeeId, month, { bonus, otherDeduction, reason }, actor, ctx) {
  if (!isValidMoneyInput(bonus) || !isValidMoneyInput(otherDeduction)) throw badRequest('Bonus and deduction must be PKR amounts ≥ 0.');
  if (String(reason || '').trim().length < 5) throw badRequest('Reason / authorisation (min 5 characters) is required.');
  const m = monthStart(month);
  const current = await knex('payroll_adjustments').where({ employee_id: employeeId, period_month: m, status: 'Approved' });
  const curBonus = current.filter((a) => a.category === 'BONUS').reduce((s, a) => s.plus(D(a.amount)), D(0));
  const curDed = current.filter((a) => a.category === 'OTHER_DEDUCTION').reduce((s, a) => s.plus(D(a.amount)), D(0));
  const results = [];
  for (const [target, cur, cat, type] of [[D(bonus), curBonus, 'BONUS', 'EARNING'], [D(otherDeduction), curDed, 'OTHER_DEDUCTION', 'DEDUCTION']]) {
    if (target.eq(cur)) continue;
    if (target.gt(cur)) {
      results.push(await create({ employeeId, periodMonth: m, adjustmentType: type, category: cat, amount: target.minus(cur).toFixed(2), reason, approveNow: true }, actor, ctx));
    } else {
      // Reduce: cancel the newest approved adjustments of that category, then re-add any remainder.
      let toRemove = cur.minus(target);
      for (const a of current.filter((x) => x.category === cat).sort((x, y) => y.id - x.id)) {
        if (toRemove.lte(0)) break;
        await decide(a.id, 'cancel', actor, { ...ctx, note: reason });
        toRemove = toRemove.minus(D(a.amount));
      }
      if (toRemove.lt(0)) {
        results.push(await create({ employeeId, periodMonth: m, adjustmentType: type, category: cat, amount: toRemove.abs().toFixed(2), reason, approveNow: true }, actor, ctx));
      }
    }
  }
  return results;
}

module.exports = { list, create, decide, setBonusAndDeduction, CATEGORIES };
