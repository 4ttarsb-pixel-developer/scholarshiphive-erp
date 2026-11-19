'use strict';
const knex = require('../db');
const config = require('../config');
const payroll = require('../services/payroll.service');
const advances = require('../services/advance.service');
const { monthParam } = require('./helpers');
const { sendCsv } = require('../utils/csv');
const { D, sum } = require('../utils/money');
const { todayInTz } = require('../utils/time');

async function dashboard(req, res) {
  const month = monthParam(req.query.month);
  const { period, records } = await payroll.listMonth(month);
  const today = todayInTz(config.businessTimezone);
  const [{ c: present }] = await knex('attendance_sessions').where({ business_date: today }).countDistinct('user_id as c');
  const [{ c: active }] = await knex('attendance_sessions').where({ is_active: true }).count('* as c');
  const pendingLeaves = await knex('leave_requests').where({ status: 'Pending' }).count('* as c').first();
  const pendingSales = await knex('revenue_sales').where({ status: 'Pending', accounting_month: month }).count('* as c').first();
  const pendingCorrections = await knex('attendance_corrections').where({ status: 'Pending' }).count('* as c').first();
  const [{ c: totalEmployees }] = await knex('employees').where({ employment_status: 'Active' }).count('* as c');
  res.json({
    month,
    period,
    kpis: {
      totalEmployees: Number(totalEmployees),
      monthlyBasePayroll: sum(records.map((r) => r.baseSalary)).toFixed(2),
      verifiedRevenue: sum(records.map((r) => r.revenueTotal)).toFixed(2),
      earnedCommissions: sum(records.map((r) => r.commissionTotal)).toFixed(2),
      attendanceDeductions: sum(records.map((r) => D(r.attendanceDeductions).plus(r.unpaidLeaveDeduction))).toFixed(2),
      outstandingAdvances: await advances.outstandingTotal(),
      advanceRecoveries: sum(records.map((r) => r.advanceRecovery)).toFixed(2),
      projectedNetPayroll: sum(records.map((r) => r.netSalary)).toFixed(2),
      grossPayroll: sum(records.map((r) => r.grossEarnings)).toFixed(2),
      pendingApprovals: records.filter((r) => ['Draft', 'UnderReview'].includes(r.status)).length,
      approved: records.filter((r) => r.status === 'Approved').length,
      paid: records.filter((r) => r.status === 'Paid').length,
      blockedRecords: records.filter((r) => r.blockers.length).length,
      exceptions: records.reduce((a, r) => a + r.blockers.length, 0),
      presentToday: Number(present),
      checkedInNow: Number(active),
      pendingLeaves: Number(pendingLeaves.c),
      pendingSales: Number(pendingSales.c),
      pendingCorrections: Number(pendingCorrections.c),
    },
    records,
  });
}

/** Flattened payroll blockers for the Exception Queue. */
async function exceptions(req, res) {
  const month = monthParam(req.query.month);
  const { records } = await payroll.listMonth(month);
  const items = [];
  for (const r of records) {
    for (const b of r.blockers) {
      items.push({ ...b, payrollRecordId: r.id, employeeId: r.employeeId, employeeCode: r.employeeCode, employeeName: r.fullName, department: r.department, isDemo: r.isDemo });
    }
  }
  // Attach references needed by the UI actions.
  const att = items.filter((i) => i.date).length ? await knex('attendance_records')
    .whereIn('employee_id', [...new Set(items.map((i) => i.employeeId))]).whereIn('attendance_date', [...new Set(items.filter((i) => i.date).map((i) => i.date))])
    .select('employee_id', 'attendance_date', 'actual_check_in', 'late_minutes', 'leave_request_id', 'status') : [];
  const pc = await knex('attendance_corrections').where({ status: 'Pending' }).select('id', 'employee_id', 'attendance_date', 'reason', 'requested_status');
  for (const i of items) {
    const a = att.find((x) => x.employee_id === i.employeeId && x.attendance_date === i.date);
    if (a) { i.lateMinutes = a.late_minutes; i.leaveRequestId = a.leave_request_id; i.checkInAt = a.actual_check_in; }
    const c = pc.find((x) => x.employee_id === i.employeeId && x.attendance_date === i.date);
    if (c) { i.correctionId = c.id; i.correctionReason = c.reason; }
  }
  items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  res.json({ month, items });
}

async function auditList(req, res) {
  const q = knex('audit_logs').orderBy('id', 'desc').limit(Math.min(Number(req.query.limit) || 500, 5000));
  if (req.query.search) {
    const like = `%${String(req.query.search).toLowerCase()}%`;
    q.where((w) => w.whereRaw('lower(action) like ?', [like]).orWhereRaw('lower(detail) like ?', [like]).orWhereRaw('lower(actor_name) like ?', [like]));
  }
  if (req.query.entityType) q.where('entity_type', req.query.entityType);
  res.json(await q);
}

async function auditExport(_req, res) {
  const rows = await knex('audit_logs').orderBy('id', 'desc').limit(20000);
  sendCsv(res, 'audit_log.csv', [['Time', 'Performed by', 'Action', 'Entity', 'Entity ID', 'Details', 'IP'],
    ...rows.map((a) => [new Date(a.created_at).toISOString(), a.actor_name, a.action, a.entity_type, a.entity_id, a.detail, a.ip])]);
}

module.exports = { dashboard, exceptions, auditList, auditExport };
