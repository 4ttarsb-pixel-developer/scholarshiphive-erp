'use strict';
const knex = require('../db');
const { policyFor, periodBounds, accountingMonthFor } = require('./policy.service');
const attendance = require('./attendance.service');
const { calculatePayroll } = require('./payroll-engine');
const { audit } = require('./audit.service');
const { monthStart, todayInTz, addDays } = require('../utils/time');
const { D, round2 } = require('../utils/money');
const { conflict, notFound, badRequest } = require('../utils/errors');
const config = require('../config');

const LOCKED = ['Approved', 'Paid'];
const OPEN = ['Draft', 'UnderReview', 'Rejected'];

async function withTx(db, fn) {
  if (db && db.isTransaction) return fn(db);
  return knex.transaction(fn);
}

async function ensurePeriod(month, db = knex) {
  const m = monthStart(month);
  let p = await db('payroll_periods').where({ period_month: m }).first();
  if (!p) {
    const policy = await policyFor(m, db);
    const { start, end } = periodBounds(m, policy.payrollCutoffDay);
    await db('payroll_periods').insert({ period_month: m, start_date: start, end_date: end }).onConflict('period_month').ignore();
    p = await db('payroll_periods').where({ period_month: m }).first();
  }
  return p;
}

/** Month a given business date belongs to (respects cutoff). */
async function monthForDate(date, db = knex) {
  const policy = await policyFor(date, db);
  return accountingMonthFor(date, policy.payrollCutoffDay);
}

async function isLocked(employeeId, month, db = knex) {
  const m = monthStart(month);
  const r = await db('payroll_records as r').join('payroll_periods as p', 'p.id', 'r.period_id')
    .where({ 'r.employee_id': employeeId, 'p.period_month': m }).whereIn('r.status', LOCKED).first('r.id');
  return !!r;
}

async function assertNotLocked(employeeId, date, db = knex, what = 'This change') {
  const month = await monthForDate(date, db);
  if (await isLocked(employeeId, month, db)) {
    throw conflict(`${what} affects ${month.slice(0, 7)}, whose payroll is already approved. Use an authorised payroll adjustment instead.`);
  }
  return month;
}

function employedDuring(e, period) {
  return e.joining_date <= period.end_date && (!e.leaving_date || e.leaving_date >= period.start_date);
}

async function gatherInputs(employeeId, period, db) {
  const month = period.period_month;
  const { days, policy, employee, pendingCorrections } = await attendance.recomputeRange(employeeId, period.start_date, period.end_date, db);
  const commissions = await db('commission_entries as c').join('revenue_sales as s', 's.id', 'c.sale_id')
    .where({ 'c.employee_id': employeeId, 'c.accounting_month': month, 'c.status': 'Earned' })
    .orderBy('s.sale_date')
    .select('c.*', 's.sale_reference', 's.sale_date', 's.commission_method');
  const sales = await db('revenue_sales').where({ employee_id: employeeId, accounting_month: month });
  const adjustments = await db('payroll_adjustments').where({ employee_id: employeeId, period_month: month }).whereIn('status', ['Pending', 'Approved']);
  const advances = await db('salary_advances').where({ employee_id: employeeId, status: 'Active' })
    .where('recovery_start_month', '<=', month).where('remaining_balance', '>', 0).orderBy('id');
  return { days, policy, employee, pendingCorrections, commissions, sales, adjustments, advances };
}

/**
 * Recalculate one employee-month. Approved/Paid records are never touched.
 * Serialised per employee with a transaction-scoped advisory lock.
 */
