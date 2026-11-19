'use strict';
/**
 * Pure payroll calculator.
 *
 *   Gross Earnings   = Base Salary + Earned Commission + Approved Bonus
 *   Total Deductions = Attendance Deductions + Unpaid Leave Deductions
 *                      + Advance Recovery + Other Authorised Deductions
 *   Net Salary       = Gross Earnings − Total Deductions
 *
 * Every amount is produced as a line item (rounded half-up to 2dp) so the
 * payslip, the database and the dashboard always show identical numbers.
 * Each day contributes to at most one deduction bucket.
 */
const { D, round2, toMoney, sum, Decimal } = require('../utils/money');

const ATTENDANCE_CODES = ['LATE', 'EARLY', 'ABSENCE', 'NOT_EMPLOYED'];
const LEAVE_CODES = ['UNPAID_LEAVE', 'EXCESS_PAID_LEAVE', 'UNPAID_HOLIDAY'];

function lateAmountForDay(lateMinutes, policy, basisAmount) {
  if (lateMinutes <= policy.graceMinutes) return D(0);
  if (policy.lateRuleType === 'tiered') {
    let pct = null;
    for (const t of policy.lateTiers) if (lateMinutes >= t.minMinutes) pct = t.percent;
    return pct === null ? D(0) : basisAmount.times(D(pct)).dividedBy(100);
  }
  const hours = policy.lateRounding === 'started_hour'
    ? D(Math.ceil(lateMinutes / 60))
    : D(lateMinutes).dividedBy(60);
  return hours.times(basisAmount).times(D(policy.lateRatePercent)).dividedBy(100);
}

/**
 * @param {object} p
 * @param {object} p.employee          {id, base_salary, employee_code, full_name}
 * @param {object} p.period            {month, start, end}
 * @param {object} p.policy            normalised policy
 * @param {object[]} p.days            output of attendance-engine.computeDays (+reviewed flags)
 * @param {object[]} p.commissions     Earned commission entries for the month
 * @param {object[]} p.sales           all sales of the month (for revenue totals / warnings)
 * @param {object[]} p.adjustments     payroll adjustments of the month (any status)
 * @param {object[]} p.advances        Active advances eligible this month
 * @param {object[]} p.pendingCorrections corrections pending in the period
 * @param {string}  p.today
 */
