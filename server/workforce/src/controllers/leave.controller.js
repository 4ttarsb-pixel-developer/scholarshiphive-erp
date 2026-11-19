'use strict';
const knex = require('../db');
const svc = require('../services/leave.service');
const { ctx, run, idParam } = require('./helpers');
const { badRequest } = require('../utils/errors');

const list = async (req, res) => res.json(await svc.list({
  status: req.query.status, employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined,
  month: req.query.month ? `${String(req.query.month).slice(0, 7)}-01` : undefined, search: req.query.search,
}));

async function create(req, res) {
  const b = req.body || {};
  const employeeId = idParam(b.employeeId, 'employeeId');
  const user = await knex('users').where({ employee_id: employeeId }).first();
  const c = ctx(req);
  await run(res, c, () => svc.apply({
    employeeId, userId: user ? user.id : null, username: user ? user.username : null, leaveType: b.leaveType,
    startDate: b.startDate, endDate: b.endDate, halfDay: b.halfDay, reason: b.reason, source: 'web',
  }, req.user, c), 201);
}

async function approve(req, res) {
  const c = ctx(req);
  await run(res, c, () => svc.decide(idParam(req.params.id), { decision: 'Approved', payType: (req.body || {}).payType, note: (req.body || {}).note }, req.user, c));
}
async function reject(req, res) {
  const note = (req.body || {}).note;
  if (!note || String(note).trim().length < 5) throw badRequest('A rejection reason of at least 5 characters is required.');
  const c = ctx(req);
  await run(res, c, () => svc.decide(idParam(req.params.id), { decision: 'Rejected', note }, req.user, c));
}
async function cancel(req, res) {
  const c = ctx(req);
  await run(res, c, () => svc.cancel(idParam(req.params.id), req.user, c));
}
module.exports = { list, create, approve, reject, cancel };
