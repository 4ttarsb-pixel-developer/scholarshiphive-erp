'use strict';
const express = require('express');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rate-limit');
const { ah } = require('../utils/errors');
const events = require('../services/events.service');
const authC = require('../controllers/auth.controller');
const emp = require('../controllers/employees.controller');
const att = require('../controllers/attendance.controller');
const leave = require('../controllers/leave.controller');
const rev = require('../controllers/revenue.controller');
const pay = require('../controllers/payroll.controller');
const adv = require('../controllers/advance.controller');
const settings = require('../controllers/settings.controller');
const reports = require('../controllers/reports.controller');
const me = require('../controllers/me.controller');
const users = require('../controllers/users.controller');
const { importData } = require('../services/import-localstorage.service');
const { clientIp } = require('../utils/request');
const knex = require('../db');

const r = express.Router();
const P = requirePermission;

r.get('/health', ah(async (_req, res) => {
  await knex.raw('select 1');
  res.json({ success: true, status: 'ok', database: 'postgresql', time: new Date().toISOString() });
}));

// ---- auth
r.post('/auth/login', loginLimiter, ah(authC.login));
r.post('/auth/logout', requireAuth, ah(authC.logout));
r.get('/auth/me', requireAuth, ah(authC.me));
r.post('/auth/change-password', requireAuth, ah(authC.changePassword));

// ---- live updates (Server-Sent Events)
r.get('/events', requireAuth, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  const remove = events.addClient(res, req.user);
  req.on('close', remove);
});

// ---- employees
r.get('/employees', P('employees.view'), ah(emp.list));
r.get('/employees/unmapped-logins', P('employees.manage'), ah(emp.unmapped));
r.get('/departments', P('employees.view'), ah(emp.departments));
r.get('/employees/:id(\\d+)', P('employees.view'), ah(emp.get));
r.post('/employees', P('employees.manage'), ah(emp.create));
r.patch('/employees/:id(\\d+)', P('employees.manage'), ah(emp.update));
r.post('/employees/:id(\\d+)/link-user', P('employees.manage'), ah(emp.linkUser));
r.post('/employees/:id(\\d+)/create-login', P('employees.manage'), ah(emp.createLogin));

// ---- attendance (ERP)
r.get('/attendance', P('attendance.view_all'), ah(att.listRecords));
r.get('/attendance/export', P('attendance.view_all'), ah(att.exportCsv));
r.get('/attendance/live', P('attendance.view_all'), ah(att.live));
r.get('/attendance/employee/:id(\\d+)', P('attendance.view_all', 'attendance.view_own'), ah(att.employeeRecords));
r.post('/attendance/check-in', requireAuth, ah(att.checkIn));
r.post('/attendance/check-out', requireAuth, ah(att.checkOut));
r.get('/attendance/corrections', P('attendance.view_all'), ah(att.listCorrections));
r.post('/attendance/corrections', P('attendance.manage', 'attendance.approve_corrections'), ah(att.requestCorrection));
r.post('/attendance/corrections/:id(\\d+)/decide', P('attendance.approve_corrections'), ah(att.decideCorrection));
r.post('/attendance/review', P('attendance.manage', 'attendance.approve_corrections'), ah(att.review));

// ---- leave
r.get('/leaves', P('leave.manage', 'attendance.view_all'), ah(leave.list));
r.post('/leaves', P('leave.manage'), ah(leave.create));
r.post('/leaves/:id(\\d+)/approve', P('leave.manage'), ah(leave.approve));
r.post('/leaves/:id(\\d+)/reject', P('leave.manage'), ah(leave.reject));
r.post('/leaves/:id(\\d+)/cancel', P('leave.manage'), ah(leave.cancel));

// ---- revenue & commissions
r.get('/revenue', P('revenue.view'), ah(rev.list));
r.get('/revenue/export', P('revenue.view'), ah(rev.exportCsv));
r.post('/revenue', P('revenue.create'), ah(rev.create));
r.patch('/revenue/:id(\\d+)', P('revenue.create'), ah(rev.update));
r.post('/revenue/:id(\\d+)/verify', P('revenue.verify'), ah(rev.verify));
r.post('/revenue/:id(\\d+)/reject', P('revenue.verify'), ah(rev.reject));
r.post('/revenue/:id(\\d+)/cancel', P('revenue.verify'), ah(rev.cancel));
r.get('/commissions', P('commission.view', 'payroll.view'), ah(rev.commissions));
r.get('/commissions/employee/:id(\\d+)', P('commission.view', 'payroll.view'), ah(rev.employeeCommissions));
r.get('/commission-settings/:employeeId(\\d+)', P('commission.view', 'revenue.create', 'commission.settings'), ah(rev.getSettings));
r.put('/commission-settings/:employeeId(\\d+)', P('commission.settings'), ah(rev.putSettings));

