'use strict';
const knex = require('../db');
const config = require('../config');

/** Policy in force on a given date (latest effective_from <= date). */
async function policyFor(date, db = knex) {
  const row = await db('attendance_policies')
    .where('effective_from', '<=', date)
    .orderBy([{ column: 'effective_from', order: 'desc' }, { column: 'id', order: 'desc' }])
    .first();
  const p = row || (await db('attendance_policies').orderBy('id', 'desc').first());
  if (!p) throw new Error('No attendance policy configured. Run npm run db:migrate.');
  return normalizePolicy(p);
}

function normalizePolicy(p) {
  let tiers = p.late_tiers;
  if (typeof tiers === 'string') tiers = JSON.parse(tiers);
  tiers = (Array.isArray(tiers) ? tiers : [])
    .map((t) => ({ minMinutes: Number(t.minMinutes), percent: String(t.percent) }))
    .filter((t) => Number.isFinite(t.minMinutes) && t.minMinutes > 0)
    .sort((a, b) => a.minMinutes - b.minMinutes);
  return {
    id: p.id,
    effectiveFrom: p.effective_from,
    timezone: p.timezone || config.businessTimezone,
    workingDaysBasis: p.working_days_basis,
    fixedWorkingDays: p.fixed_working_days,
    graceMinutes: p.grace_minutes,
    lateDeductionEnabled: p.late_deduction_enabled,
    lateRuleType: p.late_rule_type,
    lateRatePercent: String(p.late_rate_percent),
    lateBasis: p.late_basis,
    lateRounding: p.late_rounding,
    lateTiers: tiers,
    lateCapPercent: String(p.late_cap_percent),
    severeLateMinutes: p.severe_late_minutes,
    severeLateRequiresReview: p.severe_late_requires_review,
    earlyDeductionEnabled: p.early_departure_deduction_enabled,
    earlyGraceMinutes: p.early_grace_minutes,
    earlyRatePercent: String(p.early_rate_percent),
    absenceDeductionEnabled: p.absence_deduction_enabled,
    paidLeaveDaysPerMonth: String(p.paid_leave_days_per_month),
    blockApprovalUntilPeriodEnd: p.block_approval_until_period_end,
    revenueRequireSecondVerifier: p.revenue_require_second_verifier,
    payrollCutoffDay: p.payroll_cutoff_day,
    maxManualCommissionPercent: String(p.max_manual_commission_percent),
    reason: p.reason,
    createdAt: p.created_at,
  };
}

/**
 * Weekly schedule resolver for an employee. Employee-specific rows override the
 * company default (employee_id NULL); the newest effective_from <= date wins.
 */
async function scheduleResolver(employee, db = knex) {
  const rows = await db('work_schedules')
    .where((q) => q.whereNull('employee_id').orWhere('employee_id', employee.id))
    .orderBy('effective_from', 'desc');
  const shifts = await db('shifts');
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const fallbackShift = shiftById.get(employee.shift_id) || shifts.find((s) => s.name.toLowerCase() === 'morning') || shifts[0];

  return function resolve(date, weekday) {
    const pick = (own) => rows.find((r) => (own ? r.employee_id === employee.id : r.employee_id === null)
      && r.weekday === weekday && r.effective_from <= date);
    const row = pick(true) || pick(false);
    const working = row ? row.is_working_day : weekday !== 0;
    // Employee's assigned shift takes precedence over the schedule's default shift.
    const shift = shiftById.get(employee.shift_id) || (row && shiftById.get(row.shift_id)) || fallbackShift;
    return { working, shift };
  };
}

/** Accounting month for a sale date, honouring an optional payroll cutoff day. */
function accountingMonthFor(saleDate, cutoffDay) {
  const [y, m, d] = saleDate.split('-').map(Number);
  if (cutoffDay && d > cutoffDay) {
    const next = new Date(Date.UTC(y, m, 1));
    return next.toISOString().slice(0, 8) + '01';
  }
  return `${saleDate.slice(0, 8)}01`;
}

/** Period dates for a payroll month (calendar month, or cutoff-based). */
function periodBounds(monthFirst, cutoffDay) {
  const { addDays, monthEnd } = require('../utils/time');
  if (!cutoffDay) return { start: monthFirst, end: monthEnd(monthFirst) };
  const [y, m] = monthFirst.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const start = addDays(`${prev.slice(0, 8)}${String(cutoffDay).padStart(2, '0')}`, 1);
  const end = `${monthFirst.slice(0, 8)}${String(cutoffDay).padStart(2, '0')}`;
  return { start, end };
}

module.exports = { policyFor, normalizePolicy, scheduleResolver, accountingMonthFor, periodBounds };