async function recalc(employeeId, month, db = knex) {
  return withTx(db, async (trx) => {
    const period = await ensurePeriod(month, trx);
    await trx.raw('SELECT pg_advisory_xact_lock(?, ?)', [91001, employeeId]);
    const existing = await trx('payroll_records').where({ period_id: period.id, employee_id: employeeId }).forUpdate().first();
    if (existing && LOCKED.includes(existing.status)) return existing;
    const emp = await trx('employees').where({ id: employeeId }).first();
    if (!emp || !employedDuring(emp, period)) return existing || null;

    const inputs = await gatherInputs(employeeId, period, trx);
    const tz = inputs.policy.timezone || config.businessTimezone;
    const calc = calculatePayroll({
      employee: inputs.employee,
      period: { month: period.period_month, start: period.start_date, end: period.end_date },
      policy: inputs.policy,
      days: inputs.days,
      commissions: inputs.commissions,
      sales: inputs.sales,
      adjustments: inputs.adjustments,
      advances: inputs.advances,
      pendingCorrections: inputs.pendingCorrections,
      today: todayInTz(tz),
    });
    const values = {
      ...calc.totals,
      blockers: JSON.stringify(calc.blockers),
      warnings: JSON.stringify(calc.warnings),
      policy_id: inputs.policy.id,
      calculated_at: new Date(),
      updated_at: new Date(),
    };
    let record;
    if (existing) {
      [record] = await trx('payroll_records').where({ id: existing.id }).update({ ...values, version: existing.version + 1 }).returning('*');
    } else {
      [record] = await trx('payroll_records').insert({ period_id: period.id, employee_id: employeeId, status: 'Draft', ...values }).returning('*');
    }
    await trx('payroll_line_items').where({ payroll_record_id: record.id }).del();
    if (calc.lines.length) {
      await trx('payroll_line_items').insert(calc.lines.map((l) => ({
        payroll_record_id: record.id, line_type: l.line_type, code: l.code, description: l.description,
        quantity: l.quantity ?? null, rate: l.rate ?? null, amount: l.amount,
        source_table: l.source_table || null, source_id: l.source_id || null, sort_order: l.sort_order,
      })));
    }
    record._calc = calc;
    record._inputs = inputs;
    return record;
  });
}

/** Recalculate the payroll month that contains `date` for this employee (no-op if locked). */
async function recalcForDate(employeeId, date, db = knex) {
  if (!employeeId) return null;
  const month = await monthForDate(date, db);
  return recalc(employeeId, month, db);
}

/** Recalculate every payroll month touched by the given dates. */
async function recalcDates(employeeId, dates, db = knex) {
  if (!employeeId) return;
  const months = new Set();
  for (const d of dates) months.add(await monthForDate(d, db));
  for (const m of months) await recalc(employeeId, m, db);
}

async function eligibleEmployees(period, db = knex) {
  const rows = await db('employees')
    .where('joining_date', '<=', period.end_date)
    .where((q) => q.whereNull('leaving_date').orWhere('leaving_date', '>=', period.start_date))
    .where((q) => q.where('employment_status', 'Active')
      .orWhereExists(db('payroll_records').whereRaw('payroll_records.employee_id = employees.id').where('period_id', period.id)))
    .orderBy('employee_code');
  return rows;
}

/** Ensure + refresh all records of a month. Records younger than maxAgeMs are not recomputed. */
async function refreshMonth(month, { maxAgeMs = 15000 } = {}) {
  const period = await ensurePeriod(month);
  const emps = await eligibleEmployees(period);
  const recs = await knex('payroll_records').where({ period_id: period.id });
  const byEmp = new Map(recs.map((r) => [r.employee_id, r]));
  for (const e of emps) {
    const r = byEmp.get(e.id);
    if (r && LOCKED.includes(r.status)) continue;
    if (r && r.calculated_at && Date.now() - new Date(r.calculated_at).getTime() < maxAgeMs) continue;
    await recalc(e.id, period.period_month);
  }
  return period;
}

const num = (v) => String(Number(v));

function shapeRecord(r) {
  const snap = r.snapshot && typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot;
  const locked = LOCKED.includes(r.status);
  const src = locked && snap ? snap.totals : r;
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : (v || []));
  return {
    id: r.id,
    periodMonth: r.period_month,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    fullName: r.full_name,
    department: r.department_name || '',
    designation: r.designation || '',
    isDemo: !!r.is_demo,
    status: r.status,
    locked,
    baseSalary: src.base_salary,
    scheduledDays: num(src.scheduled_days),
    divisorDays: num(src.divisor_days),
    dailyRate: String(src.daily_rate),
    presentDays: num(src.present_days),
    absentDays: num(src.absent_days),
    paidLeaveDays: num(src.paid_leave_days),
    unpaidLeaveDays: num(src.unpaid_leave_days),
    lateMinutes: Number(src.late_minutes),
    earlyMinutes: Number(src.early_minutes),
    revenueTotal: src.revenue_total,
    commissionTotal: src.commission_total,
    bonusTotal: src.bonus_total,
    grossEarnings: src.gross_earnings,
    attendanceDeductions: src.attendance_deductions,
    unpaidLeaveDeduction: src.unpaid_leave_deduction,
    advanceRecovery: src.advance_recovery,
    otherDeductions: src.other_deductions,
    totalDeductions: src.total_deductions,
    netSalary: src.net_salary,
    blockers: locked ? [] : parse(r.blockers),
    warnings: locked ? [] : parse(r.warnings),
    calculatedAt: r.calculated_at,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by_name || null,
    rejectedAt: r.rejected_at,
    rejectionReason: r.rejection_reason,
    paidAt: r.paid_at,
    payment: r.payment_reference ? {
      date: r.payment_date, method: r.payment_method, reference: r.payment_reference, remarks: r.payment_remarks, paidBy: r.paid_by_name,
    } : null,
    version: r.version,
  };
}