// ---- payroll
r.get('/payroll', P('payroll.view'), ah(pay.list));
r.get('/payroll/export', P('payroll.view'), ah(pay.exportCsv));
r.post('/payroll/calculate', P('payroll.calculate'), ah(pay.calculate));
r.post('/payroll/approve-bulk/preview', P('payroll.approve'), ah(pay.approvePreview));
r.post('/payroll/approve-bulk', P('payroll.approve'), ah(pay.approveBulk));
r.post('/payroll/reject-bulk', P('payroll.approve'), ah(pay.rejectBulk));
r.get('/payroll/:id(\\d+)/payslip', P('payroll.view', 'payroll.view_own'), ah(pay.payslip));
r.post('/payroll/:id(\\d+)/submit', P('payroll.calculate'), ah(pay.submit));
r.post('/payroll/:id(\\d+)/reopen', P('payroll.calculate', 'payroll.approve'), ah(pay.reopen));
r.post('/payroll/:id(\\d+)/mark-paid', P('payroll.pay'), ah(pay.markPaid));
r.post('/payroll/:id(\\d+)/bonus-deduction', P('payroll.adjust'), ah(pay.bonusDeduction));
r.get('/payroll/:employeeId(\\d+)', P('payroll.view', 'payroll.view_own'), ah(pay.forEmployee));
r.get('/payroll-adjustments', P('payroll.view'), ah(pay.listAdjustments));
r.post('/payroll-adjustments', P('payroll.adjust'), ah(pay.createAdjustment));
r.post('/payroll-adjustments/:id(\\d+)/:decision(approve|reject|cancel)', P('payroll.approve'), ah(pay.decideAdjustment));

// ---- salary advances
r.get('/advances', P('advances.view'), ah(adv.list));
r.get('/advances/employee/:id(\\d+)', P('advances.view', 'payroll.view_own'), ah(adv.forEmployee));
r.post('/advances', P('advances.manage'), ah(adv.create));
r.post('/advances/:id(\\d+)/:decision(approve|reject|cancel)', P('advances.approve'), ah(adv.decide));

// ---- policy, holidays, shifts, schedules
r.get('/policies/current', requireAuth, ah(settings.currentPolicy));
r.get('/policies', P('policy.manage'), ah(settings.policyHistory));
r.post('/policies', P('policy.manage'), ah(settings.createPolicy));
r.get('/holidays', requireAuth, ah(settings.listHolidays));
r.post('/holidays', P('policy.manage'), ah(settings.addHoliday));
r.delete('/holidays/:id(\\d+)', P('policy.manage'), ah(settings.deleteHoliday));
r.get('/shifts', requireAuth, ah(settings.listShifts));
r.post('/shifts', P('policy.manage'), ah(settings.saveShift));
r.patch('/shifts/:id(\\d+)', P('policy.manage'), ah(settings.saveShift));
r.get('/schedules', P('policy.manage', 'employees.view'), ah(settings.getSchedule));
r.put('/schedules', P('policy.manage'), ah(settings.putSchedule));

// ---- reports, exceptions, audit
r.get('/dashboard', P('reports.view', 'payroll.view'), ah(reports.dashboard));
r.get('/exceptions', P('attendance.view_all', 'payroll.view'), ah(reports.exceptions));
r.get('/audit', P('audit.view'), ah(reports.auditList));
r.get('/audit/export', P('audit.view'), ah(reports.auditExport));

// ---- users / roles / permissions
r.get('/users', P('users.manage'), ah(users.list));
r.get('/roles', P('users.manage'), ah(users.roles));
r.put('/users/:id(\\d+)/roles', P('users.manage'), ah(users.setUserRoles));
r.post('/users/:id(\\d+)/reset-password', P('users.manage'), ah(users.resetPassword));
r.put('/roles/:code/permissions', P('users.manage'), ah(users.setRolePermissions));

// ---- employee self-service
r.get('/me/overview', P('payroll.view_own', 'attendance.view_own'), ah(me.overview));
r.get('/me/payslips', P('payroll.view_own'), ah(me.payslips));
r.post('/me/leaves', P('leave.apply_own'), ah(me.applyLeave));
r.post('/me/leaves/:id(\\d+)/cancel', P('leave.apply_own'), ah(me.cancelLeave));

// ---- one-time LocalStorage migration
r.post('/import/localstorage', P('users.manage'), ah(async (req, res) => {
  const b = req.body || {};
  const report = await importData(b.data, req.user, { dryRun: b.dryRun !== false, includeDemoAttendance: !!b.includeDemoAttendance, backupConfirmed: !!b.backupConfirmed, ip: clientIp(req) });
  if (!report.dryRun) events.publish('payroll.changed', {});
  res.json({ success: true, report });
}));

module.exports = r;
