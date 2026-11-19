'use strict';
const svc = require('../services/revenue.service');
const { can } = require('../middleware/auth');
const { ctx, run, idParam, monthParam } = require('./helpers');
const { sendCsv } = require('../utils/csv');

const list = async (req, res) => res.json(await svc.list({
  month: req.query.month ? monthParam(req.query.month) : undefined,
  employeeId: req.query.employeeId && req.query.employeeId !== 'all' ? Number(req.query.employeeId) : undefined,
  status: req.query.status || undefined, search: req.query.search,
}));

async function create(req, res) {
  const c = ctx(req, { canVerify: can(req.user, 'revenue.verify') });
  await run(res, c, () => svc.create(req.body || {}, req.user, c), 201);
}
async function update(req, res) {
  const c = ctx(req);
  await run(res, c, () => svc.update(idParam(req.params.id), req.body || {}, req.user, c));
}
async function verify(req, res) {
  const c = ctx(req);
  await run(res, c, () => svc.verify(idParam(req.params.id), req.user, c));
}
async function reject(req, res) {
  const c = ctx(req);
  await run(res, c, () => svc.changeStatus(idParam(req.params.id), req.user, { ...c, to: 'Rejected', reason: (req.body || {}).reason }));
}
async function cancel(req, res) {
  const c = ctx(req);
  await run(res, c, () => svc.changeStatus(idParam(req.params.id), req.user, { ...c, to: 'Cancelled', reason: (req.body || {}).reason }));
}
async function exportCsv(req, res) {
  const month = req.query.month ? monthParam(req.query.month) : undefined;
  const rows = await svc.list({ month, limit: 2000 });
  sendCsv(res, `revenue_${month ? month.slice(0, 7) : 'all'}.csv`, [
    ['Reference', 'Employee Code', 'Employee', 'Sale Date', 'Accounting Month', 'Sale Amount (PKR)', 'Units', 'Commission Method', 'Applied %', 'Commission (PKR)', 'Status', 'Demo', 'Created By', 'Verified By'],
    ...rows.map((s) => [s.saleReference, s.employeeCode, s.employeeName, s.saleDate, s.accountingMonth.slice(0, 7), s.saleAmount, s.units ?? '',
      s.commissionMethod === 'FIXED_EMPLOYEE' ? 'Fixed Employee Commission' : 'Manual Percentage', s.appliedRatePercent, s.commissionAmount, s.status, s.isDemo ? 'DEMO' : '', s.createdBy || '', s.verifiedBy || '']),
  ]);
}

async function commissions(req, res) {
  const month = monthParam(req.query.month);
  const summary = await svc.commissionSummary(month);
  const entries = await svc.list({ month, status: 'Verified' });
  res.json({ month, summary, entries });
}
async function employeeCommissions(req, res) {
  const employeeId = idParam(req.params.id);
  const month = req.query.month ? monthParam(req.query.month) : undefined;
  res.json(await svc.list({ employeeId, month }));
}
const getSettings = async (req, res) => res.json(await svc.getSettings(idParam(req.params.employeeId)));
async function putSettings(req, res) {
  const c = ctx(req);
  await run(res, c, () => svc.putSettings(idParam(req.params.employeeId), req.body || {}, req.user, c));
}
module.exports = { list, create, update, verify, reject, cancel, exportCsv, commissions, employeeCommissions, getSettings, putSettings };
