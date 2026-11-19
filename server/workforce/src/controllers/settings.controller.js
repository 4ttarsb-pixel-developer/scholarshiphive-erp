'use strict';
const knex = require('../db');
const { policyFor, normalizePolicy } = require('../services/policy.service');
const payroll = require('../services/payroll.service');
const events = require('../services/events.service');
const { audit } = require('../services/audit.service');
const { clientIp } = require('../utils/request');
const { isValidDate, isValidTime, todayInTz, monthStart } = require('../utils/time');
const { D } = require('../utils/money');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { idParam } = require('./helpers');
const config = require('../config');

async function currentPolicy(req, res) {
  const date = isValidDate(req.query.date) ? req.query.date : todayInTz(config.businessTimezone);
  res.json(await policyFor(date));
}

async function policyHistory(_req, res) {
  const rows = await knex('attendance_policies as p').leftJoin('users as u', 'u.id', 'p.created_by')
    .orderBy([{ column: 'p.effective_from', order: 'desc' }, { column: 'p.id', order: 'desc' }]).select('p.*', 'u.full_name as created_by_name');
  res.json(rows.map((r) => ({ ...normalizePolicy(r), createdBy: r.created_by_name })));
}

const int = (v, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
const pct = (v) => v !== undefined && v !== '' && /^\d{1,3}(\.\d{1,3})?$/.test(String(v)) && D(v).lte(100);

/**
 * Create a new policy version. It applies to Draft payroll for periods ending on or
 * after its effective date; Approved/Paid payroll keeps the policy in its snapshot.
 */
async function createPolicy(req, res) {
  const b = req.body || {};
  const errors = [];
  const effectiveFrom = b.effectiveFrom ? b.effectiveFrom : monthStart(todayInTz(config.businessTimezone));
  if (!isValidDate(effectiveFrom)) errors.push('Effective date is invalid.');
  if (!['schedule', 'fixed', 'calendar'].includes(b.workingDaysBasis)) errors.push('Working-days basis must be schedule, fixed or calendar.');
  if (b.workingDaysBasis === 'fixed' && !int(b.fixedWorkingDays, 1, 31)) errors.push('Fixed working days must be 1–31.');
  if (!int(b.graceMinutes, 0, 240)) errors.push('Grace period must be 0–240 minutes.');
  if (!['per_hour', 'tiered'].includes(b.lateRuleType)) errors.push('Late rule must be per_hour or tiered.');
  if (!pct(b.lateRatePercent)) errors.push('Late rate must be 0–100%.');
  if (!['daily', 'monthly'].includes(b.lateBasis)) errors.push('Late basis must be daily or monthly.');
  if (!['started_hour', 'exact'].includes(b.lateRounding)) errors.push('Late rounding must be started_hour or exact.');
  if (!pct(b.lateCapPercent)) errors.push('Late cap must be 0–100%.');
  if (!int(b.severeLateMinutes, 1, 1440)) errors.push('Severe late threshold must be 1–1440 minutes.');
  if (!int(b.earlyGraceMinutes ?? 10, 0, 240)) errors.push('Early grace must be 0–240 minutes.');
  if (!pct(b.earlyRatePercent ?? 5)) errors.push('Early rate must be 0–100%.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(String(b.paidLeaveDaysPerMonth)) || D(b.paidLeaveDaysPerMonth).gt(31)) errors.push('Paid leave allowance must be 0–31 days.');
  if (b.payrollCutoffDay !== null && b.payrollCutoffDay !== undefined && b.payrollCutoffDay !== '' && !int(b.payrollCutoffDay, 1, 28)) errors.push('Cutoff day must be 1–28 or empty.');
  if (!pct(b.maxManualCommissionPercent ?? 50)) errors.push('Max manual commission must be 0–100%.');
  let tiers = Array.isArray(b.lateTiers) ? b.lateTiers : [];
  tiers = tiers.map((t) => ({ minMinutes: Number(t.minMinutes), percent: String(t.percent) }));
  if (tiers.some((t) => !int(t.minMinutes, 1, 1440) || !pct(t.percent))) errors.push('Each late tier needs minutes (1–1440) and a percentage (0–100).');
  if (b.lateRuleType === 'tiered' && !tiers.length) errors.push('Add at least one late tier for the tiered rule.');
  if (!b.reason || String(b.reason).trim().length < 5) errors.push('A reason for the policy change (min 5 characters) is required.');
  if (b.timezone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: b.timezone }); } catch (_) { errors.push('Unknown timezone.'); }
  }
  if (errors.length) throw badRequest(errors.join(' '), errors);

  const before = await policyFor(effectiveFrom);
  const [row] = await knex('attendance_policies').insert({
    effective_from: effectiveFrom, timezone: b.timezone || before.timezone, working_days_basis: b.workingDaysBasis,
    fixed_working_days: b.workingDaysBasis === 'fixed' ? Number(b.fixedWorkingDays) : null, grace_minutes: Number(b.graceMinutes),
    late_deduction_enabled: !!b.lateDeductionEnabled, late_rule_type: b.lateRuleType, late_rate_percent: String(b.lateRatePercent),
    late_basis: b.lateBasis, late_rounding: b.lateRounding, late_tiers: JSON.stringify(tiers), late_cap_percent: String(b.lateCapPercent),
    severe_late_minutes: Number(b.severeLateMinutes), severe_late_requires_review: b.severeLateRequiresReview !== false,
    early_departure_deduction_enabled: !!b.earlyDeductionEnabled, early_grace_minutes: Number(b.earlyGraceMinutes ?? 10),
    early_rate_percent: String(b.earlyRatePercent ?? 5), absence_deduction_enabled: b.absenceDeductionEnabled !== false,
    paid_leave_days_per_month: String(b.paidLeaveDaysPerMonth), block_approval_until_period_end: !!b.blockApprovalUntilPeriodEnd,
    revenue_require_second_verifier: !!b.revenueRequireSecondVerifier,
    payroll_cutoff_day: b.payrollCutoffDay ? Number(b.payrollCutoffDay) : null,
    max_manual_commission_percent: String(b.maxManualCommissionPercent ?? 50), reason: String(b.reason).trim(), created_by: req.user.id,
  }).returning('*');
  const after = normalizePolicy(row);
  const changed = Object.keys(after).filter((k) => !['id', 'effectiveFrom', 'reason', 'createdAt'].includes(k) && JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  await audit(null, {
    actor: req.user, action: 'Payroll policy updated', entityType: 'attendance_policy', entityId: row.id, ip: clientIp(req),
    before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
    detail: `Effective ${effectiveFrom}. Changed: ${changed.join(', ') || 'none'}. Reason: ${String(b.reason).trim()}. Approved/Paid payroll unaffected.`,
  });
  // Recalculate open payroll for the current month so dashboards update immediately.
  await payroll.refreshMonth(monthStart(todayInTz(config.businessTimezone)), { maxAgeMs: 0 });
  events.publish('policy.changed', {});
  events.publish('payroll.changed', {});
  res.status(201).json(after);
}

