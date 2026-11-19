'use strict';
const svc = require('../services/advance.service');
const { can } = require('../middleware/auth');
const { ctx, run, idParam } = require('./helpers');
const { forbidden } = require('../utils/errors');

const list = async (req, res) => res.json(await svc.list({ status: req.query.status, employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined }));
async function forEmployee(req, res) {
  const employeeId = idParam(req.params.id);
  if (!can(req.user, 'advances.view') && req.user.employeeId !== employeeId) throw forbidden();
  res.json(await svc.list({ employeeId }));
}
async function create(req, res) {
  const c = ctx(req, { canApprove: can(req.user, 'advances.approve') });
  await run(res, c, () => svc.create(req.body || {}, req.user, c), 201);
}
async function decide(req, res) {
  const c = ctx(req);
  await run(res, c, () => svc.decide(idParam(req.params.id), req.params.decision, req.user, { ...c, note: (req.body || {}).note }));
}
module.exports = { list, forEmployee, create, decide };