function recordQuery(db = knex) {
  return db('payroll_records as r')
    .join('payroll_periods as p', 'p.id', 'r.period_id')
    .join('employees as e', 'e.id', 'r.employee_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('users as au', 'au.id', 'r.approved_by')
    .leftJoin('payment_records as pay', 'pay.payroll_record_id', 'r.id')
    .leftJoin('users as pu', 'pu.id', 'pay.paid_by')
    .select('r.*', 'p.period_month', 'p.start_date', 'p.end_date', 'e.employee_code', 'e.full_name', 'e.designation', 'e.is_demo', 'd.name as department_name',
      'au.full_name as approved_by_name', 'pay.payment_date', 'pay.payment_method', 'pay.payment_reference',
      'pay.remarks as payment_remarks', 'pu.full_name as paid_by_name');
}

async function listMonth(month, { employeeId } = {}) {
  const period = await refreshMonth(month);
  const q = recordQuery().where('r.period_id', period.id).orderBy('e.employee_code');
  if (employeeId) q.where('r.employee_id', employeeId);
  const rows = await q;
  return { period, records: rows.map(shapeRecord) };
}

async function getRecord(recordId, { refresh = true } = {}) {
  let row = await recordQuery().where('r.id', recordId).first();
  if (!row) throw notFound('Payroll record not found.');
  if (refresh && !LOCKED.includes(row.status)) {
    await recalc(row.employee_id, row.period_month);
    row = await recordQuery().where('r.id', recordId).first();
  }
  const shaped = shapeRecord(row);
  const snap = row.snapshot && typeof row.snapshot === 'string' ? JSON.parse(row.snapshot) : row.snapshot;
  if (shaped.locked && snap) {
    shaped.lines = snap.lines;
    shaped.attendanceSummary = snap.attendanceSummary;
    shaped.commissions = snap.commissions;
    shaped.policy = snap.policy;
    shaped.employee = snap.employee;
  } else {
    shaped.lines = await knex('payroll_line_items').where({ payroll_record_id: recordId }).orderBy('sort_order');
    const days = await knex('attendance_records').where({ employee_id: row.employee_id })
      .whereBetween('attendance_date', [row.start_date, row.end_date]);
    shaped.attendanceSummary = summariseDays(days);
    shaped.commissions = await knex('commission_entries as c').join('revenue_sales as s', 's.id', 'c.sale_id')
      .where({ 'c.employee_id': row.employee_id, 'c.accounting_month': row.period_month, 'c.status': 'Earned' })
      .select('s.sale_reference', 's.sale_date', 's.sale_amount', 'c.rate_percent', 'c.amount', 's.commission_method');
    shaped.policy = await policyFor(row.period_month);
  }
  shaped.approvals = await knex('payroll_approvals as a').leftJoin('users as u', 'u.id', 'a.actor_id')
    .where('a.payroll_record_id', recordId).orderBy('a.id').select('a.*', 'u.full_name as actor_name');
  return shaped;
}

function summariseDays(days) {
  const count = (s) => days.filter((d) => d.status === s).length;
  return {
    scheduled: days.filter((d) => !['Holiday', 'WeeklyOff', 'NotEmployed'].includes(d.status)).length,
    present: count('Present') + count('Late') + count('MissingCheckOut'),
    late: count('Late'),
    absent: count('Absent'),
    paidLeave: count('PaidLeave'),
    unpaidLeave: count('UnpaidLeave'),
    pendingLeave: count('PendingLeave'),
    missing: count('MissingCheckIn') + count('MissingCheckOut'),
    holidays: count('Holiday'),
    weeklyOff: count('WeeklyOff'),
    upcoming: count('Upcoming'),
    lateMinutes: days.reduce((a, d) => a + (d.late_minutes || 0), 0),
    workedSeconds: days.reduce((a, d) => a + (d.worked_seconds || 0), 0),
  };
}

// ---------------------------------------------------------------- workflow

async function lockRecord(recordId, trx) {
  const r = await trx('payroll_records').where({ id: recordId }).forUpdate().first();
  if (!r) throw notFound('Payroll record not found.');
  return r;
}

/**
 * Approve one record inside its own transaction: fresh recalculation, blocker
 * check, immutable snapshot, commission locking, advance recovery (exactly once).
 */
async function approveOne(recordId, actor, note, ip) {
  return knex.transaction(async (trx) => {
    const r = await lockRecord(recordId, trx);
    if (!['Draft', 'UnderReview'].includes(r.status)) {
      return { id: recordId, ok: false, reason: `Status is ${r.status}; only Draft or Under Review payroll can be approved.` };
    }
    const period = await trx('payroll_periods').where({ id: r.period_id }).first();
    const fresh = await recalc(r.employee_id, period.period_month, trx);
    const calc = fresh._calc;
    if (calc.blockers.length) {
      return { id: recordId, ok: false, reason: calc.blockers.map((b) => b.message).join('; '), blockers: calc.blockers };
    }
    const emp = await trx('employees as e').leftJoin('departments as d', 'd.id', 'e.department_id').where('e.id', r.employee_id)
      .first('e.id', 'e.employee_code', 'e.full_name', 'e.designation', 'd.name as department');
    const snapshot = {
      version: 1,
      approvedAt: new Date().toISOString(),
      approvedBy: { id: actor.id, name: actor.fullName },
      employee: emp,
      period: { month: period.period_month, start: period.start_date, end: period.end_date },
      totals: { ...calc.totals },
      lines: calc.lines,
      warnings: calc.warnings,
      attendanceSummary: summariseDays(fresh._inputs.days),
      commissions: fresh._inputs.commissions.map((c) => ({
        sale_reference: c.sale_reference, sale_date: c.sale_date, sale_amount: c.sale_amount, rate_percent: c.rate_percent,
        amount: c.amount, commission_method: c.commission_method,
      })),
      advances: fresh._inputs.advances.map((a) => ({ id: a.id, remaining_before: a.remaining_balance, monthly_recovery: a.monthly_recovery })),
      policy: fresh._inputs.policy,
    };
    const [approved] = await trx('payroll_records').where({ id: recordId }).update({
      status: 'Approved', snapshot: JSON.stringify(snapshot), approved_by: actor.id, approved_at: new Date(), updated_at: new Date(),
      version: fresh.version + 1,
    }).returning('*');
    await trx('payroll_approvals').insert({
      payroll_record_id: recordId, action: 'APPROVE', from_status: r.status, to_status: 'Approved', actor_id: actor.id,
      note: note || null, net_salary: calc.totals.net_salary,
    });
    // Lock the commission entries that were paid in this payroll.
    const commissionIds = fresh._inputs.commissions.map((c) => c.id);
    if (commissionIds.length) {
      await trx('commission_entries').whereIn('id', commissionIds).whereNull('payroll_record_id').update({ payroll_record_id: recordId, updated_at: new Date() });
    }
    // Recover advances exactly once (unique advance_id + payroll_record_id).
    for (const line of calc.lines.filter((l) => l.code === 'ADVANCE')) {
      const advanceId = Number(line.source_id);
      const adv = await trx('salary_advances').where({ id: advanceId }).forUpdate().first();
      const amount = round2(D(line.amount));
      const after = round2(D(adv.remaining_balance).minus(amount));
      if (after.lt(0)) throw conflict(`Advance #${advanceId} balance changed; recalculate and retry.`);
      await trx('advance_recoveries').insert({ advance_id: advanceId, payroll_record_id: recordId, amount: amount.toFixed(2), balance_after: after.toFixed(2) });
      await trx('salary_advances').where({ id: advanceId }).update({
        remaining_balance: after.toFixed(2), status: after.isZero() ? 'Settled' : 'Active', updated_at: new Date(),
      });
    }
    await audit(trx, {
      actor, action: 'Payroll approved', entityType: 'payroll_record', entityId: recordId, ip,
      detail: `${emp.full_name} (${emp.employee_code}) ${period.period_month.slice(0, 7)} net PKR ${calc.totals.net_salary}. Snapshot locked.`,
      after: { net: calc.totals.net_salary, commission: calc.totals.commission_total },
    });
    return { id: recordId, ok: true, employeeId: r.employee_id, net: approved.net_salary };
  });
}

async function approveMany(ids, actor, note, ip) {
  const results = [];
  for (const id of ids) {
    try {
      results.push(await approveOne(id, actor, note, ip));
    } catch (e) {
      results.push({ id, ok: false, reason: e.message });
    }
  }
  return results;
}

async function rejectMany(ids, actor, reason, ip) {
  if (!reason || reason.trim().length < 5) throw badRequest('A rejection reason of at least 5 characters is required.');
  const results = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const res = await knex.transaction(async (trx) => {
      const r = await trx('payroll_records').where({ id }).forUpdate().first();
      if (!r) return { id, ok: false, reason: 'Not found' };
      if (!['Draft', 'UnderReview'].includes(r.status)) return { id, ok: false, reason: `Status is ${r.status}` };
      await trx('payroll_records').where({ id }).update({
        status: 'Rejected', rejected_by: actor.id, rejected_at: new Date(), rejection_reason: reason.trim(), updated_at: new Date(),
      });
      await trx('payroll_approvals').insert({ payroll_record_id: id, action: 'REJECT', from_status: r.status, to_status: 'Rejected', actor_id: actor.id, note: reason.trim() });
      await audit(trx, { actor, action: 'Payroll rejected', entityType: 'payroll_record', entityId: id, detail: reason.trim(), ip });
      return { id, ok: true, employeeId: r.employee_id };
    });
    results.push(res);
  }
  return results;
}

