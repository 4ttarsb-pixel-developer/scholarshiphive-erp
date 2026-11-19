'use strict';
const knex = require('../db');
const { policyFor, accountingMonthFor } = require('./policy.service');
const payroll = require('./payroll.service');
const { audit } = require('./audit.service');
const { D, commissionFor, isValidMoneyInput } = require('../utils/money');
const { isValidDate } = require('../utils/time');
const { badRequest, conflict, notFound, forbidden } = require('../utils/errors');

const METHODS = ['FIXED_EMPLOYEE', 'MANUAL_PERCENT'];

function validRate(v) {
  return v !== undefined && v !== null && v !== '' && /^\d{1,3}(\.\d{1,3})?$/.test(String(v).trim()) && D(v).gte(0) && D(v).lte(100);
}

async function fixedRateFor(employeeId, db) {
  const row = await db('commission_settings').where({ employee_id: employeeId }).first();
  return row ? String(row.fixed_rate_percent) : null;
}

/** Resolve the percentage the server will apply (client-sent fixed rates are ignored). */
async function resolveRate({ employeeId, method, manualRatePercent }, db) {
  if (!METHODS.includes(method)) throw badRequest('Commission method must be FIXED_EMPLOYEE or MANUAL_PERCENT.');
  if (method === 'FIXED_EMPLOYEE') {
    const rate = await fixedRateFor(employeeId, db);
    if (rate === null) throw badRequest('This employee has no fixed commission percentage configured. Set it in Commission Settings or choose Manual Percentage.');
    return rate;
  }
  if (!validRate(manualRatePercent)) throw badRequest('Enter a valid manual commission percentage (0–100, up to 3 decimals).');
  const policy = await policyFor(new Date().toISOString().slice(0, 10), db);
  if (D(manualRatePercent).gt(D(policy.maxManualCommissionPercent))) {
    throw badRequest(`Manual percentage cannot exceed the policy maximum of ${policy.maxManualCommissionPercent}%.`);
  }
  return D(manualRatePercent).toString();
}

async function upsertCommissionEntry(sale, db) {
  const existing = await db('commission_entries').where({ sale_id: sale.id }).first();
  const values = {
    employee_id: sale.employee_id, accounting_month: sale.accounting_month, sale_amount: sale.sale_amount,
    rate_percent: sale.applied_rate_percent, amount: sale.commission_amount, status: 'Earned', updated_at: new Date(),
  };
  if (existing) {
    if (existing.payroll_record_id) throw conflict('This sale is already included in approved payroll; use a payroll adjustment.');
    await db('commission_entries').where({ id: existing.id }).update(values);
  } else {
    await db('commission_entries').insert({ sale_id: sale.id, ...values });
  }
}

function saleDto(r) {
  return {
    id: r.id,
    saleReference: r.sale_reference,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.full_name,
    saleDate: r.sale_date,
    accountingMonth: r.accounting_month,
    saleAmount: r.sale_amount,
    units: r.units,
    commissionMethod: r.commission_method,
    appliedRatePercent: r.applied_rate_percent,
    commissionAmount: r.commission_amount,
    status: r.status,
    statusReason: r.status_reason,
    isDemo: r.is_demo,
    verifiedAtEntry: r.verified_at_entry,
    notes: r.notes,
    createdBy: r.created_by_name,
    createdAt: r.created_at,
    verifiedBy: r.verified_by_name,
    verifiedAt: r.verified_at,
    lockedInPayroll: !!r.payroll_record_id,
    version: r.version,
  };
}

function saleQuery(db = knex) {
  return db('revenue_sales as s')
    .join('employees as e', 'e.id', 's.employee_id')
    .leftJoin('users as cu', 'cu.id', 's.created_by')
    .leftJoin('users as vu', 'vu.id', 's.verified_by')
    .leftJoin('commission_entries as ce', 'ce.sale_id', 's.id')
    .select('s.*', 'e.employee_code', 'e.full_name', 'cu.full_name as created_by_name', 'vu.full_name as verified_by_name', 'ce.payroll_record_id');
}

function mapDbError(e) {
  if (e && e.code === '23505' && /ux_revenue_reference/.test(e.constraint || e.message)) {
    return conflict('A sale with this reference number already exists. Duplicate sales are not allowed.');
  }
  return e;
}

