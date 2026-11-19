'use strict';
const knex = require('../db');
const svc = require('../services/payroll.service');
const adjustments = require('../services/adjustment.service');
const events = require('../services/events.service');
const { can } = require('../middleware/auth');
const { ctx, run, idParam, idList, monthParam } = require('./helpers');
const { clientIp } = require('../utils/request');
const { sendCsv } = require('../utils/csv');
const { isValidDate } = require('../utils/time');
const { forbidden, badRequest, notFound } = require('../utils/errors');

const list = async (req, res) => {
  const month = monthParam(req.query.month);
  const { period, records } = await svc.listMonth(month);
  const q = String(req.query.search || '').toLowerCase();
  const filtered = records.filter((r) => (!req.query.status || r.status === req.query.status)
    && (!q || `${r.fullName} ${r.employeeCode} ${r.department}`.toLowerCase().includes(q)));
  res.json({ period, records: filtered });
};

async function forEmployee(req, res) {
  const employeeId = idParam(req.params.employeeId, 'employee id');
  if (!can(req.user, 'payroll.view') && req.user.employeeId !== employeeId) throw forbidden();
  const month = monthParam(req.query.month);
  const rec = await svc.recalc(employeeId, month);
  if (!rec) throw notFound('No payroll for this employee in that month.');
  const detail = await svc.getRecord(rec.id, { refresh: false });
  if (!can(req.user, 'payroll.view') && !['Approved', 'Paid'].includes(detail.status)) detail.statementType = 'Draft (provisional)';
  res.json(detail);
}

async function payslip(req, res) {
  const id = idParam(req.params.id);
  const row = await knex('payroll_records').where({ id }).first();
  if (!row) throw notFound('Payroll record not found.');
  if (!can(req.user, 'payroll.view') && req.user.employeeId !== row.employee_id) throw forbidden();
  const detail = await svc.getRecord(id);
  detail.official = ['Approved', 'Paid'].includes(detail.status);
  res.json(detail);
}

async function calculate(req, res) {
  const month = monthParam((req.body || {}).month);
  const ids = (req.body || {}).employeeIds;
  if (Array.isArray(ids) && ids.length) {
    for (const id of idList(ids)) await svc.recalc(id, month);
  } else {
    await svc.refreshMonth(month, { maxAgeMs: 0 });
  }
  events.publish('payroll.changed', { month });
  const { period, records } = await svc.listMonth(month);
  res.json({ success: true, period, records });
}

/** Preview which selected records are eligible and which are blocked (no changes made). */
async function approvePreview(req, res) {
  const ids = idList((req.body || {}).ids);
  const rows = await knex('payroll_records as r').join('payroll_periods as p', 'p.id', 'r.period_id').whereIn('r.id', ids).select('r.id', 'r.employee_id', 'p.period_month', 'r.status');
  const out = [];
  for (const r of rows) {
    if (!['Draft', 'UnderReview'].includes(r.status)) { out.push({ id: r.id, eligible: false, reasons: [`Status is ${r.status}`] }); continue; }
    const fresh = await svc.recalc(r.employee_id, r.period_month);
    const blockers = fresh._calc ? fresh._calc.blockers : [];
    const emp = await knex('employees').where({ id: r.employee_id }).first('full_name', 'employee_code');
    out.push({ id: r.id, employeeName: emp.full_name, employeeCode: emp.employee_code, net: fresh.net_salary, eligible: blockers.length === 0, reasons: blockers.map((b) => b.message) });
  }
  res.json({ eligible: out.filter((x) => x.eligible), blocked: out.filter((x) => !x.eligible) });
}

async function approveBulk(req, res) {
  const ids = idList((req.body || {}).ids);
  const results = await svc.approveMany(ids, req.user, (req.body || {}).note, clientIp(req));
  events.publish('payroll.changed', {});
  events.publish('advances.changed', {});
  res.json({ success: true, approved: results.filter((r) => r.ok), blocked: results.filter((r) => !r.ok) });
}

async function rejectBulk(req, res) {
  const ids = idList((req.body || {}).ids);
  const results = await svc.rejectMany(ids, req.user, (req.body || {}).reason, clientIp(req));
  events.publish('payroll.changed', {});
  res.json({ success: true, rejected: results.filter((r) => r.ok), skipped: results.filter((r) => !r.ok) });
}