async function listHolidays(req, res) {
  const q = knex('holidays').orderBy('holiday_date');
  if (req.query.year && /^\d{4}$/.test(req.query.year)) q.whereRaw("to_char(holiday_date,'YYYY') = ?", [req.query.year]);
  res.json(await q);
}
async function addHoliday(req, res) {
  const { date, name, isPaid } = req.body || {};
  if (!isValidDate(date) || !name || String(name).trim().length < 2) throw badRequest('Holiday date and name are required.');
  const employees = await knex('employees').where({ employment_status: 'Active' }).pluck('id');
  for (const id of employees) await payroll.assertNotLocked(id, date, knex, 'This holiday');
  const [h] = await knex('holidays').insert({ holiday_date: date, name: String(name).trim(), is_paid: isPaid !== false, created_by: req.user.id }).onConflict('holiday_date').merge(['name', 'is_paid', 'updated_at']).returning('*');
  await audit(null, { actor: req.user, action: 'Holiday saved', entityType: 'holiday', entityId: h.id, detail: `${date} ${h.name}${h.is_paid ? '' : ' (unpaid)'}`, ip: clientIp(req) });
  for (const id of employees) await payroll.recalcForDate(id, date);
  events.publish('payroll.changed', {});
  res.status(201).json(h);
}
async function deleteHoliday(req, res) {
  const h = await knex('holidays').where({ id: idParam(req.params.id) }).first();
  if (!h) throw notFound('Holiday not found.');
  const employees = await knex('employees').where({ employment_status: 'Active' }).pluck('id');
  for (const id of employees) {
    if (await payroll.isLocked(id, await payroll.monthForDate(h.holiday_date))) throw conflict('That month already has approved payroll; the holiday cannot be removed.');
  }
  await knex('holidays').where({ id: h.id }).del();
  await audit(null, { actor: req.user, action: 'Holiday removed', entityType: 'holiday', entityId: h.id, detail: `${h.holiday_date} ${h.name}`, ip: clientIp(req) });
  for (const id of employees) await payroll.recalcForDate(id, h.holiday_date);
  events.publish('payroll.changed', {});
  res.json({ success: true });
}