async function create(input, actor, { canVerify, ip, events }) {
  const employeeId = Number(input.employeeId);
  const saleReference = String(input.saleReference || '').trim();
  if (!Number.isInteger(employeeId)) throw badRequest('Select an employee.');
  if (saleReference.length < 3 || saleReference.length > 80 || !/^[A-Za-z0-9._\-/#]+$/.test(saleReference)) {
    throw badRequest('Sale reference must be 3–80 characters (letters, numbers, . _ - / #).');
  }
  if (!isValidDate(input.saleDate)) throw badRequest('Enter a valid sale date.');
  if (!isValidMoneyInput(input.saleAmount, { allowZero: false })) throw badRequest('Sale amount must be a positive PKR amount with up to 2 decimals.');
  const units = input.units === undefined || input.units === null || input.units === '' ? null : Number(input.units);
  if (units !== null && (!Number.isInteger(units) || units < 1 || units > 100000)) throw badRequest('Number of sales must be a whole number ≥ 1.');
  if (input.verifyNow && !canVerify) throw forbidden('You are not authorised to verify sales.');

  try {
    return await knex.transaction(async (trx) => {
      const emp = await trx('employees').where({ id: employeeId }).first();
      if (!emp) throw notFound('Employee not found.');
      if (emp.employment_status !== 'Active') throw badRequest('Revenue can only be recorded for active employees.');
      const rate = await resolveRate({ employeeId, method: input.commissionMethod, manualRatePercent: input.manualRatePercent }, trx);
      const policy = await policyFor(input.saleDate, trx);
      const month = accountingMonthFor(input.saleDate, policy.payrollCutoffDay);
      if (await payroll.isLocked(employeeId, month, trx)) {
        throw conflict(`Payroll for ${month.slice(0, 7)} is already approved for this employee. Record the sale in an open month or use a payroll adjustment.`);
      }
      const commission = commissionFor(input.saleAmount, rate).toFixed(2);
      const verify = !!input.verifyNow;
      const [sale] = await trx('revenue_sales').insert({
        sale_reference: saleReference, employee_id: employeeId, sale_date: input.saleDate, accounting_month: month,
        sale_amount: D(input.saleAmount).toFixed(2), units, commission_method: input.commissionMethod,
        applied_rate_percent: rate, commission_amount: commission, status: verify ? 'Verified' : 'Pending',
        is_demo: !!input.isDemo, verified_at_entry: verify, notes: input.notes ? String(input.notes).slice(0, 1000) : null,
        created_by: actor.id, verified_by: verify ? actor.id : null, verified_at: verify ? new Date() : null,
      }).returning('*');
      if (verify) await upsertCommissionEntry(sale, trx);
      await audit(trx, {
        actor, action: verify ? 'Sale recorded and verified' : 'Sale recorded', entityType: 'revenue_sale', entityId: sale.id, ip,
        detail: `${saleReference} · ${emp.full_name} (${emp.employee_code}) · PKR ${sale.sale_amount} × ${rate}% (${input.commissionMethod === 'FIXED_EMPLOYEE' ? 'fixed employee rate' : 'manual'}) = PKR ${commission}${verify ? ' · verified at entry' : ''}`,
        after: { status: sale.status, amount: sale.sale_amount, rate, commission },
      });
      await payroll.recalc(employeeId, month, trx);
      events.add('revenue.changed', { employeeId, month });
      events.add('payroll.changed', { employeeId, month });
      const full = await saleQuery(trx).where('s.id', sale.id).first();
      return saleDto(full);
    });
  } catch (e) { throw mapDbError(e); }
}

async function update(id, input, actor, { ip, events }) {
  try {
    return await knex.transaction(async (trx) => {
      const sale = await trx('revenue_sales').where({ id }).forUpdate().first();
      if (!sale) throw notFound('Sale not found.');
      if (!['Pending', 'Verified'].includes(sale.status)) throw conflict(`A ${sale.status} sale cannot be edited.`);
      if (input.version !== undefined && Number(input.version) !== sale.version) {
        throw conflict('This sale was changed by someone else. Reload and try again.');
      }
      const entry = await trx('commission_entries').where({ sale_id: id }).first();
      if (entry && entry.payroll_record_id) throw conflict('This sale is included in approved payroll; use a payroll adjustment.');

      const next = {
        employee_id: input.employeeId !== undefined ? Number(input.employeeId) : sale.employee_id,
        sale_date: input.saleDate !== undefined ? input.saleDate : sale.sale_date,
        sale_amount: input.saleAmount !== undefined ? input.saleAmount : sale.sale_amount,
        units: input.units !== undefined ? (input.units === '' || input.units === null ? null : Number(input.units)) : sale.units,
        commission_method: input.commissionMethod !== undefined ? input.commissionMethod : sale.commission_method,
        notes: input.notes !== undefined ? input.notes : sale.notes,
      };
      if (input.saleReference !== undefined && String(input.saleReference).trim() !== sale.sale_reference) {
        throw badRequest('The sale reference cannot be changed; cancel and re-enter the sale instead.');
      }
      if (!isValidDate(next.sale_date)) throw badRequest('Enter a valid sale date.');
      if (!isValidMoneyInput(next.sale_amount, { allowZero: false })) throw badRequest('Sale amount must be a positive PKR amount.');
      if (next.units !== null && (!Number.isInteger(next.units) || next.units < 1)) throw badRequest('Number of sales must be ≥ 1.');

      // Rate: a FIXED sale keeps its historical applied rate unless the employee or method changes.
      let rate = String(sale.applied_rate_percent);
      const methodChanged = next.commission_method !== sale.commission_method;
      const employeeChanged = next.employee_id !== sale.employee_id;
      if (next.commission_method === 'MANUAL_PERCENT' && (input.manualRatePercent !== undefined || methodChanged)) {
        rate = await resolveRate({ employeeId: next.employee_id, method: 'MANUAL_PERCENT', manualRatePercent: input.manualRatePercent }, trx);
      } else if (next.commission_method === 'FIXED_EMPLOYEE' && (methodChanged || employeeChanged)) {
        rate = await resolveRate({ employeeId: next.employee_id, method: 'FIXED_EMPLOYEE' }, trx);
      }
      const policy = await policyFor(next.sale_date, trx);
      const month = accountingMonthFor(next.sale_date, policy.payrollCutoffDay);
      if (await payroll.isLocked(next.employee_id, month, trx)) throw conflict(`Payroll for ${month.slice(0, 7)} is already approved for that employee.`);
      const emp = await trx('employees').where({ id: next.employee_id }).first();
      if (!emp) throw notFound('Employee not found.');

      const commission = commissionFor(next.sale_amount, rate).toFixed(2);
      const before = { employee_id: sale.employee_id, sale_date: sale.sale_date, amount: sale.sale_amount, rate: sale.applied_rate_percent, commission: sale.commission_amount };
      const [updated] = await trx('revenue_sales').where({ id }).update({
        ...next, sale_amount: D(next.sale_amount).toFixed(2), accounting_month: month, applied_rate_percent: rate,
        commission_amount: commission, version: sale.version + 1, updated_at: new Date(),
      }).returning('*');
      if (updated.status === 'Verified') await upsertCommissionEntry(updated, trx);
      await audit(trx, {
        actor, action: 'Sale edited', entityType: 'revenue_sale', entityId: id, ip, before,
        after: { employee_id: updated.employee_id, sale_date: updated.sale_date, amount: updated.sale_amount, rate, commission },
        detail: `${sale.sale_reference}: PKR ${sale.sale_amount} @ ${sale.applied_rate_percent}% → PKR ${updated.sale_amount} @ ${rate}% (commission ${sale.commission_amount} → ${commission}). Draft payroll recalculated; no duplicate commission created.`,
      });
      await payroll.recalc(sale.employee_id, sale.accounting_month, trx);
      if (employeeChanged || month !== sale.accounting_month) await payroll.recalc(updated.employee_id, month, trx);
      events.add('revenue.changed', { employeeId: updated.employee_id, month });
      events.add('payroll.changed', { employeeId: updated.employee_id, month });
      return saleDto(await saleQuery(trx).where('s.id', id).first());
    });
  } catch (e) { throw mapDbError(e); }
}

async function verify(id, actor, { ip, events }) {
  return knex.transaction(async (trx) => {
    const sale = await trx('revenue_sales').where({ id }).forUpdate().first();
    if (!sale) throw notFound('Sale not found.');
    if (sale.status === 'Verified') return saleDto(await saleQuery(trx).where('s.id', id).first()); // idempotent
    if (sale.status !== 'Pending') throw conflict(`Only Pending sales can be verified (current: ${sale.status}).`);
    const policy = await policyFor(sale.sale_date, trx);
    if (policy.revenueRequireSecondVerifier && sale.created_by === actor.id) {
      throw forbidden('Policy requires a different user to verify a sale than the one who recorded it.');
    }
    if (await payroll.isLocked(sale.employee_id, sale.accounting_month, trx)) {
      throw conflict(`Payroll for ${sale.accounting_month.slice(0, 7)} is already approved; this sale cannot be added to it. Use a payroll adjustment.`);
    }
    const [updated] = await trx('revenue_sales').where({ id }).update({
      status: 'Verified', verified_by: actor.id, verified_at: new Date(), version: sale.version + 1, updated_at: new Date(),
    }).returning('*');
    await upsertCommissionEntry(updated, trx);
    await audit(trx, { actor, action: 'Sale verified', entityType: 'revenue_sale', entityId: id, ip, detail: `${sale.sale_reference} · commission PKR ${sale.commission_amount}` });
    await payroll.recalc(sale.employee_id, sale.accounting_month, trx);
    events.add('revenue.changed', { employeeId: sale.employee_id, month: sale.accounting_month });
    events.add('payroll.changed', { employeeId: sale.employee_id, month: sale.accounting_month });
    return saleDto(await saleQuery(trx).where('s.id', id).first());
  });
}

/** Reject a Pending sale, or Cancel/reverse a Pending or Verified sale. */
async function changeStatus(id, actor, { to, reason, ip, events }) {
  if (!reason || String(reason).trim().length < 5) throw badRequest('A reason of at least 5 characters is required.');
  return knex.transaction(async (trx) => {
    const sale = await trx('revenue_sales').where({ id }).forUpdate().first();
    if (!sale) throw notFound('Sale not found.');
    if (to === 'Rejected' && sale.status !== 'Pending') throw conflict('Only Pending sales can be rejected. Use Cancel to reverse a verified sale.');
    if (to === 'Cancelled' && !['Pending', 'Verified'].includes(sale.status)) throw conflict(`A ${sale.status} sale cannot be cancelled.`);
    const entry = await trx('commission_entries').where({ sale_id: id }).first();
    let adjustment = null;
    if (entry && entry.status === 'Earned') {
      if (entry.payroll_record_id) {
        // Commission already paid in approved payroll: never rewrite history. Raise a pending
        // reversal adjustment in the employee's next open month for explicit authorisation.
        const month = await payroll.nextOpenMonth(sale.employee_id, sale.accounting_month, trx);
        [adjustment] = await trx('payroll_adjustments').insert({
          employee_id: sale.employee_id, period_month: month, adjustment_type: 'DEDUCTION', category: 'COMMISSION_REVERSAL',
          amount: entry.amount, reason: `Reversal of commission for cancelled sale ${sale.sale_reference}: ${String(reason).trim()}`,
          status: 'Pending', source_ref: `sale:${sale.id}:reversal`, created_by: actor.id,
        }).returning('*');
        await payroll.recalc(sale.employee_id, month, trx);
        events.add('payroll.changed', { employeeId: sale.employee_id, month });
      } else {
        await trx('commission_entries').where({ id: entry.id }).update({ status: 'Reversed', updated_at: new Date() });
      }
    }
    await trx('revenue_sales').where({ id }).update({ status: to, status_reason: String(reason).trim(), version: sale.version + 1, updated_at: new Date() });
    await audit(trx, {
      actor, action: `Sale ${to.toLowerCase()}`, entityType: 'revenue_sale', entityId: id, ip,
      detail: `${sale.sale_reference}: ${String(reason).trim()}${adjustment ? ` · pending reversal adjustment #${adjustment.id} created in ${adjustment.period_month.slice(0, 7)}` : ''}`,
    });
    if (!entry || !entry.payroll_record_id) await payroll.recalc(sale.employee_id, sale.accounting_month, trx);
    events.add('revenue.changed', { employeeId: sale.employee_id, month: sale.accounting_month });
    events.add('payroll.changed', { employeeId: sale.employee_id, month: sale.accounting_month });
    return { sale: saleDto(await saleQuery(trx).where('s.id', id).first()), adjustment };
  });
}

async function list({ month, employeeId, status, search, limit = 500, offset = 0 } = {}) {
  const q = saleQuery().orderBy([{ column: 's.sale_date', order: 'desc' }, { column: 's.id', order: 'desc' }]);
  if (month) q.where('s.accounting_month', month);
  if (employeeId) q.where('s.employee_id', employeeId);
  if (status) q.where('s.status', status);
  if (search) {
    const like = `%${String(search).toLowerCase()}%`;
    q.where((w) => w.whereRaw('lower(s.sale_reference) like ?', [like]).orWhereRaw('lower(e.full_name) like ?', [like]).orWhereRaw('lower(e.employee_code) like ?', [like]));
  }
  const rows = await q.limit(Math.min(Number(limit) || 500, 2000)).offset(Number(offset) || 0);
  return rows.map(saleDto);
}

async function commissionSummary(month) {
  const rows = await knex('employees as e')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('commission_settings as cs', 'cs.employee_id', 'e.id')
    .where((q) => q.where('e.employment_status', 'Active').orWhereExists(
      knex('revenue_sales').whereRaw('revenue_sales.employee_id = e.id').where('accounting_month', month),
    ))
    .orderBy('e.employee_code')
    .select('e.id', 'e.employee_code', 'e.full_name', 'e.is_demo', 'd.name as department', 'cs.fixed_rate_percent', 'cs.updated_at as rate_updated_at');
  const agg = await knex('revenue_sales').where({ accounting_month: month })
    .groupBy('employee_id', 'status').select('employee_id', 'status').count('* as n').sum('sale_amount as revenue').sum('commission_amount as commission');
  const earned = await knex('commission_entries').where({ accounting_month: month, status: 'Earned' })
    .groupBy('employee_id').select('employee_id').sum('amount as amount');
  return rows.map((e) => {
    const mine = agg.filter((a) => a.employee_id === e.id);
    const v = mine.find((a) => a.status === 'Verified');
    const p = mine.find((a) => a.status === 'Pending');
    const er = earned.find((x) => x.employee_id === e.id);
    return {
      employeeId: e.id, employeeCode: e.employee_code, fullName: e.full_name, department: e.department || '', isDemo: e.is_demo,
      fixedRatePercent: e.fixed_rate_percent === null || e.fixed_rate_percent === undefined ? null : D(e.fixed_rate_percent).toString(),
      rateUpdatedAt: e.rate_updated_at,
      verifiedSales: v ? Number(v.n) : 0,
      verifiedRevenue: v ? D(v.revenue).toFixed(2) : '0.00',
      pendingSales: p ? Number(p.n) : 0,
      pendingCommission: p ? D(p.commission).toFixed(2) : '0.00',
      earnedCommission: er ? D(er.amount).toFixed(2) : '0.00',
    };
  });
}

async function getSettings(employeeId) {
  const emp = await knex('employees').where({ id: employeeId }).first();
  if (!emp) throw notFound('Employee not found.');
  const s = await knex('commission_settings').where({ employee_id: employeeId }).first();
  const history = await knex('commission_rate_history as h').leftJoin('users as u', 'u.id', 'h.changed_by')
    .where('h.employee_id', employeeId).orderBy('h.changed_at', 'desc').limit(50)
    .select('h.old_rate', 'h.new_rate', 'h.reason', 'h.changed_at', 'u.full_name as changed_by')
    .then((rows) => rows.map((r) => ({ ...r, old_rate: r.old_rate === null ? null : D(r.old_rate).toString(), new_rate: D(r.new_rate).toString() })));
  return {
    employeeId, employeeCode: emp.employee_code, fullName: emp.full_name,
    fixedRatePercent: s ? D(s.fixed_rate_percent).toString() : null, updatedAt: s ? s.updated_at : null, history,
  };
}

async function putSettings(employeeId, { fixedRatePercent, reason }, actor, { ip, events }) {
  if (!validRate(fixedRatePercent)) throw badRequest('Fixed commission must be a percentage between 0 and 100 (up to 3 decimals).');
  if (!reason || String(reason).trim().length < 5) throw badRequest('Give a reason (at least 5 characters) for the rate change.');
  return knex.transaction(async (trx) => {
    const emp = await trx('employees').where({ id: employeeId }).first();
    if (!emp) throw notFound('Employee not found.');
    const old = await trx('commission_settings').where({ employee_id: employeeId }).forUpdate().first();
    const rate = D(fixedRatePercent).toString();
    if (old && D(old.fixed_rate_percent).eq(D(rate))) return getSettings(employeeId);
    await trx('commission_settings').insert({ employee_id: employeeId, fixed_rate_percent: rate, updated_by: actor.id, updated_at: new Date() })
      .onConflict('employee_id').merge(['fixed_rate_percent', 'updated_by', 'updated_at']);
    await trx('commission_rate_history').insert({ employee_id: employeeId, old_rate: old ? old.fixed_rate_percent : null, new_rate: rate, reason: String(reason).trim(), changed_by: actor.id });
    await audit(trx, {
      actor, action: 'Fixed commission rate changed', entityType: 'employee', entityId: employeeId, ip,
      detail: `${emp.full_name} (${emp.employee_code}): ${old ? `${old.fixed_rate_percent}%` : 'not set'} → ${rate}%. Applies to new sales only; existing sales keep their applied rate. Reason: ${String(reason).trim()}`,
    });
    events.add('commission.settings', { employeeId });
    return null;
  }).then((r) => r || getSettings(employeeId));
}

module.exports = { METHODS, create, update, verify, changeStatus, list, commissionSummary, getSettings, putSettings, saleDto, saleQuery, fixedRateFor };