async function simpleTransition(id, actor, { from, to, action, note, ip }) {
  return knex.transaction(async (trx) => {
    const r = await trx('payroll_records').where({ id }).forUpdate().first();
    if (!r) throw notFound('Payroll record not found.');
    if (!from.includes(r.status)) throw conflict(`Payroll is ${r.status}; cannot ${action.toLowerCase()}.`);
    await trx('payroll_records').where({ id }).update({
      status: to, updated_at: new Date(),
      ...(to === 'UnderReview' ? { submitted_by: actor.id, submitted_at: new Date() } : {}),
      ...(to === 'Draft' ? { rejected_by: null, rejected_at: null, rejection_reason: null } : {}),
    });
    await trx('payroll_approvals').insert({ payroll_record_id: id, action, from_status: r.status, to_status: to, actor_id: actor.id, note: note || null });
    await audit(trx, { actor, action: `Payroll ${action.toLowerCase()}`, entityType: 'payroll_record', entityId: id, detail: note || '', ip });
    return r;
  });
}

const submitForReview = (id, actor, note, ip) => simpleTransition(id, actor, { from: ['Draft'], to: 'UnderReview', action: 'SUBMIT', note, ip });
const reopen = (id, actor, note, ip) => simpleTransition(id, actor, { from: ['Rejected'], to: 'Draft', action: 'REOPEN', note, ip });

