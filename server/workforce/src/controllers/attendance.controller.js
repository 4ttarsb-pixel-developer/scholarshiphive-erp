'use strict';
const knex = require('../db');
const config = require('../config');
const payroll = require('../services/payroll.service');
const attendance = require('../services/attendance.service');
const corrections = require('../services/correction.service');
const network = require('../services/network.service');
const legacy = require('./legacy-attendance.controller');
const { can } = require('../middleware/auth');
const { ctx, run, monthParam, idParam } = require('./helpers');
const { clientIp } = require('../utils/request');
const { sendCsv } = require('../utils/csv');
const { durationText } = require('../services/attendance-engine');
const { zonedParts, todayInTz, isValidDate } = require('../utils/time');
const { forbidden, badRequest, conflict } = require('../utils/errors');

const tz = () => config.businessTimezone;
const localTime = (v) => (v ? zonedParts(v, tz()).time.slice(0, 5) : null);

function recordDto(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeCode: r.employee_code,
    employeeName: r.full_name,
    department: r.department || '',
    isDemo: r.is_demo,
    date: r.attendance_date,
    shiftName: r.shift_name,
    scheduledStart: localTime(r.scheduled_start),
    scheduledEnd: localTime(r.scheduled_end),
    checkIn: localTime(r.actual_check_in),
    checkOut: localTime(r.actual_check_out),
    checkInAt: r.actual_check_in,
    checkOutAt: r.actual_check_out,
    workedSeconds: r.worked_seconds,
    workedText: durationText(r.worked_seconds),
    awaySeconds: r.away_seconds,
    lateMinutes: r.late_minutes,
    earlyDepartureMinutes: r.early_departure_minutes,
    status: r.status,
    leaveRequestId: r.leave_request_id,
    leaveFraction: Number(r.leave_fraction),
    leaveStatus: r.leave_status || null,
    leavePayType: r.leave_pay_type || null,
    isOverridden: r.is_overridden,
    correctionReason: r.correction_reason,
    source: r.source,
    reviewed: r.reviewed,
    reviewNote: r.review_note,
    hasPendingCorrection: !!r.pending_correction_id,
    pendingCorrectionId: r.pending_correction_id || null,
  };
}