async function submit(req, res) {
  await svc.submitForReview(idParam(req.params.id), req.user, (req.body || {}).note, clientIp(req));
  events.publish('payroll.changed', {});
  res.json({ success: true });
}
async function reopen(req, res) {
  await svc.reopen(idParam(req.params.id), req.user, (req.body || {}).note, clientIp(req));
  events.publish('payroll.changed', {});
  res.json({ success: true });
}

const METHODS = ['Bank Transfer', 'Cash', 'Cheque', 'Mobile Wallet', 'Other'];
async function markPaid(req, res) {
  const b = req.body || {};
  if (!isValidDate(b.paymentDate)) throw badRequest('Payment date is required.');
  if (!METHODS.includes(b.paymentMethod)) throw badRequest(`Payment method must be one of: ${METHODS.join(', ')}.`);
  if (!b.paymentReference || String(b.paymentReference).trim().length < 3) throw badRequest('Payment reference (min 3 characters) is required.');
  const key = req.get('idempotency-key') || b.idempotencyKey || null;
  const r = await svc.markPaid(idParam(req.params.id), req.user, { ...b, idempotencyKey: key }, clientIp(req));
  events.publish('payroll.changed', {});
  res.json({ success: true, replay: r.replay, payment: r.payment });
}

async function exportCsv(req, res) {
  const month = monthParam(req.query.month);
  const { records } = await svc.listMonth(month);
  sendCsv(res, `payroll_${month.slice(0, 7)}.csv`, [
    ['Employee Code', 'Name', 'Department', 'Status', 'Base Salary', 'Scheduled Days', 'Present Days', 'Absent Days', 'Paid Leave', 'Unpaid Leave', 'Late Minutes',
      'Verified Revenue', 'Commission', 'Bonus', 'Gross Earnings', 'Attendance Deductions', 'Unpaid Leave Deduction', 'Advance Recovery', 'Other Deductions',
      'Total Deductions', 'Net Salary', 'Blockers', 'Approved At', 'Paid At', 'Payment Ref', 'Demo'],
    ...records.map((r) => [r.employeeCode, r.fullName, r.department, r.status, r.baseSalary, r.scheduledDays, r.presentDays, r.absentDays, r.paidLeaveDays, r.unpaidLeaveDays,
      r.lateMinutes, r.revenueTotal, r.commissionTotal, r.bonusTotal, r.grossEarnings, r.attendanceDeductions, r.unpaidLeaveDeduction, r.advanceRecovery,
      r.otherDeductions, r.totalDeductions, r.netSalary, r.blockers.map((b) => b.message).join(' | '), r.approvedAt || '', r.paidAt || '', r.payment?.reference || '', r.isDemo ? 'DEMO' : '']),
  ]);
}

// ---- adjustments
const listAdjustments = async (req, res) => res.json(await adjustments.list({
  month: req.query.month ? monthParam(req.query.month) : undefined, employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined, status: req.query.status,
}));
async function createAdjustment(req, res) {
  const c = ctx(req, { canApprove: can(req.user, 'payroll.approve') });
  await run(res, c, () => adjustments.create(req.body || {}, req.user, c), 201);
}
async function decideAdjustment(req, res) {
  const c = ctx(req);
  await run(res, c, () => adjustments.decide(idParam(req.params.id), req.params.decision, req.user, { ...c, note: (req.body || {}).note }));
}
async function bonusDeduction(req, res) {
  const id = idParam(req.params.id);
  const r = await knex('payroll_records as r').join('payroll_periods as p', 'p.id', 'r.period_id').where('r.id', id).first('r.employee_id', 'p.period_month', 'r.status');
  if (!r) throw notFound('Payroll record not found.');
  const c = ctx(req, { canApprove: true });
  await run(res, c, () => adjustments.setBonusAndDeduction(r.employee_id, r.period_month, req.body || {}, req.user, c));
}

module.exports = { list, forEmployee, payslip, calculate, approvePreview, approveBulk, rejectBulk, submit, reopen, markPaid, exportCsv, listAdjustments, createAdjustment, decideAdjustment, bonusDeduction };