/** Record payment (no bank transfer). Idempotent on idempotencyKey; a record can be paid once. */
async function markPaid(id, actor, input, ip) {
  const { paymentDate, paymentMethod, paymentReference, remarks, idempotencyKey } = input;
  return knex.transaction(async (trx) => {
    const r = await trx('payroll_records').where({ id }).forUpdate().first();
    if (!r) throw notFound('Payroll record not found.');
    const existing = await trx('payment_records').where({ payroll_record_id: id }).first();
    if (existing) {
      if (idempotencyKey && existing.idempotency_key === idempotencyKey) return { record: r, payment: existing, replay: true };
      throw conflict('This payroll has already been marked as paid.');
    }
    if (r.status !== 'Approved') throw conflict(`Only Approved payroll can be marked paid (current: ${r.status}).`);
    const snap = typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot;
    const [payment] = await trx('payment_records').insert({
      payroll_record_id: id, amount: snap.totals.net_salary, payment_date: paymentDate, payment_method: paymentMethod,
      payment_reference: paymentReference.trim(), remarks: remarks || null, paid_by: actor.id, idempotency_key: idempotencyKey || null,
    }).returning('*');
    const [updated] = await trx('payroll_records').where({ id }).update({ status: 'Paid', paid_at: new Date(), updated_at: new Date() }).returning('*');
    await trx('payroll_approvals').insert({ payroll_record_id: id, action: 'MARK_PAID', from_status: 'Approved', to_status: 'Paid', actor_id: actor.id, note: paymentReference, net_salary: snap.totals.net_salary });
    await audit(trx, {
      actor, action: 'Payroll marked paid', entityType: 'payroll_record', entityId: id, ip,
      detail: `PKR ${snap.totals.net_salary} via ${paymentMethod}, ref ${paymentReference}. No bank transfer initiated.`,
    });
    return { record: updated, payment, replay: false };
  });
}

/** Next month whose payroll for this employee is not locked (for post-approval corrections). */
async function nextOpenMonth(employeeId, fromMonth, db = knex) {
  let m = monthStart(fromMonth);
  for (let i = 0; i < 24; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await isLocked(employeeId, m, db))) return m;
    m = monthStart(addDays(m, 32));
  }
  throw conflict('No open payroll month found in the next 24 months.');
}

module.exports = {
  LOCKED, OPEN, ensurePeriod, monthForDate, isLocked, assertNotLocked, recalc, recalcForDate, refreshMonth,
  listMonth, getRecord, recalcDates, approveMany, approveOne, rejectMany, submitForReview, reopen, markPaid, nextOpenMonth,
  summariseDays, shapeRecord, recordQuery,
};