function recordsQuery() {
  return knex('attendance_records as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('shifts as s', 's.id', 'a.shift_id')
    .leftJoin('leave_requests as l', 'l.id', 'a.leave_request_id')
    .leftJoin('attendance_corrections as pc', function joinPending() {
      this.on('pc.employee_id', 'a.employee_id').andOn('pc.attendance_date', 'a.attendance_date').andOnVal('pc.status', 'Pending');
    })
    .select('a.*', 'e.employee_code', 'e.full_name', 'e.is_demo', 'd.name as department', 's.name as shift_name',
      'l.status as leave_status', 'l.pay_type as leave_pay_type', 'pc.id as pending_correction_id');
}

async function listRecords(req, res) {
  const month = monthParam(req.query.month);
  const period = await payroll.refreshMonth(month);
  const q = recordsQuery().whereBetween('a.attendance_date', [period.start_date, period.end_date])
    .orderBy([{ column: 'a.attendance_date', order: 'desc' }, { column: 'e.employee_code' }]);
  if (req.query.employeeId && req.query.employeeId !== 'all') q.where('a.employee_id', idParam(req.query.employeeId, 'employeeId'));
  if (req.query.date && isValidDate(req.query.date)) q.where('a.attendance_date', req.query.date);
  if (req.query.status) q.where('a.status', req.query.status);
  if (req.query.includeUpcoming !== 'true') q.whereNotIn('a.status', ['Upcoming', 'NotEmployed']);
  const rows = await q.limit(10000);
  res.json({ period, records: rows.map(recordDto) });
}

async function employeeRecords(req, res) {
  const employeeId = idParam(req.params.id, 'employee id');
  if (!can(req.user, 'attendance.view_all') && req.user.employeeId !== employeeId) throw forbidden();
  const month = monthParam(req.query.month);
  const period = await payroll.ensurePeriod(month);
  await payroll.recalc(employeeId, month);
  const rows = await recordsQuery().where('a.employee_id', employeeId)
    .whereBetween('a.attendance_date', [period.start_date, period.end_date]).orderBy('a.attendance_date');
  res.json({ period, records: rows.map(recordDto) });
}

async function live(_req, res) {
  const today = todayInTz(tz());
  const rows = await knex('attendance_sessions as s').join('users as u', 'u.id', 's.user_id').leftJoin('employees as e', 'e.id', 's.employee_id')
    .where((q) => q.where('s.business_date', today).orWhere('s.is_active', true))
    .orderBy('s.check_in_at', 'desc')
    .select('s.*', 'u.username', 'u.full_name as user_name', 'e.employee_code', 'e.full_name');
  const enriched = await attendance.enrichLegacyRows(rows);
  res.json(enriched.map((r, i) => ({ ...r, employeeName: rows[i].full_name || rows[i].user_name, checkInLocal: localTime(rows[i].check_in_at), checkOutLocal: localTime(rows[i].check_out_at) })));
}

/** JSON check-in for authenticated users (web / API clients). Same network rules as the Flutter app. */
async function checkIn(req, res) {
  const user = await knex('users').where({ id: req.user.id }).first();
  const ip = clientIp(req);
  const net = await network.approvedOfficeNetwork(ip);
  if (net.rows.length > 0 && !net.matched) throw forbidden('This network is not approved for attendance.');
  const deviceId = String((req.body && req.body.deviceId) || `web-${req.user.id}`).slice(0, 200);
  const r = await knex.transaction((trx) => attendance.checkIn(user, { deviceId, ip, source: 'web' }, trx));
  if (!r.alreadyCheckedIn) await legacy.afterAttendanceChange(user.employee_id, r.session.business_date);
  res.json({ success: true, sessionId: r.session.session_id, alreadyCheckedIn: r.alreadyCheckedIn, checkInTime: r.session.check_in_at, businessDate: r.session.business_date });
}

async function checkOut(req, res) {
  const s = await knex('attendance_sessions').where({ user_id: req.user.id, is_active: true }).first();
  if (!s) throw conflict('You are not checked in.');
  const ip = clientIp(req);
  const net = await network.approvedOfficeNetwork(ip);
  if (config.checkoutRequiresNetworkRule && (net.rows.length === 0 || !net.matched)) {
    throw forbidden(net.rows.length === 0 ? 'Checkout is blocked until an office Wi-Fi/IP is configured by management.' : 'Checkout is only allowed while connected to an approved office Wi-Fi network.');
  }
  const closed = await knex.transaction((trx) => attendance.checkOut(s.session_id, { ip, report: (req.body && req.body.report) || null }, trx));
  await legacy.afterAttendanceChange(s.employee_id, s.business_date);
  res.json({ success: true, ...(await attendance.sessionMetrics(closed)) });
}

const listCorrections = async (req, res) => res.json(await corrections.list({ status: req.query.status, employeeId: req.query.employeeId ? Number(req.query.employeeId) : undefined }));

async function requestCorrection(req, res) {
  const c = ctx(req, { canApprove: can(req.user, 'attendance.approve_corrections') });
  await run(res, c, () => corrections.request(req.body || {}, req.user, c), 201);
}

async function decideCorrection(req, res) {
  const c = ctx(req);
  await run(res, c, () => corrections.decide(idParam(req.params.id), req.body || {}, req.user, c));
}

async function review(req, res) {
  const { employeeId, date, note } = req.body || {};
  if (!isValidDate(date)) throw badRequest('Invalid date.');
  const c = ctx(req);
  await run(res, c, () => corrections.review(idParam(employeeId, 'employeeId'), date, note, req.user, c));
}

async function exportCsv(req, res) {
  const month = monthParam(req.query.month);
  const period = await payroll.refreshMonth(month);
  const q = recordsQuery().whereBetween('a.attendance_date', [period.start_date, period.end_date]).whereNotIn('a.status', ['Upcoming', 'NotEmployed'])
    .orderBy([{ column: 'e.employee_code' }, { column: 'a.attendance_date' }]);
  if (req.query.employeeId && req.query.employeeId !== 'all') q.where('a.employee_id', Number(req.query.employeeId));
  const rows = (await q).map(recordDto);
  sendCsv(res, `attendance_${month.slice(0, 7)}.csv`, [
    ['Employee Code', 'Employee', 'Date', 'Status', 'Shift', 'Scheduled Start', 'Scheduled End', 'Check In', 'Check Out', 'Worked', 'Late (min)', 'Early (min)', 'Leave', 'Correction Reason', 'Reviewed', 'Review Note', 'Demo'],
    ...rows.map((r) => [r.employeeCode, r.employeeName, r.date, r.status, r.shiftName, r.scheduledStart, r.scheduledEnd, r.checkIn, r.checkOut, r.workedText,
      r.lateMinutes, r.earlyDepartureMinutes, r.leaveStatus ? `${r.leaveStatus}${r.leavePayType ? ` (${r.leavePayType})` : ''}` : '', r.correctionReason || '', r.reviewed ? 'Yes' : 'No', r.reviewNote || '', r.isDemo ? 'DEMO' : '']),
  ]);
}

module.exports = { listRecords, employeeRecords, live, checkIn, checkOut, listCorrections, requestCorrection, decideCorrection, review, exportCsv, recordDto, recordsQuery };