function calculatePayroll(p) {
  const { employee, period, policy, days, commissions, sales, adjustments, advances, pendingCorrections, today } = p;
  const base = round2(employee.base_salary);
  const lines = [];
  const blockers = [];
  const warnings = [];
  const add = (line_type, code, description, amount, extra = {}) => {
    const a = round2(amount);
    if (a.isZero() && line_type !== 'EARNING' && code !== 'BASE') return;
    lines.push({ line_type, code, description, amount: a.toFixed(2), sort_order: lines.length, ...extra });
  };

  // ---------- day classification ----------
  const scheduledDays = days.filter((d) => d.scheduled_working);
  const counted = { present: 0, absent: D(0), paidLeave: [], unpaidLeave: D(0), notEmployed: 0, upcoming: 0, unpaidHoliday: 0 };
  let lateMinutesTotal = 0; let earlyMinutesTotal = 0;
  for (const d of days) {
    const s = d.status;
    if (s === 'Present' || s === 'Late' || s === 'MissingCheckOut') counted.present += 1;
    if (s === 'Upcoming') counted.upcoming += 1;
    if (s === 'NotEmployed' && d.scheduled_working) counted.notEmployed += 1;
    if (s === 'Holiday' && d.holiday && d.holiday.is_paid === false) counted.unpaidHoliday += 1;
    if (s === 'Absent') counted.absent = counted.absent.plus(D(1).minus(D(d.leave_fraction || 0)));
    const lf = D(d.leave_fraction || 0);
    if (lf.gt(0) && d.leave_pay_type === 'Paid') counted.paidLeave.push({ date: d.attendance_date, units: lf });
    if (lf.gt(0) && d.leave_pay_type === 'Unpaid') counted.unpaidLeave = counted.unpaidLeave.plus(lf);
    if (d.scheduled_working) {
      lateMinutesTotal += d.late_minutes || 0;
      earlyMinutesTotal += d.early_departure_minutes || 0;
    }

    if (s === 'MissingCheckOut') blockers.push({ code: 'MISSING_CHECKOUT', date: d.attendance_date, message: `Missing check-out on ${d.attendance_date}` });
    if (s === 'MissingCheckIn') blockers.push({ code: 'MISSING_CHECKIN', date: d.attendance_date, message: `Missing check-in on ${d.attendance_date}` });
    if (s === 'PendingLeave') blockers.push({ code: 'PENDING_LEAVE', date: d.attendance_date, message: `Leave decision pending for ${d.attendance_date}` });
    if (policy.severeLateRequiresReview && d.scheduled_working && (d.late_minutes || 0) >= policy.severeLateMinutes && !d.reviewed
        && (s === 'Late' || s === 'Present')) {
      blockers.push({ code: 'SEVERE_LATE', date: d.attendance_date, message: `Severe late (${d.late_minutes} min) on ${d.attendance_date} needs manager review` });
    }
  }

  // ---------- divisor & daily rate ----------
  let divisor;
  if (policy.workingDaysBasis === 'fixed') divisor = D(policy.fixedWorkingDays);
  else if (policy.workingDaysBasis === 'calendar') divisor = D(days.length);
  else divisor = D(scheduledDays.length);
  const dailyRate = divisor.gt(0) ? base.dividedBy(divisor) : D(0);
  if (divisor.lte(0)) blockers.push({ code: 'NO_WORKING_DAYS', message: 'No scheduled working days in this period' });

  // ---------- earnings ----------
  add('EARNING', 'BASE', 'Base salary', base, { quantity: '1', rate: base.toFixed(4) });

  const commissionTotal = sum(commissions.map((c) => c.amount));
  for (const c of commissions) {
    add('EARNING', 'COMMISSION', `Commission ${c.sale_reference} · ${D(c.rate_percent).toString()}% of PKR ${D(c.sale_amount).toFixed(2)}`,
      c.amount, { quantity: c.sale_amount, rate: c.rate_percent, source_table: 'commission_entries', source_id: String(c.id) });
  }
  const approvedAdj = adjustments.filter((a) => a.status === 'Approved');
  const bonusTotal = sum(approvedAdj.filter((a) => a.adjustment_type === 'EARNING').map((a) => a.amount));
  for (const a of approvedAdj.filter((x) => x.adjustment_type === 'EARNING')) {
    add('EARNING', 'BONUS', `${a.category === 'BONUS' ? 'Approved bonus' : 'Approved adjustment'}: ${a.reason}`, a.amount,
      { source_table: 'payroll_adjustments', source_id: String(a.id) });
  }

  // ---------- attendance deductions ----------
  let attendanceDed = D(0);
  if (policy.lateDeductionEnabled || policy.earlyDeductionEnabled) {
    const basisAmount = policy.lateBasis === 'monthly' ? base : dailyRate;
    let lateRaw = D(0); let earlyRaw = D(0); let lateDaysCharged = 0;
    for (const d of days) {
      if (!d.scheduled_working || !['Late', 'Present', 'MissingCheckOut'].includes(d.status)) continue;
      if (policy.lateDeductionEnabled) {
        const amt = lateAmountForDay(d.late_minutes || 0, policy, basisAmount);
        if (amt.gt(0)) { lateRaw = lateRaw.plus(amt); lateDaysCharged += 1; }
      }
      if (policy.earlyDeductionEnabled && (d.early_departure_minutes || 0) > policy.earlyGraceMinutes) {
        const hours = D(Math.ceil(d.early_departure_minutes / 60));
        earlyRaw = earlyRaw.plus(hours.times(basisAmount).times(D(policy.earlyRatePercent)).dividedBy(100));
      }
    }
    const cap = base.times(D(policy.lateCapPercent)).dividedBy(100);
    const combined = lateRaw.plus(earlyRaw);
    const capped = Decimal.min(combined, cap);
    const factor = combined.gt(0) ? capped.dividedBy(combined) : D(0);
    const lateFinal = lateRaw.times(factor);
    const earlyFinal = earlyRaw.times(factor);
    if (combined.gt(cap)) warnings.push({ code: 'LATE_CAP', message: `Late/early deductions capped at ${policy.lateCapPercent}% of base salary` });
    add('DEDUCTION', 'LATE', `Late arrival deduction (${lateDaysCharged} day(s), ${policy.lateRuleType === 'tiered' ? 'tiered' : `${policy.lateRatePercent}%/hour`}, ${policy.lateBasis} basis, grace ${policy.graceMinutes}m)`,
      lateFinal, { quantity: String(lateDaysCharged) });
    add('DEDUCTION', 'EARLY', `Early departure deduction (${policy.earlyRatePercent}%/started hour)`, earlyFinal);
  }
  if (policy.absenceDeductionEnabled && counted.absent.gt(0)) {
    add('DEDUCTION', 'ABSENCE', `Absence (${counted.absent.toString()} day(s) × daily rate)`, counted.absent.times(dailyRate),
      { quantity: counted.absent.toString(), rate: dailyRate.toFixed(4) });
  }
  if (counted.notEmployed > 0) {
    add('DEDUCTION', 'NOT_EMPLOYED', `Pro-rata: ${counted.notEmployed} scheduled day(s) outside employment dates`, D(counted.notEmployed).times(dailyRate),
      { quantity: String(counted.notEmployed), rate: dailyRate.toFixed(4) });
  }

  // ---------- unpaid leave ----------
  const allowance = D(policy.paidLeaveDaysPerMonth);
  let usedPaid = D(0); let excess = D(0);
  for (const pl of counted.paidLeave.sort((a, b) => a.date.localeCompare(b.date))) {
    const room = Decimal.max(D(0), allowance.minus(usedPaid));
    const take = Decimal.min(room, pl.units);
    usedPaid = usedPaid.plus(take);
    excess = excess.plus(pl.units.minus(take));
  }
  if (counted.unpaidLeave.gt(0)) {
    add('DEDUCTION', 'UNPAID_LEAVE', `Unpaid leave (${counted.unpaidLeave.toString()} day(s))`, counted.unpaidLeave.times(dailyRate),
      { quantity: counted.unpaidLeave.toString(), rate: dailyRate.toFixed(4) });
  }
  if (excess.gt(0)) {
    add('DEDUCTION', 'EXCESS_PAID_LEAVE', `Paid leave beyond monthly allowance of ${allowance.toString()} day(s) (${excess.toString()} day(s))`,
      excess.times(dailyRate), { quantity: excess.toString(), rate: dailyRate.toFixed(4) });
  }
  if (counted.unpaidHoliday > 0) {
    add('DEDUCTION', 'UNPAID_HOLIDAY', `Unpaid holiday (${counted.unpaidHoliday} day(s))`, D(counted.unpaidHoliday).times(dailyRate));
  }

  // ---------- advances ----------
  for (const a of advances) {
    const inst = Decimal.min(D(a.monthly_recovery), D(a.remaining_balance));
    if (inst.gt(0)) {
      add('DEDUCTION', 'ADVANCE', `Advance recovery #${a.id} (balance PKR ${D(a.remaining_balance).toFixed(2)})`, inst,
        { source_table: 'salary_advances', source_id: String(a.id) });
    }
  }

  // ---------- other authorised deductions ----------
  for (const a of approvedAdj.filter((x) => x.adjustment_type === 'DEDUCTION')) {
    add('DEDUCTION', 'OTHER', `Authorised deduction: ${a.reason}`, a.amount, { source_table: 'payroll_adjustments', source_id: String(a.id) });
  }

  // ---------- totals from rounded lines ----------
  const amountOf = (pred) => sum(lines.filter(pred).map((l) => l.amount));
  attendanceDed = amountOf((l) => ATTENDANCE_CODES.includes(l.code));
  const unpaidLeaveDed = amountOf((l) => LEAVE_CODES.includes(l.code));
  const advanceDed = amountOf((l) => l.code === 'ADVANCE');
  const otherDed = amountOf((l) => l.code === 'OTHER');
  const gross = amountOf((l) => l.line_type === 'EARNING');
  const totalDed = amountOf((l) => l.line_type === 'DEDUCTION');
  const net = gross.minus(totalDed);

  // ---------- blockers & warnings ----------
  if (base.lte(0)) blockers.unshift({ code: 'INVALID_SALARY', message: 'Invalid salary configuration: base salary is not set' });
  for (const c of pendingCorrections) blockers.push({ code: 'PENDING_CORRECTION', date: c.attendance_date, message: `Attendance correction pending for ${c.attendance_date}` });
  for (const a of adjustments.filter((x) => x.status === 'Pending')) {
    blockers.push({ code: 'PENDING_ADJUSTMENT', message: `Payroll correction pending: ${a.reason}` });
  }
  if (net.lt(0)) blockers.push({ code: 'NEGATIVE_NET', message: 'Net salary is negative; manual review required' });
  if (period.end > today) {
    const msg = `Period in progress until ${period.end}; ${counted.upcoming} upcoming scheduled day(s) are treated as worked`;
    if (policy.blockApprovalUntilPeriodEnd) blockers.push({ code: 'PERIOD_OPEN', message: msg });
    else warnings.push({ code: 'PERIOD_OPEN', message: msg });
  }
  const pendingSales = sales.filter((s) => s.status === 'Pending');
  if (pendingSales.length) warnings.push({ code: 'PENDING_SALES', message: `${pendingSales.length} pending sale(s) are not included until verified` });
  if (!policy.lateDeductionEnabled) warnings.push({ code: 'LATE_POLICY_OFF', message: 'Late-arrival deductions are disabled in policy settings' });

  const revenueTotal = sum(sales.filter((s) => s.status === 'Verified').map((s) => s.sale_amount));
  // de-duplicate blockers (same code+date)
  const seen = new Set();
  const uniqueBlockers = blockers.filter((b) => { const k = `${b.code}|${b.date || ''}|${b.message}`; if (seen.has(k)) return false; seen.add(k); return true; });

  return {
    lines,
    blockers: uniqueBlockers,
    warnings,
    totals: {
      base_salary: base.toFixed(2),
      scheduled_days: String(scheduledDays.length),
      divisor_days: divisor.toString(),
      daily_rate: dailyRate.toFixed(4),
      present_days: String(counted.present),
      absent_days: counted.absent.toString(),
      paid_leave_days: usedPaid.toString(),
      unpaid_leave_days: counted.unpaidLeave.plus(excess).toString(),
      late_minutes: lateMinutesTotal,
      early_minutes: earlyMinutesTotal,
      revenue_total: toMoney(revenueTotal),
      commission_total: toMoney(commissionTotal),
      bonus_total: toMoney(bonusTotal),
      gross_earnings: toMoney(gross),
      attendance_deductions: toMoney(attendanceDed),
      unpaid_leave_deduction: toMoney(unpaidLeaveDed),
      advance_recovery: toMoney(advanceDed),
      other_deductions: toMoney(otherDed),
      total_deductions: toMoney(totalDed),
      net_salary: toMoney(net),
    },
    stats: {
      upcomingDays: counted.upcoming,
      pendingLeaveDays: days.filter((d) => d.status === 'PendingLeave').length,
      approvedLeaveDays: days.filter((d) => d.leave_fraction > 0 && ['PaidLeave', 'UnpaidLeave', 'Present', 'Late', 'Absent'].includes(d.status) && d.leave_request_id).length,
    },
  };
}

module.exports = { calculatePayroll, lateAmountForDay, ATTENDANCE_CODES, LEAVE_CODES };