async function listShifts(_req, res) { res.json(await knex('shifts').orderBy('start_time')); }
async function saveShift(req, res) {
  const { name, startTime, endTime, breakMinutes } = req.body || {};
  if (!name || !isValidTime(startTime) || !isValidTime(endTime) || startTime === endTime) throw badRequest('Shift name, start and end time (HH:MM, different) are required.');
  const id = req.params.id ? idParam(req.params.id) : null;
  const values = { name: String(name).trim(), start_time: startTime, end_time: endTime, break_minutes: Number(breakMinutes || 0), updated_at: new Date() };
  const [s] = id ? await knex('shifts').where({ id }).update(values).returning('*') : await knex('shifts').insert(values).returning('*');
  await audit(null, { actor: req.user, action: id ? 'Shift updated' : 'Shift created', entityType: 'shift', entityId: s.id, detail: `${s.name} ${startTime}–${endTime}`, ip: clientIp(req) });
  await payroll.refreshMonth(monthStart(todayInTz(config.businessTimezone)), { maxAgeMs: 0 });
  events.publish('payroll.changed', {});
  res.status(id ? 200 : 201).json(s);
}

async function getSchedule(req, res) {
  const employeeId = req.query.employeeId ? idParam(req.query.employeeId) : null;
  const rows = await knex('work_schedules').where((q) => (employeeId ? q.where('employee_id', employeeId) : q.whereNull('employee_id'))).orderBy([{ column: 'effective_from', order: 'desc' }, 'weekday']);
  res.json(rows);
}
async function putSchedule(req, res) {
  const { employeeId, workingDays, effectiveFrom } = req.body || {};
  if (!Array.isArray(workingDays) || workingDays.some((d) => !int(d, 0, 6))) throw badRequest('workingDays must be weekday numbers 0–6 (0 = Sunday).');
  const eff = effectiveFrom || monthStart(todayInTz(config.businessTimezone));
  if (!isValidDate(eff)) throw badRequest('Invalid effective date.');
  const empId = employeeId ? idParam(employeeId) : null;
  await knex.transaction(async (trx) => {
    for (let wd = 0; wd <= 6; wd += 1) {
      await trx.raw(`INSERT INTO work_schedules (employee_id, weekday, is_working_day, effective_from) VALUES (?, ?, ?, ?)
        ON CONFLICT (COALESCE(employee_id, 0), weekday, effective_from) DO UPDATE SET is_working_day = EXCLUDED.is_working_day, updated_at = now()`,
      [empId, wd, workingDays.map(Number).includes(wd), eff]);
    }
    await audit(trx, { actor: req.user, action: 'Work schedule updated', entityType: 'work_schedule', entityId: empId || 'default', detail: `${empId ? `Employee ${empId}` : 'Company default'} from ${eff}: working days ${workingDays.join(',')}`, ip: clientIp(req) });
  });
  await payroll.refreshMonth(monthStart(todayInTz(config.businessTimezone)), { maxAgeMs: 0 });
  events.publish('payroll.changed', {});
  res.json({ success: true });
}

module.exports = { currentPolicy, policyHistory, createPolicy, listHolidays, addHoliday, deleteHoliday, listShifts, saveShift, getSchedule, putSchedule };
