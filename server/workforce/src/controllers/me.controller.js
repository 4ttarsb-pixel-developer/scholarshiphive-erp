'use strict';
/** Employee self-service: own attendance, leave and payslips only. */
const knex = require('../db');
const payroll = require('../services/payroll.service');
const leaves = require('../services/leave.service');
const advances = require('../services/advance.service');
const att = require('./attendance.controller');
const { ctx, run, monthParam, idParam } = require('./helpers');
const { forbidden } = require('../utils/errors');

function ownEmployee(req) {
  if (!req.user.employeeId) throw forbidden('Your login is not linked to an employee record yet. Ask HR to map it.');
  return req.user.employeeId;
}

async function overview(req, res) {
  const employeeId = ownEmployee(req);
  const month = monthParam(req.query.month);
  const rec = await payroll.recalc(employeeId, month);
  const statement = rec ? await payroll.getRecord(rec.id, { refresh: false }) : null;
  const period = await payroll.ensurePeriod(month);
  const days = await att.recordsQuery().where('a.employee_id', employeeId).whereBetween('a.attendance_date', [period.start_date, period.end_date]).orderBy('a.attendance_date');
  const emp = await knex('employees as e').leftJoin('departments as d', 'd.id', 'e.department_id').leftJoin('commission_settings as cs', 'cs.employee_id', 'e.id')
    .where('e.id', employeeId).first('e.employee_code', 'e.full_name', 'e.designation', 'e.joining_date', 'd.name as department', 'cs.fixed_rate_percent');
  res.json({ employee: emp, period, statement, attendance: days.map(att.recordDto), leaves: await leaves.list({ employeeId }), advances: await advances.list({ employeeId }) });
}

async function payslips(req, res) {
  const employeeId = ownEmployee(req);
  const rows = await payroll.recordQuery().where('r.employee_id', employeeId).whereIn('r.status', ['Approved', 'Paid']).orderBy('p.period_month', 'desc');
  res.json(rows.map(payroll.shapeRecord));
}

async function applyLeave(req, res) {
  const employeeId = ownEmployee(req);
  const b = req.body || {};
  const c = ctx(req);
  await run(res, c, () => leaves.apply({
    employeeId, userId: req.user.id, username: req.user.username, leaveType: b.leaveType, startDate: b.startDate, endDate: b.endDate,
    halfDay: b.halfDay, reason: b.reason, source: 'web-self',
  }, req.user, c), 201);
}

async function cancelLeave(req, res) {
  const employeeId = ownEmployee(req);
  const c = ctx(req, { ownEmployeeId: employeeId });
  await run(res, c, () => leaves.cancel(idParam(req.params.id), req.user, c));
}

module.exports = { overview, payslips, applyLeave, cancelLeave };
