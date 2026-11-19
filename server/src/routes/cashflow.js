// ═══════════════════════════════════════════════════════════════════════════
//  Cash Flow Manager (v5) — built for a study-abroad consultancy
//  • Cash position, cash runway, cash forecast (cash budget) with surplus / deficit
//  • Inflow vs outflow timing (when money comes in vs goes out, intra-month low point)
//  • Working capital: receivables (students / partners), payables, inventory, cash conversion cycle
//  • Cash models data (Baumol, Miller–Orr, cash discount vs interest cost)
//  • Treasury & banking (accounts, overdraft / running finance lines), planned cash items
//  • Budget allotment: cash given to employees (their own "petty cash") + petty-cash top-ups
//  • Payment control: approve / hold / release / reject constant (and variable) expenses in bulk
//  One projection engine (projectDays) feeds the forecast, runway and timing pages, so they always agree.
// ═══════════════════════════════════════════════════════════════════════════
import express from 'express';
import { one, many, query, tx } from '../db.js';
import { ah, bad, forbidden, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requirePerm, requireApprover, requireAdmin, rateLimit } from '../middleware/auth.js';
import { isAdmin, can } from '../lib/permissions.js';
import { audit, diff } from '../lib/audit.js';
import { notify } from '../lib/notify.js';
import { sendMail, template, link } from '../lib/email.js';
import { sum, sub, add, pkr, currentMonth, addMonths, today, monthLabel } from '../lib/money.js';
import { paging, Where, qstr, qid, likeText } from '../lib/paging.js';
import { periodFigures, books } from './finance.js';
import { liabilityData } from './liabilities.js';
import { allocate, METHODS } from './revenue.js';
import {
  EXP_SELECT, expenseWhere, listExpenses, variableFields, history, isDue, pettyBalance, reviewTopup, TOPUP, tomorrow,
  conflict, version, idList, approverEmails, ensureCycles, categoryTree,
} from './expenses.js';
import { upload, saveFile, txWithFiles } from '../lib/files.js';
import { readCustom, saveCustom } from '../lib/forms.js';
import { walletOf, walletBalance, walletActive, lockWallet } from '../lib/budget.js';
import { positionAt } from '../lib/position.js';
import { baumol, millerOrr, millerOrrAction, stats } from '../lib/cashmodels.js';

// ───────────── small date helpers (all 'YYYY-MM-DD' strings) ─────────────
const pad = n => String(n).padStart(2, '0');
const r2 = n => Math.round(Number(n || 0) * 100) / 100;
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const lastDay = m => { const [y, mo] = m.split('-').map(Number); return `${m}-${pad(new Date(Date.UTC(y, mo, 0)).getUTCDate())}`; };
const daysIn = m => Number(lastDay(m).slice(8));
const dayDiff = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
const onDay = (m, d) => `${m}-${pad(Math.min(Number(d) || 1, daysIn(m)))}`;
const maxDate = (a, b) => (a > b ? a : b);
const bool = x => x === true || x === 1 || ['true', '1', 'on', 'yes'].includes(String(x ?? '').toLowerCase());
const shortDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
function addMonthsDay(d, n) {
  const [y, mo, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
function monthsBetween(a, b) { const out = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; }

// ═════════════ Settings ═════════════
export const STUDY_ABROAD_SEASON = [115, 95, 90, 100, 110, 125, 130, 115, 85, 90, 105, 120]; // Jan…Dec: fee rush before the Sep & Jan intakes
export const CF_DEFAULTS = {
  opening_balance: null, opening_date: null,       // cash in bank + office at the START of opening_date
  min_cash_buffer: 0, buffer_months: 1,            // 0 = automatic: buffer_months × average monthly cash out
  burn_months: 3, forecast_months: 6, timing_days: 90,
  collection_rate: 90, overdue_collection: 50,      // % of scheduled installments / overdue fees expected to arrive
  growth_pct: 0, seasonality: Array(12).fill(100),  // new-sales cash: monthly growth % and month factors (100 = normal)
  tax_rate: 0, salary_day: 1,                       // advance / withholding tax as % of collections; day salaries are paid
  transaction_cost: 1500, interest_rate: 12,        // Baumol / Miller–Orr: cost per transfer (PKR) and annual interest %
  dso_target: 30, dpo_target: 30, dio_target: 45,
};
export async function cfSettings() {
  const row = await one(`SELECT value FROM app_settings WHERE key='cashflow'`);
  const s = { ...CF_DEFAULTS, ...(row?.value || {}) };
  if (!Array.isArray(s.seasonality) || s.seasonality.length !== 12) s.seasonality = [...CF_DEFAULTS.seasonality];
  return s;
}
function readSettings(b, cur) {
  const num = (k, label, o = {}) => (b[k] === undefined ? cur[k] : v.amount(b[k] === '' ? 0 : b[k], label, { allowZero: true, ...o }));
  const int = (k, label, min, max) => (b[k] === undefined ? cur[k] : v.int(b[k], label, { min, max }));
  const s = {
    ...cur,
    min_cash_buffer: num('min_cash_buffer', 'Minimum cash buffer'),
    buffer_months: b.buffer_months === undefined ? cur.buffer_months : Math.min(12, Math.max(0, Number(b.buffer_months) || 0)),
    burn_months: int('burn_months', 'Months for average burn', 1, 12),
    forecast_months: int('forecast_months', 'Forecast months', 3, 18),
    timing_days: int('timing_days', 'Timing window (days)', 14, 180),
    collection_rate: int('collection_rate', 'Collection rate %', 0, 100),
    overdue_collection: int('overdue_collection', 'Overdue recovery %', 0, 100),
    growth_pct: b.growth_pct === undefined ? cur.growth_pct : Math.max(-50, Math.min(50, Number(b.growth_pct) || 0)),
    tax_rate: b.tax_rate === undefined ? cur.tax_rate : v.percent(b.tax_rate, 'Tax % of collections'),
    salary_day: int('salary_day', 'Salary day', 1, 28),
    transaction_cost: num('transaction_cost', 'Cost per transfer'),
    interest_rate: b.interest_rate === undefined ? cur.interest_rate : v.percent(b.interest_rate, 'Interest rate %'),
    dso_target: int('dso_target', 'Receivable days target', 1, 365),
    dpo_target: int('dpo_target', 'Payable days target', 1, 365),
    dio_target: int('dio_target', 'Inventory days target', 1, 365),
  };
  if (b.seasonality !== undefined) {
    const list = v.json(b.seasonality, []);
    if (!Array.isArray(list) || list.length !== 12) throw bad('Seasonality needs 12 values (January to December).');
    s.seasonality = list.map((x, i) => { const n = Number(x); if (!(n >= 0 && n <= 300)) throw bad(`Month ${i + 1} factor must be between 0 and 300.`); return Math.round(n); });
  }
  if (b.opening_balance !== undefined) {
    if (b.opening_balance === '' || b.opening_balance === null) { s.opening_balance = null; s.opening_date = null; } else {
      const n = Number(String(b.opening_balance).replace(/,/g, ''));
      if (!Number.isFinite(n) || Math.abs(n) > 1e13) throw bad('Opening cash balance must be a number.');
      s.opening_balance = r2(n);
      s.opening_date = v.date(b.opening_date, 'Opening balance date');
      if (s.opening_date > tomorrow()) throw bad('Opening balance date cannot be in the future.');
    }
  }
  return s;
}

// ═════════════ Shared data ═════════════
/** Monthly cash in / out for the last n months (the last one is the current, partial month). */
async function monthlyHistory(n, pre) {
  const end = currentMonth();
  return Promise.all(Array.from({ length: n }, (_, k) => addMonths(end, k - (n - 1))).map(async m => {
    const p = await periodFigures(`${m}-01`, lastDay(m), pre);
    return { month: m, label: monthLabel(m), inflow: p.cash.inflow, outflow: p.cash.outflow, net: p.cash.net, in: p.cash.in, out: p.cash.out, revenue: p.revenue.net, expenses: p.expenses.total };
  }));
}

/** Average of the last `burn_months` complete months that had activity (falls back to the current month, scaled). */
function averages(hist, s) {
  const cur = hist[hist.length - 1];
  let use = hist.slice(0, -1).filter(h => h.inflow || h.outflow).slice(-s.burn_months);
  let scaled = false;
  if (!use.length) {
    const d = Number(today().slice(8));
    const f = daysIn(cur.month) / Math.max(1, d);
    use = [{ ...cur, inflow: cur.inflow * f, outflow: cur.outflow * f, out: Object.fromEntries(Object.entries(cur.out).map(([k, x]) => [k, x * f])), in: Object.fromEntries(Object.entries(cur.in).map(([k, x]) => [k, x * f])) }];
    scaled = true;
  }
  const avg = fn => r2(use.reduce((a, h) => a + fn(h), 0) / use.length);
  return {
    months: use.map(h => h.month), scaled,
    inflow: avg(h => h.inflow), outflow: avg(h => h.outflow),
    out: Object.fromEntries(Object.keys(cur.out).map(k => [k, avg(h => h.out[k] || 0)])),
    in: Object.fromEntries(Object.keys(cur.in).map(k => [k, avg(h => h.in[k] || 0)])),
  };
}

/** Total unspent cash sitting with employees' budgets. */
async function walletsTotal() {
  const r = await one(`SELECT COALESCE(SUM(b),0)::numeric AS n, COUNT(*) FILTER (WHERE state='active')::int AS active FROM (
      SELECT w.state,
             (SELECT COALESCE(SUM(CASE WHEN kind='allot' THEN amount ELSE -amount END),0) FROM budget_entries be WHERE be.user_id=w.user_id AND be.status='approved')
           - (SELECT COALESCE(SUM(amount),0) FROM expenses e WHERE e.budget_holder_id=w.user_id AND e.status <> 'rejected') AS b
        FROM budget_wallets w) x`);
  return { balance: Number(r.n), active: r.active };
}

const LIQUID = ['bank', 'cash', 'wallet', 'deposit'];
const CREDIT = ['overdraft', 'running_finance', 'loan_facility'];
const pkrOf = a => r2(Number(a.balance) * Number(a.fx_rate || 1));

/** Where the cash number comes from, today's cash, cash with staff, bank statements and unused credit lines. */
export async function cashPosition(s, pre) {
  const t = today();
  const accts = await many(`SELECT * FROM treasury_accounts WHERE active ORDER BY kind, name`);
  const liquid = accts.filter(a => LIQUID.includes(a.kind));
  const credit = accts.filter(a => CREDIT.includes(a.kind));
  const statements = sum(liquid, pkrOf);
  let basis = 'system', amount = 0, from = '2000-01-01';
  if (s.opening_balance !== null && s.opening_balance !== undefined && s.opening_date) { basis = 'opening'; amount = Number(s.opening_balance); from = s.opening_date; }
  else if (liquid.length) { basis = 'treasury'; amount = statements; from = addDays(liquid.map(a => a.as_of).sort().pop(), 1); }
  const net = from <= t ? (await periodFigures(from, t, pre)).cash.net : 0;
  const cash = add(amount, net);
  const petty = await pettyBalance();
  const wallets = await walletsTotal();
  const lines = credit.map(a => {
    const limit = r2(Number(a.credit_limit) * Number(a.fx_rate || 1)), used = Math.max(0, pkrOf(a));
    return { id: a.id, name: a.name, kind: a.kind, institution: a.institution, limit, used, available: Math.max(0, r2(limit - used)), rate: Number(a.interest_rate) };
  }).sort((a, b) => a.rate - b.rate);
  return {
    basis, anchor: { amount, from }, netSince: net, cash,
    withStaff: { petty: petty.balance, budgets: wallets.balance, total: add(petty.balance, wallets.balance) },
    statements: { total: statements, count: liquid.length, difference: liquid.length ? sub(statements, cash) : null },
    credit: { limit: sum(lines, 'limit'), used: sum(lines, 'used'), available: sum(lines, 'available'), lines },
  };
}

/** Every unpaid installment of every open sale (students' fees still to come). */
export async function loadReceivables() {
  const sales = await many(`
    SELECT s.id, s.invoice_no, s.total_amount, s.sale_date, s.due_date, s.package, s.destination, c.name AS customer, c.phone AS customer_phone,
           u.full_name AS employee_name, COALESCE(p.paid,0)::numeric AS paid
      FROM sales s JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.employee_id
      LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM sale_payments WHERE sale_id=s.id) p ON TRUE
      LEFT JOIN LATERAL (SELECT SUM(amount) AS refunded FROM sale_refunds WHERE sale_id=s.id) rf ON TRUE
     WHERE s.total_amount - COALESCE(p.paid,0) > 0.004
       AND NOT (COALESCE(rf.refunded,0) > 0 AND COALESCE(rf.refunded,0) >= COALESCE(p.paid,0))`);
  const ids = sales.map(x => x.id);
  const inst = ids.length ? await many('SELECT sale_id, seq, due_date, amount FROM sale_installments WHERE sale_id = ANY($1::bigint[]) ORDER BY sale_id, seq', [ids]) : [];
  const bySale = new Map();
  for (const i of inst) { if (!bySale.has(i.sale_id)) bySale.set(i.sale_id, []); bySale.get(i.sale_id).push(i); }
  const t = today();
  const items = [];
  for (const s of sales) {
    const open = sub(s.total_amount, s.paid);
    const base = { sale_id: s.id, invoice_no: s.invoice_no, customer: s.customer, phone: s.customer_phone, employee_name: s.employee_name, package: s.package, destination: s.destination, sale_date: s.sale_date };
    const plan = bySale.get(s.id) || [];
    let planned = 0;
    for (const a of allocate(plan, s.paid)) {
      if (a.remaining <= 0) continue;
      planned = add(planned, a.remaining);
      items.push({ ...base, due_date: a.due_date, amount: a.remaining, installment: a.seq });
    }
    const rest = sub(open, planned);
    if (rest > 0.004) items.push({ ...base, due_date: s.due_date || s.sale_date, amount: rest, installment: null });
  }
  for (const i of items) i.days_overdue = Math.max(0, dayDiff(i.due_date, t));
  return { sales, items };
}

// ═════════════ Projection engine ═════════════
const IN_KEYS = ['receivables', 'overdue', 'newSales', 'planned'];
const OUT_KEYS = ['salaries', 'rent', 'bills', 'taxes', 'variable', 'petty', 'loans', 'payables', 'planned'];
export const IN_LABELS = { receivables: 'Student fee installments due', overdue: 'Overdue fees (expected recovery)', newSales: 'New sales (expected cash)', planned: 'Planned receipts (commissions, owner money…)' };
export const OUT_LABELS = { salaries: 'Salaries', rent: 'Rent & lease', bills: 'Bills, utilities & subscriptions', taxes: 'Taxes & fees', variable: 'Variable + marketing expenses (average)', petty: 'Petty cash & staff budgets (average)', loans: 'Loan / finance repayments', payables: 'Bills waiting approval (payables)', planned: 'Planned payments' };
const SCENARIOS = {
  base: { coll: 1, sales: 1, cost: 1, label: 'Expected (base case)' },
  best: { coll: 1.1, sales: 1.15, cost: 0.95, label: 'Best case' },
  worst: { coll: 0.75, sales: 0.75, cost: 1.1, label: 'Worst case' },
};
const bucketOf = e => (/\brent\b|lease/i.test(`${e.sub_category || ''} ${e.title || ''}`) ? 'rent'
  : /\btax|fbr|secp|withholding|challan/i.test(`${e.category || ''} ${e.sub_category || ''} ${e.title || ''}`) ? 'taxes' : 'bills');

/** Everything the engine needs, loaded once. */
async function loadContext(s, pre) {
  const t = today(), cm = currentMonth();
  const hist6 = addMonths(cm, -6);
  const [rec, templates, overrides, cycles, pendingVar, plan, salesM, firstSale, varM, pettyM, varNow, pettyNow, lastPay, baseSal, unpaidSal, paidNow] = await Promise.all([
    loadReceivables(),
    many(`SELECT * FROM recurring_expenses WHERE status='approved' AND state='active'`),
    many(`SELECT * FROM recurring_overrides WHERE cycle_month >= $1`, [cm]),
    many(`SELECT id, ref_no, recurring_id, cycle_month, status, amount, expense_date, on_hold, hold_until, title, category, sub_category
            FROM expenses WHERE expense_type='constant' AND NOT is_petty_topup AND (cycle_month >= $1 OR status='pending')`, [cm]),
    many(`SELECT id::text AS id, ref_no, amount, expense_date, on_hold, hold_until, title, category, sub_category FROM expenses
           WHERE expense_type='variable' AND NOT is_petty_topup AND status='pending'
           UNION ALL
           SELECT e.id::text AS id, 'MKT-' || left(e.id::text, 8) AS ref_no, e.amount_pkr AS amount, e.occurred_on AS expense_date, FALSE AS on_hold, NULL::date AS hold_until, e.title, c.name AS category, sc.name AS sub_category
             FROM marketing.expenses e JOIN marketing.subcategories sc ON sc.id=e.subcategory_id JOIN marketing.categories c ON c.id=sc.category_id
            WHERE e.status IN ('Pending','In Review')`),
    many(`SELECT * FROM cash_plan_items WHERE active`),
    many(`SELECT to_char(p.payment_date,'YYYY-MM') AS m, SUM(p.amount)::numeric AS n FROM sale_payments p JOIN sales s ON s.id=p.sale_id
           WHERE to_char(p.payment_date,'YYYY-MM') = to_char(s.sale_date,'YYYY-MM') AND p.payment_date >= $1 GROUP BY 1`, [`${hist6}-01`]),
    one(`SELECT to_char(MIN(sale_date),'YYYY-MM') AS m FROM sales`),
    many(`SELECT m, SUM(n)::numeric AS n FROM (SELECT to_char(expense_date,'YYYY-MM') AS m, SUM(amount)::numeric AS n FROM expenses WHERE status='approved' AND expense_type='variable' AND NOT is_petty_topup AND expense_date >= $1 AND expense_date < $2 GROUP BY 1 UNION ALL SELECT to_char(occurred_on,'YYYY-MM') AS m, SUM(amount_pkr)::numeric AS n FROM marketing.expenses WHERE status='Approved' AND occurred_on >= $1 AND occurred_on < $2 GROUP BY 1) x GROUP BY m`, [`${hist6}-01`, `${cm}-01`]),
    many(`SELECT to_char(entry_date,'YYYY-MM') AS m, SUM(amount)::numeric AS n FROM petty_cash_entries WHERE status <> 'rejected' AND entry_date >= $1 AND entry_date < $2 GROUP BY 1`, [`${hist6}-01`, `${cm}-01`]),
    one(`SELECT ((SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status <> 'rejected' AND expense_type='variable' AND NOT is_petty_topup AND expense_date >= $1) + (SELECT COALESCE(SUM(amount_pkr),0) FROM marketing.expenses WHERE status='Approved' AND occurred_on >= $1))::numeric AS n`, [`${cm}-01`]),
    one(`SELECT COALESCE(SUM(amount),0)::numeric AS n FROM petty_cash_entries WHERE status <> 'rejected' AND entry_date >= $1`, [`${cm}-01`]),
    one(`WITH payroll_rows AS (
           SELECT pm.month, pm.snap_net AS amount, u.employee_code
             FROM payroll_months pm JOIN users u ON u.id=pm.user_id
            WHERE pm.status IN ('approved','paid')
           UNION ALL
           SELECT to_char(pp.period_month,'YYYY-MM') AS month, pr.net_salary AS amount, e.employee_code
             FROM workforce.payroll_records pr JOIN workforce.payroll_periods pp ON pp.id=pr.period_id
             JOIN workforce.employees e ON e.id=pr.employee_id
            WHERE pr.status IN ('Approved','Paid')
              AND NOT EXISTS (SELECT 1 FROM payroll_months old_pm JOIN users old_u ON old_u.id=old_pm.user_id
                               WHERE old_pm.month=to_char(pp.period_month,'YYYY-MM') AND old_pm.status IN ('approved','paid')
                                 AND upper(old_u.employee_code)=upper(e.employee_code))
         ) SELECT month, SUM(amount)::numeric AS n, COUNT(*)::int AS c FROM payroll_rows GROUP BY month ORDER BY month DESC LIMIT 1`),
    one(`WITH salary_rows AS (
           SELECT e.base_salary AS amount FROM workforce.employees e WHERE e.employment_status='Active'
           UNION ALL
           SELECT t.base_salary AS amount FROM users u
             JOIN LATERAL (SELECT base_salary FROM salary_terms st WHERE st.user_id=u.id AND st.effective_month <= $1 ORDER BY st.effective_month DESC LIMIT 1) t ON TRUE
            WHERE u.status='approved' AND NOT EXISTS (SELECT 1 FROM workforce.employees e WHERE upper(e.employee_code)=upper(u.employee_code))
         ) SELECT COALESCE(SUM(amount),0)::numeric AS n, COUNT(*)::int AS c FROM salary_rows`, [cm]),
    one(`SELECT COALESCE(SUM(amount),0)::numeric AS n, COUNT(*)::int AS c FROM (
           SELECT pm.snap_net AS amount FROM payroll_months pm WHERE pm.status='approved'
           UNION ALL
           SELECT pr.net_salary AS amount FROM workforce.payroll_records pr
             JOIN workforce.payroll_periods pp ON pp.id=pr.period_id JOIN workforce.employees e ON e.id=pr.employee_id
            WHERE pr.status='Approved' AND NOT EXISTS (SELECT 1 FROM payroll_months old_pm JOIN users old_u ON old_u.id=old_pm.user_id
                 WHERE old_pm.month=to_char(pp.period_month,'YYYY-MM') AND old_pm.status IN ('approved','paid')
                   AND upper(old_u.employee_code)=upper(e.employee_code))
         ) unpaid`),
    one(`SELECT COALESCE(SUM(amount),0)::numeric AS n FROM (
           SELECT pm.snap_net AS amount FROM payroll_months pm WHERE pm.status='paid' AND to_char(pm.paid_at,'YYYY-MM')=$1
           UNION ALL
           SELECT pay.amount FROM workforce.payment_records pay JOIN workforce.payroll_records pr ON pr.id=pay.payroll_record_id
             JOIN workforce.payroll_periods pp ON pp.id=pr.period_id JOIN workforce.employees e ON e.id=pr.employee_id
            WHERE pr.status='Paid' AND to_char(pay.payment_date,'YYYY-MM')=$1
              AND NOT EXISTS (SELECT 1 FROM payroll_months old_pm JOIN users old_u ON old_u.id=old_pm.user_id
                   WHERE old_pm.month=to_char(pp.period_month,'YYYY-MM') AND old_pm.status IN ('approved','paid')
                     AND upper(old_u.employee_code)=upper(e.employee_code))
         ) paid`, [cm]),
  ]);
  // complete months in the look-back window that the business existed
  const startM = firstSale?.m && firstSale.m > hist6 ? firstSale.m : hist6;
  const complete = monthsBetween(startM, addMonths(cm, -1)).filter(m => m >= hist6);
  const seas = m => (Number(s.seasonality[Number(m.slice(5)) - 1]) || 100) / 100;
  let salesBase = 0;
  if (complete.length) salesBase = complete.reduce((a, m) => a + Number(salesM.find(x => x.m === m)?.n || 0) / Math.max(0.1, seas(m)), 0) / complete.length;
  else { const nowN = Number(salesM.find(x => x.m === cm)?.n || 0); salesBase = (nowN * daysIn(cm)) / Math.max(1, Number(t.slice(8))) / Math.max(0.1, seas(cm)); }
  const avgOf = (rows, n) => { const list = complete.slice(-n); if (!list.length) return null; return list.reduce((a, m) => a + Number(rows.find(x => x.m === m)?.n || 0), 0) / list.length; };
  const scale = x => (Number(x) * daysIn(cm)) / Math.max(1, Number(t.slice(8)));
  const variableAvg = avgOf(varM, s.burn_months) ?? scale(varNow.n);
  const pettyAvg = avgOf(pettyM, s.burn_months) ?? scale(pettyNow.n);
  const salaryMonthly = lastPay ? Number(lastPay.n) : Number(baseSal.n);
  return {
    t, cm, rec, templates, overrides, cycles, pendingVar, plan, seas, salesBase: r2(salesBase), complete,
    variableAvg: r2(variableAvg), pettyAvg: r2(pettyAvg), variableNow: Number(varNow.n), pettyNow: Number(pettyNow.n),
    salary: { monthly: r2(salaryMonthly), basis: lastPay ? `Last payroll (${monthLabel(lastPay.month)}, ${lastPay.c} staff)` : baseSal.c ? `Base salaries of ${baseSal.c} staff` : 'No salary data yet', approvedUnpaid: Number(unpaidSal.n), paidThisMonth: Number(paidNow.n) },
    loans: pre.rows.filter(l => l.status === 'active' && l.outstanding > 0 && l.installment > 0),
  };
}

/**
 * Day-by-day expected cash in / out from `from` (today) to `to`.
 * Returns { days: [{date, in:{…}, out:{…}}], events: [...], held: [...] }.
 */
function projectDays(ctx, s, scenarioKey, from, to) {
  const sc = SCENARIOS[scenarioKey] || SCENARIOS.base;
  const coll = Math.min(1, (s.collection_rate / 100) * sc.coll);
  const overdueColl = Math.min(1, (s.overdue_collection / 100) * sc.coll);
  const days = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, in: Object.fromEntries(IN_KEYS.map(k => [k, 0])), out: Object.fromEntries(OUT_KEYS.map(k => [k, 0])) });
  const events = [], held = [];
  const put = (date, dir, key, amount, ev) => {
    const d = days.get(date < from ? from : date);
    if (!d || !(amount > 0)) return;
    d[dir][key] += amount;
    if (ev) events.push({ date: date < from ? from : date, dir, bucket: key, amount: r2(amount), ...ev });
  };
  // ── inflows: installments ──
  for (const i of ctx.rec.items) {
    if (i.due_date < from) put(from, 'in', 'overdue', i.amount * overdueColl, { title: `${i.customer} — overdue ${i.days_overdue} day(s)`, ref: i.invoice_no, link: `/revenue/sales?q=${encodeURIComponent(i.invoice_no)}` });
    else if (i.due_date <= to) put(i.due_date, 'in', 'receivables', i.amount * coll, { title: `${i.customer}${i.installment != null ? ` — installment ${i.installment || 'advance'}` : ''}`, ref: i.invoice_no, link: `/revenue/sales?q=${encodeURIComponent(i.invoice_no)}` });
  }
  // ── constant expenses: existing cycles, then templates without a cycle yet ──
  const placeHeld = (e, kind) => {
    if (!e.hold_until) { held.push({ ...e, kind, reason: 'On hold (no release date) — not in the forecast' }); return null; }
    if (e.hold_until > to) { held.push({ ...e, kind, reason: 'Held beyond the forecast window' }); return null; }
    return maxDate(e.hold_until, from);
  };
  for (const e of ctx.cycles) {
    if (e.status === 'rejected') continue; // "do not pay" — and the template must not bring it back
    if (e.on_hold) {
      const date = placeHeld(e, 'constant');
      if (date && date <= to) put(date, 'out', bucketOf(e), e.amount, { title: `${e.title} (held until ${shortDate(e.hold_until)})`, ref: e.ref_no, link: '/cash-flow/payments' });
      continue;
    }
    if (e.expense_date < from) { // approved in the past = already paid; still pending = overdue bill
      if (e.status === 'pending') put(from, 'out', 'payables', e.amount, { title: `${e.title} (overdue bill)`, ref: e.ref_no, link: '/cash-flow/payments' });
      continue;
    }
    if (e.expense_date <= to) put(e.expense_date, 'out', bucketOf(e), e.amount, { title: e.title, ref: e.ref_no, link: '/cash-flow/payments' });
  }
  const made = new Set(ctx.cycles.filter(e => e.recurring_id).map(e => `${e.recurring_id}:${e.cycle_month}`));
  for (const m of monthsBetween(from.slice(0, 7), to.slice(0, 7))) {
    for (const r of ctx.templates) {
      if (!isDue(r, m) || made.has(`${r.id}:${m}`)) continue;
      const o = ctx.overrides.find(x => x.recurring_id === r.id && x.cycle_month === m);
      if (o?.action === 'skip') continue;
      const date = onDay(m, r.billing_day);
      if (date < from || date > to) continue;
      put(date, 'out', bucketOf(r), o?.action === 'amount' ? Number(o.amount) : Number(r.amount), { title: r.title, ref: r.ref_no, link: '/expenses/constant?view=recurring' });
    }
  }
  // ── variable bills already submitted (waiting approval) ──
  for (const e of ctx.pendingVar) {
    const date = e.on_hold ? placeHeld(e, 'variable') : from;
    if (date && date <= to) put(date, 'out', 'payables', e.amount, { title: `${e.title} (${e.on_hold ? `held until ${shortDate(e.hold_until)}` : 'waiting approval'})`, ref: e.ref_no, link: '/cash-flow/payments?type=variable' });
  }
  // ── salaries ──
  for (const m of monthsBetween(from.slice(0, 7), to.slice(0, 7))) {
    let amt = ctx.salary.monthly;
    let date = onDay(m, s.salary_day);
    if (m === ctx.cm) {
      if (ctx.salary.paidThisMonth > 0 && !ctx.salary.approvedUnpaid) continue;
      if (ctx.salary.approvedUnpaid > 0) amt = ctx.salary.approvedUnpaid;
      date = maxDate(date, from);
    }
    if (date >= from && date <= to && amt > 0) put(date, 'out', 'salaries', amt, { title: `Salaries${m === ctx.cm && ctx.salary.approvedUnpaid ? ' (approved, not paid yet)' : ''}`, link: '/salary' });
  }
  // ── loans & finance ──
  for (const l of ctx.loans) {
    let remaining = l.outstanding, due = l.next_due;
    while (due && remaining > 0.004 && due <= to) {
      const amt = Math.min(l.installment, remaining);
      put(maxDate(due, from), 'out', 'loans', amt, { title: `${l.title} — ${l.lender}${due < from ? ' (overdue)' : ''}`, link: '/liabilities' });
      remaining -= amt; due = addMonthsDay(due, 1);
    }
  }
  // ── planned items ──
  const STEP = { monthly: 1, quarterly: 3, yearly: 12 };
  for (const p of ctx.plan) {
    const months = p.repeat === 'once' ? [p.start_month] : monthsBetween(p.start_month, p.end_month && p.end_month < to.slice(0, 7) ? p.end_month : to.slice(0, 7)).filter((m, i) => i % STEP[p.repeat] === 0);
    for (const m of months) {
      const date = onDay(m, p.day);
      if (date < from || date > to) continue;
      const amt = (Number(p.amount) * p.probability) / 100;
      const key = p.direction === 'in' ? 'planned' : /tax/i.test(p.category) ? 'taxes' : /rent/i.test(p.category) ? 'rent' : 'planned';
      put(date, p.direction, key, amt, { title: `${p.title}${p.probability < 100 ? ` (${p.probability}% likely)` : ''}`, ref: p.category, link: '/cash-flow/forecast' });
    }
  }
  // ── smooth daily amounts: new sales, variable, petty, tax ──
  for (const d of days.values()) {
    const m = d.date.slice(0, 7), n = daysIn(m);
    const monthsAhead = Math.max(0, (Number(m.slice(0, 4)) - Number(ctx.cm.slice(0, 4))) * 12 + Number(m.slice(5)) - Number(ctx.cm.slice(5)));
    d.in.newSales += (ctx.salesBase * ctx.seas(m) * sc.sales * (1 + s.growth_pct / 100) ** monthsAhead) / n;
    if (m === ctx.cm) {
      const left = Math.max(1, daysIn(m) - Number(from.slice(8)) + 1);
      d.out.variable += Math.max(0, ctx.variableAvg * sc.cost - ctx.variableNow) / left;
      d.out.petty += Math.max(0, ctx.pettyAvg * sc.cost - ctx.pettyNow) / left;
    } else {
      d.out.variable += (ctx.variableAvg * sc.cost) / n;
      d.out.petty += (ctx.pettyAvg * sc.cost) / n;
    }
    if (s.tax_rate > 0) d.out.taxes += ((d.in.receivables + d.in.overdue + d.in.newSales) * s.tax_rate) / 100;
  }
  return { days: [...days.values()], events: events.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount), held, scenario: { key: SCENARIOS[scenarioKey] ? scenarioKey : 'base', ...sc } };
}

const totalOf = o => Object.values(o).reduce((a, b) => a + b, 0);

/** Day rows → running balance, plus monthly / weekly groups with the lowest point inside each. */
function withBalance(days, start) {
  let bal = start;
  return days.map(d => {
    const inflow = totalOf(d.in), outflow = totalOf(d.out);
    bal += inflow - outflow;
    return { ...d, inflow, outflow, net: inflow - outflow, balance: bal };
  });
}
function roundBuckets(o) { return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, r2(x)])); }

function groupRows(rows, keyFn, labelFn, start) {
  const out = [];
  let opening = start;
  for (const d of rows) {
    const k = keyFn(d.date);
    let g = out[out.length - 1];
    if (!g || g.key !== k) {
      g = { key: k, label: labelFn(d.date), from: d.date, to: d.date, opening, in: Object.fromEntries(IN_KEYS.map(x => [x, 0])), out: Object.fromEntries(OUT_KEYS.map(x => [x, 0])), low: Infinity, lowDate: d.date };
      out.push(g);
    }
    g.to = d.date;
    for (const x of IN_KEYS) g.in[x] += d.in[x];
    for (const x of OUT_KEYS) g.out[x] += d.out[x];
    if (d.balance < g.low) { g.low = d.balance; g.lowDate = d.date; }
    opening = d.balance;
    g.closing = d.balance;
  }
  return out.map(g => {
    const inflow = totalOf(g.in), outflow = totalOf(g.out);
    return { ...g, in: roundBuckets(g.in), out: roundBuckets(g.out), inflow: r2(inflow), outflow: r2(outflow), net: r2(inflow - outflow), opening: r2(g.opening), closing: r2(g.closing), low: r2(g.low) };
  });
}

/** Surplus / deficit + how to fund a deficit from the cheapest credit lines. */
function judge(g, buffer, credit) {
  const status = g.low < 0 ? 'deficit' : g.low < buffer ? 'below_buffer' : 'surplus';
  const need = r2(Math.max(0, buffer - g.low));
  let left = need;
  const financing = [];
  for (const l of credit.lines) {
    if (left <= 0) break;
    if (l.available <= 0) continue;
    const use = Math.min(left, l.available);
    financing.push({ source: l.name, kind: l.kind, amount: r2(use), rate: l.rate, monthlyCost: r2((use * l.rate) / 100 / 12) });
    left -= use;
  }
  return { ...g, buffer: r2(buffer), status, surplus: r2(Math.max(0, g.low - buffer)), deficit: r2(Math.max(0, -g.low)), need, financing, unfunded: r2(Math.max(0, left)) };
}

export async function forecastData({ months, scenario, histMonths = 0 }) {
  const s = await cfSettings();
  const pre = await liabilityData();
  const [pos, hist] = await Promise.all([cashPosition(s, pre), monthlyHistory(Math.max(histMonths, 4, s.burn_months + 1), pre)]);
  const ctx = await loadContext(s, pre);
  const avg = averages(hist, s);
  const buffer = s.min_cash_buffer > 0 ? Number(s.min_cash_buffer) : r2(avg.outflow * s.buffer_months);
  const from = ctx.t, to = lastDay(addMonths(ctx.cm, Math.max(1, months) - 1));
  const proj = projectDays(ctx, s, scenario, from, to);
  const rows = withBalance(proj.days, pos.cash);
  const monthly = groupRows(rows, d => d.slice(0, 7), d => (d.slice(0, 7) === ctx.cm ? `${monthLabel(d.slice(0, 7))} (rest)` : monthLabel(d.slice(0, 7))), pos.cash).map(g => judge(g, buffer, pos.credit));
  return { s, pre, pos, hist, ctx, avg, buffer, proj, rows, monthly, from, to };
}

// ═════════════ Router: /api/cashflow/* (needs "Cash Flow Manager" view) ═════════════
export const cashtools = express.Router();
cashtools.use(requireAuth, requirePerm('cashflow', 'view'));
const writeLimit = rateLimit('cashflow-write', 120, 60 * 1000);
const canEdit = requirePerm('cashflow', 'edit');

// ── Settings ──
cashtools.get('/settings', ah(async (_req, res) => {
  const s = await cfSettings();
  // seasonality learned from the last 24 months of collections (needs 12+ months)
  const rows = await many(`SELECT to_char(payment_date,'YYYY-MM') AS m, SUM(amount)::numeric AS n FROM sale_payments WHERE payment_date >= $1 GROUP BY 1`, [`${addMonths(currentMonth(), -24)}-01`]);
  let learned = null;
  if (rows.length >= 12) {
    const byM = Array.from({ length: 12 }, (_, i) => rows.filter(r => Number(r.m.slice(5)) === i + 1).map(r => Number(r.n)));
    const avgM = byM.map(l => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0));
    const overall = avgM.reduce((a, b) => a + b, 0) / 12;
    if (overall > 0) learned = avgM.map(x => Math.round((x / overall) * 100));
  }
  res.json({ settings: s, defaults: CF_DEFAULTS, studyAbroadSeason: STUDY_ABROAD_SEASON, learnedSeason: learned, methods: METHODS });
}));
cashtools.put('/settings', canEdit, ah(async (req, res) => {
  const cur = await cfSettings();
  const s = readSettings(req.body, cur);
  await query(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES ('cashflow',$1,$2,NOW())
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, [JSON.stringify(s), req.user.id]);
  await audit(null, req.user, 'cashflow.settings', 'settings', 'cashflow', diff(cur, s, Object.keys(CF_DEFAULTS)));
  res.json({ settings: s });
}));

// ── Position + runway ──
cashtools.get('/position', ah(async (_req, res) => {
  const s = await cfSettings();
  res.json(await cashPosition(s, await liabilityData()));
}));

cashtools.get('/runway', ah(async (_req, res) => {
  const f = await forecastData({ months: 12, scenario: 'base', histMonths: 12 });
  const { pos, avg, hist, rows, buffer, s } = f;
  const netBurn = r2(avg.outflow - avg.inflow);
  const months = x => (x > 0 ? r2(pos.cash / x) : null);
  const grossRunway = avg.outflow > 0 ? r2(pos.cash / avg.outflow) : null;
  const netRunway = netBurn > 0 ? months(netBurn) : null;
  const zero = rows.find(d => d.balance < 0);
  const belowBuffer = rows.find(d => d.balance < buffer);
  // month-end balances going back (current cash minus each month's net)
  let bal = pos.cash;
  const past = [...hist].reverse().map(h => { const close = bal; bal = sub(bal, h.net); return { month: h.month, label: h.label, inflow: h.inflow, outflow: h.outflow, net: h.net, closing: r2(close), burn: r2(h.outflow - h.inflow) }; }).reverse();
  const level = pos.cash <= 0 ? 'critical' : netRunway === null ? (zero ? 'watch' : 'safe') : netRunway < 3 ? 'critical' : netRunway < 6 ? 'danger' : netRunway < 12 ? 'watch' : 'safe';
  const burnParts = Object.entries(avg.out).map(([k, x]) => ({ key: k, value: r2(x) })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
  res.json({
    position: pos, buffer, averages: avg, burn: { gross: avg.outflow, inflow: avg.inflow, net: netBurn, parts: burnParts },
    runway: { gross: grossRunway, net: netRunway, level, netDate: netRunway !== null ? addDays(today(), Math.round(netRunway * 30.4)) : null },
    forecast: { zeroDate: zero?.date || null, bufferDate: belowBuffer?.date || null, lowest: rows.reduce((m, d) => (d.balance < m.balance ? d : m), rows[0] || { balance: pos.cash, date: today() }) },
    history: past,
    projection: groupRows(rows, d => d.slice(0, 7), d => monthLabel(d.slice(0, 7)), pos.cash).map(g => ({ key: g.key, label: g.label, closing: g.closing, low: g.low, net: g.net })),
    settings: { burn_months: s.burn_months },
  });
}));

// ── Cash forecast / cash budget ──
cashtools.get('/forecast', ah(async (req, res) => {
  const s0 = await cfSettings();
  const months = Math.min(18, Math.max(2, parseInt(qstr(req.query.months, 2), 10) || s0.forecast_months));
  const scenario = SCENARIOS[qstr(req.query.scenario)] ? qstr(req.query.scenario) : 'base';
  const f = await forecastData({ months, scenario });
  const { monthly, pos, ctx, buffer, proj, s } = f;
  const total = k => r2(monthly.reduce((a, m) => a + m[k], 0));
  const deficits = monthly.filter(m => m.status !== 'surplus');
  res.json({
    scenario: proj.scenario, scenarios: Object.entries(SCENARIOS).map(([key, x]) => ({ key, label: x.label })),
    position: pos, buffer, months: monthly, inLabels: IN_LABELS, outLabels: OUT_LABELS,
    totals: { inflow: total('inflow'), outflow: total('outflow'), net: total('net'), closing: monthly[monthly.length - 1]?.closing ?? pos.cash },
    summary: {
      deficitMonths: deficits.filter(m => m.status === 'deficit').length, belowBufferMonths: deficits.filter(m => m.status === 'below_buffer').length,
      surplusMonths: monthly.filter(m => m.status === 'surplus').length, maxNeed: r2(Math.max(0, ...monthly.map(m => m.need))), maxSurplus: r2(Math.max(0, ...monthly.map(m => m.surplus))),
    },
    assumptions: {
      collection_rate: s.collection_rate, overdue_collection: s.overdue_collection, growth_pct: s.growth_pct, tax_rate: s.tax_rate, salary_day: s.salary_day,
      salesBase: ctx.salesBase, variableAvg: ctx.variableAvg, pettyAvg: ctx.pettyAvg, salary: ctx.salary, seasonality: s.seasonality,
      receivablesOpen: sum(ctx.rec.items, 'amount'), overdueOpen: sum(ctx.rec.items.filter(i => i.days_overdue > 0), 'amount'),
      recurring: ctx.templates.length, loans: ctx.loans.length, planItems: ctx.plan.length, historyMonths: ctx.complete,
    },
    held: proj.held.map(h => ({ id: h.id, ref_no: h.ref_no, title: h.title, amount: h.amount, hold_until: h.hold_until, reason: h.reason })),
    events: proj.events.slice(0, 300),
  });
}));

// ── Inflow vs outflow timing ──
async function dailyFlows(from, to) {
  return many(`SELECT d, SUM(i)::numeric AS inflow, SUM(o)::numeric AS outflow FROM (
      SELECT payment_date AS d, amount AS i, 0 AS o FROM sale_payments WHERE payment_date BETWEEN $1 AND $2
      UNION ALL SELECT start_date, principal, 0 FROM liabilities WHERE start_date BETWEEN $1 AND $2
      UNION ALL SELECT entry_date, amount, 0 FROM capital_entries WHERE type='investment' AND entry_date BETWEEN $1 AND $2
      UNION ALL SELECT refund_date, 0, amount FROM sale_refunds WHERE refund_date BETWEEN $1 AND $2
      UNION ALL SELECT expense_date, 0, amount FROM expenses WHERE status='approved' AND NOT is_petty_topup AND expense_date BETWEEN $1 AND $2
      UNION ALL SELECT entry_date, 0, amount FROM petty_cash_entries WHERE status <> 'rejected' AND entry_date BETWEEN $1 AND $2
      UNION ALL SELECT pm.paid_at::date, 0, pm.snap_net FROM payroll_months pm WHERE pm.status='paid' AND pm.paid_at::date BETWEEN $1 AND $2
      UNION ALL SELECT pay.payment_date, 0, pay.amount FROM workforce.payment_records pay
        JOIN workforce.payroll_records pr ON pr.id=pay.payroll_record_id
        JOIN workforce.payroll_periods pp ON pp.id=pr.period_id
        JOIN workforce.employees e ON e.id=pr.employee_id
       WHERE pr.status='Paid' AND pay.payment_date BETWEEN $1 AND $2
         AND NOT EXISTS (SELECT 1 FROM payroll_months old_pm JOIN users old_u ON old_u.id=old_pm.user_id
                          WHERE old_pm.month=to_char(pp.period_month,'YYYY-MM') AND old_pm.status IN ('approved','paid')
                            AND upper(old_u.employee_code)=upper(e.employee_code))
      UNION ALL SELECT payment_date, 0, amount FROM liability_payments WHERE payment_date BETWEEN $1 AND $2
      UNION ALL SELECT purchase_date, 0, cost FROM assets WHERE purchase_date BETWEEN $1 AND $2
      UNION ALL SELECT entry_date, 0, amount FROM capital_entries WHERE type='drawing' AND entry_date BETWEEN $1 AND $2
    ) x GROUP BY d ORDER BY d`, [from, to]);
}

cashtools.get('/timing', ah(async (req, res) => {
  const s = await cfSettings();
  const span = Math.min(180, Math.max(14, parseInt(qstr(req.query.days, 3), 10) || s.timing_days));
  const scenario = SCENARIOS[qstr(req.query.scenario)] ? qstr(req.query.scenario) : 'base';
  const pre = await liabilityData();
  const [pos, ctx] = await Promise.all([cashPosition(s, pre), loadContext(s, pre)]);
  const from = ctx.t, to = addDays(from, span - 1);
  const proj = projectDays(ctx, s, scenario, from, to);
  const rows = withBalance(proj.days, pos.cash);
  const weekly = groupRows(rows, d => Math.floor(dayDiff(from, d) / 7), d => `${shortDate(d)}`, pos.cash).map((g, i) => ({ ...g, label: `Week ${i + 1} · ${shortDate(g.from)}–${shortDate(g.to)}` }));
  const trough = rows.reduce((m, d) => (d.balance < m.balance ? d : m), rows[0]);
  const negative = rows.find(d => d.balance < 0);
  // history: which days of the month money usually comes in / goes out (last 6 complete months)
  const hFrom = `${addMonths(currentMonth(), -6)}-01`, hTo = lastDay(addMonths(currentMonth(), -1));
  const hist = await dailyFlows(hFrom, hTo);
  const buckets = [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25], [26, 31]].map(([a, b]) => ({ label: `Day ${a}–${b}`, from: a, to: b, inflow: 0, outflow: 0 }));
  const byDom = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, inflow: 0, outflow: 0 }));
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(n => ({ label: n, inflow: 0, outflow: 0 }));
  let wIn = 0, wOut = 0, sIn = 0, sOut = 0;
  for (const h of hist) {
    const dom = Number(h.d.slice(8)), i = Number(h.inflow), o = Number(h.outflow);
    const b = buckets.find(x => dom >= x.from && dom <= x.to); b.inflow += i; b.outflow += o;
    byDom[dom - 1].inflow += i; byDom[dom - 1].outflow += o;
    const wd = new Date(`${h.d}T00:00:00Z`).getUTCDay(); weekdays[wd].inflow += i; weekdays[wd].outflow += o;
    wIn += dom * i; sIn += i; wOut += dom * o; sOut += o;
  }
  const nMonths = Math.max(1, new Set(hist.map(h => h.d.slice(0, 7))).size);
  const avgInDay = sIn ? r2(wIn / sIn) : null, avgOutDay = sOut ? r2(wOut / sOut) : null;
  let cum = 0, low = { day: null, value: 0 };
  const curve = byDom.map(d => { cum += (d.inflow - d.outflow) / nMonths; if (cum < low.value) low = { day: d.day, value: r2(cum) }; return { day: d.day, inflow: r2(d.inflow / nMonths), outflow: r2(d.outflow / nMonths), cumulative: r2(cum) }; });
  res.json({
    window: { from, to, days: span }, scenario: proj.scenario, position: pos,
    weekly, daily: rows.map(d => ({ date: d.date, inflow: r2(d.inflow), outflow: r2(d.outflow), net: r2(d.net), balance: r2(d.balance) })),
    trough: { date: trough?.date, balance: r2(trough?.balance) }, firstNegative: negative ? { date: negative.date, balance: r2(negative.balance) } : null,
    events: proj.events.slice(0, 250), held: proj.held.length,
    biggestOut: [...proj.events].filter(e => e.dir === 'out').sort((a, b) => b.amount - a.amount).slice(0, 6),
    biggestIn: [...proj.events].filter(e => e.dir === 'in').sort((a, b) => b.amount - a.amount).slice(0, 6),
    history: {
      from: hFrom, to: hTo, months: nMonths,
      buckets: buckets.map(b => ({ label: b.label, inflow: r2(b.inflow / nMonths), outflow: r2(b.outflow / nMonths), gap: r2((b.inflow - b.outflow) / nMonths) })),
      weekdays: weekdays.map(w => ({ ...w, inflow: r2(w.inflow / nMonths), outflow: r2(w.outflow / nMonths) })),
      curve, avgInDay, avgOutDay, gapDays: avgInDay !== null && avgOutDay !== null ? r2(avgInDay - avgOutDay) : null, lowDay: low,
    },
  });
}));

// ── Working capital ──
const AGE = [
  { key: 'current', label: 'Not due yet', test: d => d <= 0 }, { key: 'd30', label: '1–30 days', test: d => d >= 1 && d <= 30 },
  { key: 'd60', label: '31–60 days', test: d => d >= 31 && d <= 60 }, { key: 'd90', label: '61–90 days', test: d => d >= 61 && d <= 90 },
  { key: 'd90p', label: 'Over 90 days', test: d => d > 90 },
];
const ageOf = (items, dateKey) => {
  const t = today();
  return AGE.map(a => { const list = items.filter(i => a.test(dayDiff(i[dateKey], t))); return { key: a.key, label: a.label, amount: sum(list, 'amount'), count: list.length }; });
};

cashtools.get('/working-capital', ah(async (_req, res) => {
  const s = await cfSettings();
  const t = today(), d90 = addDays(t, -89);
  const pre = await liabilityData();
  const [rec, b, payExp, sales90, opex90, consum, collect] = await Promise.all([
    loadReceivables(), books(),
    many(`SELECT e.id, e.ref_no, e.expense_type, e.title, e.category, e.sub_category, e.paid_to, e.amount, e.expense_date, e.on_hold, e.hold_until, e.cycle_month
            FROM expenses e WHERE e.status='pending' AND NOT e.is_petty_topup ORDER BY e.expense_date`),
    one(`SELECT COALESCE(SUM(total_amount),0)::numeric AS n FROM sales WHERE sale_date BETWEEN $1 AND $2`, [d90, t]),
    one(`SELECT COALESCE(SUM(amount),0)::numeric AS n FROM expenses WHERE status='approved' AND NOT is_petty_topup AND expense_date BETWEEN $1 AND $2`, [d90, t]),
    one(`SELECT (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status='approved' AND NOT is_petty_topup AND expense_date BETWEEN $1 AND $2
                  AND category IN ('Office Supplies & Equipment','Test Prep & Training Materials','Student Pre / Post-Departure Services'))
          + (SELECT COALESCE(SUM(amount),0) FROM petty_cash_entries WHERE status <> 'rejected' AND entry_date BETWEEN $1 AND $2
                  AND category IN ('Office Maintenance & Supplies','Office Refreshments & Hospitality')) AS n`, [d90, t]),
    one(`SELECT COALESCE(SUM((p.payment_date - s.sale_date) * p.amount) / NULLIF(SUM(p.amount),0), 0)::numeric AS days, COALESCE(SUM(p.amount),0)::numeric AS amount
           FROM sale_payments p JOIN sales s ON s.id=p.sale_id WHERE p.payment_date BETWEEN $1 AND $2`, [addDays(t, -179), t]),
  ]);
  const pos = positionAt(b, t);
  const activeAssets = b.assets.filter(a => a.status === 'active' && a.purchase_date <= t);
  const assetSum = cats => sum(activeAssets.filter(a => cats.includes(a.category)), 'current_value');
  // receivables
  const recTotal = sum(rec.items, 'amount');
  const overdue = rec.items.filter(i => i.days_overdue > 0);
  const byCustomer = new Map();
  for (const i of rec.items) {
    const k = `${i.customer}|${i.phone || ''}`;
    const c = byCustomer.get(k) || { customer: i.customer, phone: i.phone, employee_name: i.employee_name, invoices: new Set(), amount: 0, overdue: 0, oldest: 0, nextDue: null };
    c.amount = add(c.amount, i.amount); c.invoices.add(i.invoice_no);
    if (i.days_overdue > 0) { c.overdue = add(c.overdue, i.amount); c.oldest = Math.max(c.oldest, i.days_overdue); } else if (!c.nextDue || i.due_date < c.nextDue) c.nextDue = i.due_date;
    byCustomer.set(k, c);
  }
  const debtors = [...byCustomer.values()].map(c => ({ ...c, invoices: [...c.invoices] })).sort((a, b2) => b2.overdue - a.overdue || b2.amount - a.amount);
  const byCounsellor = new Map();
  for (const i of rec.items) { const c = byCounsellor.get(i.employee_name) || { name: i.employee_name, value: 0, overdue: 0 }; c.value = add(c.value, i.amount); if (i.days_overdue > 0) c.overdue = add(c.overdue, i.amount); byCounsellor.set(i.employee_name, c); }
  const byCountry = new Map();
  for (const i of rec.items) { const k = i.destination || 'Not set'; byCountry.set(k, add(byCountry.get(k) || 0, i.amount)); }
  const otherRec = assetSum(['Receivable', 'Advance to Staff']);
  const dso = Number(sales90.n) > 0 ? r2(recTotal / (Number(sales90.n) / 90)) : null;
  // payables
  const payItems = payExp.map(e => ({ ...e, due: e.on_hold && e.hold_until ? e.hold_until : e.expense_date }));
  const tradeLiab = pre.rows.filter(l => l.status === 'active' && l.type === 'payable' && l.outstanding > 0);
  const payTotal = add(sum(payItems, 'amount'), sum(tradeLiab, 'outstanding'));
  const dpo = Number(opex90.n) > 0 ? r2(payTotal / (Number(opex90.n) / 90)) : null;
  // inventory and other cash blocked
  const inventory = assetSum(['Stock / Inventory']);
  const prepaid = assetSum(['Prepaid Expense', 'Security Deposit']);
  const dio = inventory > 0 ? (Number(consum.n) > 0 ? r2(inventory / (Number(consum.n) / 90)) : null) : 0;
  const ccc = dso === null ? null : r2((dio || 0) + dso - (dpo || 0));
  // tips
  const tips = [];
  if (overdue.length) tips.push({ level: 'warn', text: `${overdue.length} installment(s) worth ${pkr(sum(overdue, 'amount'))} are overdue. Call these students first — oldest ${Math.max(...overdue.map(i => i.days_overdue))} days.`, link: '/revenue/upcoming' });
  if (dso !== null && dso > s.dso_target) tips.push({ level: 'warn', text: `Students take about ${Math.round(dso)} days to pay (target ${s.dso_target}). Offer a small full-payment discount only if it costs less than your overdraft rate — see Cash Models → Discount vs interest.`, link: '/cash-flow/models?tab=discount' });
  if (dpo !== null && dpo < s.dpo_target / 2 && payTotal > 0) tips.push({ level: 'info', text: `You pay bills in about ${Math.round(dpo)} days. Ask landlords / vendors for ${s.dpo_target}-day terms to keep cash longer (never delay statutory dues).` });
  if (dio && dio > s.dio_target) tips.push({ level: 'warn', text: `Stock (stationery, kits, marketing material) covers about ${Math.round(dio)} days of use — more than the ${s.dio_target}-day target. Buy smaller batches so cash is not blocked.` });
  if (prepaid > 0) tips.push({ level: 'info', text: `${pkr(prepaid)} is locked in prepaid rent / deposits. Avoid paying more than one quarter in advance unless the discount beats the interest you earn.` });
  if (pos.ratios.current !== null && pos.ratios.current < 1) tips.push({ level: 'error', text: `Current ratio is ${pos.ratios.current} — short-term debts are more than short-term assets. Arrange a running-finance line before the next deficit month.`, link: '/cash-flow/surplus-deficit' });
  res.json({
    receivables: {
      total: recTotal, overdue: sum(overdue, 'amount'), overdueCount: overdue.length, openSales: rec.sales.length, aging: ageOf(rec.items, 'due_date'),
      debtors: debtors.slice(0, 25), byCounsellor: [...byCounsellor.values()].sort((a, c) => c.value - a.value).slice(0, 8),
      byCountry: [...byCountry.entries()].map(([name, value]) => ({ name, value })).sort((a, c) => c.value - a.value).slice(0, 8),
      other: otherRec, dso, collectionDays: Number(collect.amount) > 0 ? r2(collect.days) : null, sales90: Number(sales90.n),
      upcoming: rec.items.filter(i => i.days_overdue === 0).sort((a, c) => a.due_date.localeCompare(c.due_date)).slice(0, 15),
    },
    payables: {
      total: payTotal, bills: sum(payItems, 'amount'), held: sum(payItems.filter(e => e.on_hold), 'amount'), count: payItems.length,
      aging: ageOf(payItems.map(e => ({ ...e, due_date: e.due })), 'due_date'),
      list: payItems.slice(0, 25), trade: tradeLiab.map(l => ({ id: l.id, title: l.title, lender: l.lender, category: l.category, outstanding: l.outstanding, next_due: l.next_due })),
      dpo, opex90: Number(opex90.n),
    },
    inventory: { stock: inventory, prepaid, consumption90: Number(consum.n), dio, items: activeAssets.filter(a => ['Stock / Inventory', 'Prepaid Expense', 'Security Deposit'].includes(a.category)).map(a => ({ id: a.id, name: a.name, category: a.category, sub_category: a.sub_category, value: a.current_value })) },
    cycle: { dio, dso, dpo, ccc, operating: dso === null ? null : r2((dio || 0) + dso), targets: { dso: s.dso_target, dpo: s.dpo_target, dio: s.dio_target } },
    position: { currentAssets: pos.assets.current, currentLiabilities: pos.liabilities.current, workingCapital: pos.capital.working, currentRatio: pos.ratios.current, quickRatio: pos.ratios.quick, high: pos.assets.high, medium: pos.assets.medium },
    tips,
  });
}));

// ── Data for the cash models (formulas run in the browser too) ──
cashtools.get('/models', ah(async (_req, res) => {
  const s = await cfSettings();
  const pre = await liabilityData();
  const t = today(), from = addDays(t, -179);
  const [pos, flows, hist] = await Promise.all([cashPosition(s, pre), dailyFlows(from, t), monthlyHistory(12, pre)]);
  const byDay = new Map(flows.map(f => [f.d, Number(f.inflow) - Number(f.outflow)]));
  const daily = [];
  for (let d = from; d <= t; d = addDays(d, 1)) daily.push({ date: d, net: r2(byDay.get(d) || 0) });
  const st = stats(daily.map(d => d.net));
  const annualOut = r2(hist.reduce((a, h) => a + h.outflow, 0));
  const annualIn = r2(hist.reduce((a, h) => a + h.inflow, 0));
  const activeMonths = hist.filter(h => h.outflow > 0).length;
  const T = activeMonths ? r2((annualOut / activeMonths) * 12) : 0; // yearly cash need (annualised if the business is new)
  const buffer = s.min_cash_buffer > 0 ? Number(s.min_cash_buffer) : r2((T / 12) * s.buffer_months);
  const b = baumol(T, s.transaction_cost, s.interest_rate);
  const m = millerOrr(buffer, s.transaction_cost, st.variance, s.interest_rate);
  const cheapest = pos.credit.lines.filter(l => l.limit > 0)[0] || null;
  res.json({
    cash: pos.cash, annualOutflow: annualOut, annualInflow: annualIn, yearlyNeed: T, activeMonths, buffer,
    daily, dailyStats: st, settings: { transaction_cost: s.transaction_cost, interest_rate: s.interest_rate },
    baumol: b, millerOrr: m, action: millerOrrAction(pos.cash, m),
    borrowRate: cheapest ? cheapest.rate : null, borrowSource: cheapest?.name || null, credit: pos.credit,
  });
}));

// ── Treasury & banking ──
const ACCT_KINDS = ['bank', 'cash', 'wallet', 'deposit', 'overdraft', 'running_finance', 'loan_facility'];
function acctFields(b, cur = {}) {
  const kind = v.oneOf(b.kind ?? cur.kind, ACCT_KINDS, 'Account type');
  const f = {
    name: v.text(b.name ?? cur.name, 'Account name', { required: true, min: 2, max: 120 }), kind,
    institution: v.text(b.institution ?? cur.institution, 'Bank / institution', { max: 120 }),
    account_ref: v.text(b.account_ref ?? cur.account_ref, 'Account (last digits)', { max: 40 }),
    currency: (v.text(b.currency ?? cur.currency ?? 'PKR', 'Currency', { max: 3 }) || 'PKR').toUpperCase(),
    fx_rate: b.fx_rate === undefined ? Number(cur.fx_rate ?? 1) : v.amount(b.fx_rate, 'Exchange rate (PKR per unit)', { min: 0.0001 }),
    balance: b.balance === undefined ? Number(cur.balance ?? 0) : (() => { const n = Number(String(b.balance).replace(/,/g, '')); if (!Number.isFinite(n) || Math.abs(n) > 1e13) throw bad('Balance must be a number.'); return r2(n); })(),
    credit_limit: b.credit_limit === undefined ? Number(cur.credit_limit ?? 0) : v.amount(b.credit_limit || 0, 'Credit limit', { allowZero: true }),
    interest_rate: b.interest_rate === undefined ? Number(cur.interest_rate ?? 0) : v.percent(b.interest_rate || 0, 'Interest rate %'),
    maturity_date: b.maturity_date === undefined ? cur.maturity_date ?? null : b.maturity_date ? v.date(b.maturity_date, 'Maturity date') : null,
    as_of: b.as_of === undefined ? cur.as_of || today() : v.date(b.as_of || today(), 'Balance date'),
    notes: v.text(b.notes ?? cur.notes, 'Notes', { max: 1000 }),
    active: b.active === undefined ? cur.active ?? true : bool(b.active),
  };
  if (!/^[A-Z]{3}$/.test(f.currency)) throw bad('Currency must be a 3-letter code, e.g. PKR, USD, GBP.');
  if (f.currency === 'PKR') f.fx_rate = 1;
  if (CREDIT.includes(kind) && !(f.credit_limit > 0)) throw bad('Enter the sanctioned limit of this credit line.');
  if (CREDIT.includes(kind) && f.balance < 0) throw bad('For a credit line, enter the amount used (0 or more).');
  if (f.as_of > tomorrow()) throw bad('Balance date cannot be in the future.');
  return f;
}
cashtools.get('/treasury', ah(async (_req, res) => {
  const s = await cfSettings();
  const pre = await liabilityData();
  const rows = await many(`SELECT a.*, u.full_name AS created_by_name FROM treasury_accounts a LEFT JOIN users u ON u.id=a.created_by ORDER BY a.active DESC, a.kind, a.name`);
  const pos = await cashPosition(s, pre);
  const liquid = rows.filter(a => a.active && LIQUID.includes(a.kind));
  const fx = [...new Set(liquid.filter(a => a.currency !== 'PKR').map(a => a.currency))].map(c => ({ currency: c, amount: sum(liquid.filter(a => a.currency === c), 'balance'), pkr: sum(liquid.filter(a => a.currency === c), pkrOf) }));
  const deposits = liquid.filter(a => a.kind === 'deposit');
  res.json({
    rows: rows.map(a => ({ ...a, pkr_balance: pkrOf(a), available: CREDIT.includes(a.kind) ? Math.max(0, r2((Number(a.credit_limit) - Math.max(0, Number(a.balance))) * Number(a.fx_rate))) : null, stale_days: dayDiff(a.as_of, today()) })),
    position: pos, settings: { opening_balance: s.opening_balance, opening_date: s.opening_date, interest_rate: s.interest_rate },
    totals: {
      bank: sum(liquid.filter(a => a.kind === 'bank'), pkrOf), cash: sum(liquid.filter(a => a.kind === 'cash'), pkrOf), wallet: sum(liquid.filter(a => a.kind === 'wallet'), pkrOf),
      deposits: sum(deposits, pkrOf), depositYield: r2(deposits.reduce((a, d) => a + (pkrOf(d) * Number(d.interest_rate)) / 100, 0)), fx,
    },
  });
}));
cashtools.post('/treasury', writeLimit, canEdit, ah(async (req, res) => {
  const f = acctFields(req.body);
  const row = await one(`INSERT INTO treasury_accounts(name,kind,institution,account_ref,currency,fx_rate,balance,credit_limit,interest_rate,maturity_date,as_of,notes,active,created_by)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
  [f.name, f.kind, f.institution, f.account_ref, f.currency, f.fx_rate, f.balance, f.credit_limit, f.interest_rate, f.maturity_date, f.as_of, f.notes, f.active, req.user.id]);
  await audit(null, req.user, 'treasury.create', 'treasury', row.id, { name: f.name, kind: f.kind, balance: f.balance });
  res.status(201).json(row);
}));
cashtools.put('/treasury/:id', writeLimit, canEdit, ah(async (req, res) => {
  const cur = await one('SELECT * FROM treasury_accounts WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound('Account not found.');
  const f = acctFields(req.body, cur);
  const row = await one(`UPDATE treasury_accounts SET name=$1,kind=$2,institution=$3,account_ref=$4,currency=$5,fx_rate=$6,balance=$7,credit_limit=$8,interest_rate=$9,maturity_date=$10,
                           as_of=$11,notes=$12,active=$13,updated_at=NOW() WHERE id=$14 RETURNING *`,
  [f.name, f.kind, f.institution, f.account_ref, f.currency, f.fx_rate, f.balance, f.credit_limit, f.interest_rate, f.maturity_date, f.as_of, f.notes, f.active, cur.id]);
  await audit(null, req.user, 'treasury.update', 'treasury', cur.id, diff(cur, f, ['name', 'kind', 'balance', 'credit_limit', 'interest_rate', 'as_of', 'fx_rate', 'active']));
  res.json(row);
}));
cashtools.delete('/treasury/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('DELETE FROM treasury_accounts WHERE id=$1 RETURNING *', [v.id(req.params.id)]);
  if (!cur) throw notFound('Account not found.');
  await audit(null, req.user, 'treasury.delete', 'treasury', cur.id, { snapshot: cur });
  res.json({ ok: true });
}));
/** Use the bank / cash statement total as the new opening balance (cash position = statements from tomorrow). */
cashtools.post('/treasury/anchor', canEdit, ah(async (req, res) => {
  const cur = await cfSettings();
  const liquid = await many(`SELECT * FROM treasury_accounts WHERE active AND kind = ANY($1::text[])`, [LIQUID]);
  if (!liquid.length) throw bad('Add at least one bank, cash, wallet or deposit account first.');
  const asOf = liquid.map(a => a.as_of).sort().pop();
  const s = { ...cur, opening_balance: sum(liquid, pkrOf), opening_date: addDays(asOf, 1) };
  await query(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES ('cashflow',$1,$2,NOW())
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, [JSON.stringify(s), req.user.id]);
  await audit(null, req.user, 'cashflow.anchor', 'settings', 'cashflow', { opening_balance: s.opening_balance, opening_date: s.opening_date, from: cur.opening_balance });
  res.json({ settings: s });
}));

// ── Planned cash items (cash budget inputs) ──
export const PLAN_CATEGORIES = {
  in: ['University commission', 'Partner / B2B payout received', 'Owner investment', 'Loan / finance received', 'Visa & service fees (bulk)', 'Asset sale', 'Other receipt'],
  out: ['Tax', 'Rent', 'Marketing campaign / expo', 'University / embassy deposits', 'Equipment purchase', 'Loan repayment (extra)', 'Bonus / incentives', 'Owner drawing', 'Other payment'],
};
function planFields(b, cur = {}) {
  const direction = v.oneOf(b.direction ?? cur.direction, ['in', 'out'], 'Direction');
  const f = {
    direction,
    category: v.text(b.category ?? cur.category, 'Category', { required: true, max: 60 }),
    title: v.text(b.title ?? cur.title, 'Title', { required: true, min: 2, max: 160 }),
    amount: v.amount(b.amount ?? cur.amount, 'Amount (PKR)'),
    start_month: v.month(b.start_month ?? cur.start_month, 'Month'),
    repeat: v.oneOf(b.repeat ?? cur.repeat ?? 'once', ['once', 'monthly', 'quarterly', 'yearly'], 'Repeats'),
    end_month: (b.end_month ?? cur.end_month) ? v.month(b.end_month ?? cur.end_month, 'End month') : null,
    day: v.int(b.day ?? cur.day ?? 15, 'Day of month', { min: 1, max: 28 }),
    probability: v.int(b.probability ?? cur.probability ?? 100, 'Chance %', { min: 1, max: 100 }),
    note: v.text(b.note ?? cur.note, 'Note', { max: 1000 }),
    active: b.active === undefined ? cur.active ?? true : bool(b.active),
  };
  if (f.repeat === 'once') f.end_month = null;
  if (f.end_month && f.end_month < f.start_month) throw bad('End month cannot be before the start month.');
  return f;
}
cashtools.get('/plan', ah(async (_req, res) => {
  res.json({ rows: await many(`SELECT p.*, u.full_name AS created_by_name FROM cash_plan_items p LEFT JOIN users u ON u.id=p.created_by ORDER BY p.active DESC, p.start_month, p.id`), categories: PLAN_CATEGORIES });
}));
cashtools.post('/plan', writeLimit, canEdit, ah(async (req, res) => {
  const f = planFields(req.body);
  const row = await one(`INSERT INTO cash_plan_items(direction,category,title,amount,start_month,repeat,end_month,day,probability,note,active,created_by)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
  [f.direction, f.category, f.title, f.amount, f.start_month, f.repeat, f.end_month, f.day, f.probability, f.note, f.active, req.user.id]);
  await audit(null, req.user, 'cashplan.create', 'cashplan', row.id, { title: f.title, amount: f.amount, direction: f.direction });
  res.status(201).json(row);
}));
cashtools.put('/plan/:id', writeLimit, canEdit, ah(async (req, res) => {
  const cur = await one('SELECT * FROM cash_plan_items WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound('Planned item not found.');
  const f = planFields(req.body, cur);
  const row = await one(`UPDATE cash_plan_items SET direction=$1,category=$2,title=$3,amount=$4,start_month=$5,repeat=$6,end_month=$7,day=$8,probability=$9,note=$10,active=$11,updated_at=NOW()
                         WHERE id=$12 RETURNING *`, [f.direction, f.category, f.title, f.amount, f.start_month, f.repeat, f.end_month, f.day, f.probability, f.note, f.active, cur.id]);
  await audit(null, req.user, 'cashplan.update', 'cashplan', cur.id, diff(cur, f, ['title', 'amount', 'start_month', 'repeat', 'end_month', 'probability', 'active']));
  res.json(row);
}));
cashtools.delete('/plan/:id', canEdit, ah(async (req, res) => {
  const cur = await one('DELETE FROM cash_plan_items WHERE id=$1 RETURNING *', [v.id(req.params.id)]);
  if (!cur) throw notFound('Planned item not found.');
  await audit(null, req.user, 'cashplan.delete', 'cashplan', cur.id, { snapshot: cur });
  res.json({ ok: true });
}));

// ═════════════ Budget allotment (employees + petty cash top-ups) ═════════════
const WALLET_SQL = `
  SELECT w.*, u.full_name, u.employee_code, u.designation, u.photo_file_id, u.email, u.status AS user_status,
         COALESCE(a.allotted,0)::numeric AS allotted, COALESCE(a.returned,0)::numeric AS returned, COALESCE(a.pending_allot,0)::numeric AS pending_allot,
         COALESCE(x.spent,0)::numeric AS spent, COALESCE(x.spent_pending,0)::numeric AS spent_pending, COALESCE(x.pending_count,0)::int AS pending_count, COALESCE(x.entries,0)::int AS expense_count,
         x.last_spent, (COALESCE(a.allotted,0) - COALESCE(a.returned,0) - COALESCE(x.spent,0))::numeric AS balance
    FROM budget_wallets w JOIN users u ON u.id=w.user_id
    LEFT JOIN LATERAL (SELECT SUM(amount) FILTER (WHERE kind='allot' AND status='approved') AS allotted, SUM(amount) FILTER (WHERE kind='return' AND status='approved') AS returned,
                              SUM(amount) FILTER (WHERE kind='allot' AND status='pending') AS pending_allot FROM budget_entries WHERE user_id=w.user_id) a ON TRUE
    LEFT JOIN LATERAL (SELECT SUM(amount) FILTER (WHERE status <> 'rejected') AS spent, SUM(amount) FILTER (WHERE status='pending') AS spent_pending,
                              COUNT(*) FILTER (WHERE status='pending') AS pending_count, COUNT(*) AS entries, MAX(expense_date) AS last_spent
                         FROM expenses WHERE budget_holder_id=w.user_id) x ON TRUE`;
const decorateWallet = w => w && ({ ...w, active: walletActive(w), used_pct: Number(w.allotted) - Number(w.returned) > 0 ? Math.min(100, Math.round((Number(w.spent) / (Number(w.allotted) - Number(w.returned))) * 100)) : 0 });

const ENTRY_SELECT = `
  SELECT * FROM (
    SELECT 'budget'::text AS source, b.id, b.ref_no, b.kind, b.user_id, u.full_name AS holder, u.employee_code, u.photo_file_id, b.amount, b.entry_date, b.title,
           b.payment_method, b.reference_no, b.note, b.status, b.review_note, b.reviewed_at, rv.full_name AS reviewed_by_name, b.created_by, cb.full_name AS entered_by, b.created_at
      FROM budget_entries b JOIN users u ON u.id=b.user_id LEFT JOIN users rv ON rv.id=b.reviewed_by LEFT JOIN users cb ON cb.id=b.created_by
    UNION ALL
    SELECT 'petty', e.id, e.ref_no, 'topup', NULL, e.paid_to, NULL, NULL, e.amount, e.expense_date, e.title,
           e.payment_method, e.reference_no, e.description, e.status, e.review_note, e.reviewed_at, rv.full_name, e.created_by, cb.full_name, e.created_at
      FROM expenses e LEFT JOIN users rv ON rv.id=e.reviewed_by LEFT JOIN users cb ON cb.id=e.created_by WHERE e.is_petty_topup
  ) t`;
const ENTRY_SORTS = { date: 't.entry_date', amount: 't.amount', ref: 't.ref_no', holder: 'lower(t.holder)', status: 't.status', created: 't.created_at' };

cashtools.get('/budgets', ah(async (req, res) => {
  const state = qstr(req.query.state);
  const w = new Where();
  if (['active', 'closed'].includes(state)) w.add('w.state = ?', state);
  const text = qstr(req.query.q, 80);
  if (text) { const p = likeText(text); w.add('(lower(u.full_name) LIKE ? OR lower(u.employee_code) LIKE ? OR lower(w.purpose) LIKE ?)', p, p, p); }
  const wallets = (await many(`${WALLET_SQL} ${w.sql} ORDER BY w.state, lower(u.full_name)`, w.params)).map(decorateWallet);
  const all = (await many(WALLET_SQL)).map(decorateWallet);
  const petty = await pettyBalance();
  const pend = await one(`SELECT (SELECT COUNT(*) FROM budget_entries WHERE status='pending')::int AS budget, (SELECT COUNT(*) FROM expenses WHERE is_petty_topup AND status='pending')::int AS petty,
                                 (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE is_petty_topup AND status='pending')::numeric AS petty_amount`);
  res.json({
    wallets,
    totals: { allotted: sum(all, 'allotted'), returned: sum(all, 'returned'), spent: sum(all, 'spent'), balance: sum(all, 'balance'), pending_allot: sum(all, 'pending_allot'), active: all.filter(x => x.active).length, holders: all.length, spent_pending: sum(all, 'spent_pending') },
    petty: { ...petty, pendingTopups: pend.petty, pendingTopupAmount: Number(pend.petty_amount) }, pending: { budget: pend.budget, petty: pend.petty },
    canApprove: can(req.user, 'expense_approve', 'edit'), canEdit: can(req.user, 'cashflow', 'edit'),
  });
}));

cashtools.get('/budgets/entries', ah(async (req, res) => {
  const w = new Where();
  const kind = qstr(req.query.kind);
  if (kind === 'petty') w.raw(`t.source = 'petty'`); else if (['allot', 'return'].includes(kind)) w.add('t.source = ? AND t.kind = ?', 'budget', kind); else if (kind === 'budget') w.raw(`t.source='budget'`);
  const st = qstr(req.query.status); if (['pending', 'approved', 'rejected'].includes(st)) w.add('t.status = ?', st);
  const uid = qid(req.query.user_id); if (uid) w.add('t.user_id = ?', uid);
  if (req.query.from || req.query.to) { const { from, to } = v.range(req.query); w.add('t.entry_date BETWEEN ? AND ?', from, to); }
  const text = qstr(req.query.q, 80); if (text) { const p = likeText(text); w.add('(lower(t.ref_no) LIKE ? OR lower(t.holder) LIKE ? OR lower(t.title) LIKE ? OR lower(t.reference_no) LIKE ?)', p, p, p, p); }
  const tot = await one(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount) FILTER (WHERE status='approved' AND kind<>'return'),0)::numeric AS given,
      COALESCE(SUM(amount) FILTER (WHERE status='approved' AND kind='return'),0)::numeric AS returned, COALESCE(SUM(amount) FILTER (WHERE status='pending'),0)::numeric AS pending,
      COUNT(*) FILTER (WHERE status='pending')::int AS pending_count, COUNT(*) FILTER (WHERE status='approved')::int AS approved_count, COUNT(*) FILTER (WHERE status='rejected')::int AS rejected_count
    FROM (${ENTRY_SELECT} ${w.sql}) z`, w.params);
  const pg = paging(req.query, { sorts: ENTRY_SORTS, defaultSort: 'date', tieBreaker: 't.created_at DESC, t.id DESC' });
  const pages = Math.max(1, Math.ceil(tot.count / pg.limit));
  const page = Math.min(pg.page, pages);
  const params = [...w.params, pg.limit, (page - 1) * pg.limit];
  const rows = await many(`${ENTRY_SELECT} ${w.sql} ORDER BY ${pg.order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ rows, total: tot.count, page, pages, limit: pg.limit, sort: pg.sort, dir: pg.dir, totals: tot });
}));

async function walletDetail(userId, user) {
  const w = decorateWallet(await one(`${WALLET_SQL} WHERE w.user_id=$1`, [userId]));
  if (!w) return null;
  const entries = await many(`${ENTRY_SELECT} WHERE t.source='budget' AND t.user_id=$1 ORDER BY t.entry_date DESC, t.created_at DESC LIMIT 300`, [userId]);
  const expenses = await many(`${EXP_SELECT} WHERE e.budget_holder_id=$1 ORDER BY e.expense_date DESC, e.id DESC LIMIT 300`, [userId]);
  // running ledger (approved money in / out, non-rejected spending)
  const moves = [
    ...entries.filter(e => e.status === 'approved').map(e => ({ kind: e.kind, id: e.id, ref_no: e.ref_no, d: e.entry_date, at: e.created_at, title: e.title || (e.kind === 'allot' ? 'Budget allotted' : 'Cash returned'), credit: e.kind === 'allot' ? e.amount : 0, debit: e.kind === 'return' ? e.amount : 0, status: e.status })),
    ...expenses.filter(e => e.status !== 'rejected').map(e => ({ kind: 'expense', id: e.id, ref_no: e.ref_no, d: e.expense_date, at: e.created_at, title: `${e.sub_category || e.category}${e.title && e.title !== e.sub_category ? ' · ' + e.title : ''}`, credit: 0, debit: e.amount, status: e.status })),
  ].sort((a, b) => a.d.localeCompare(b.d) || new Date(a.at) - new Date(b.at));
  let bal = 0;
  const ledger = moves.map(m => { bal = add(bal, sub(m.credit, m.debit)); return { ...m, balance: bal }; }).reverse();
  const allowed = w.category_ids?.length ? (await many('SELECT id, name FROM expense_categories WHERE id = ANY($1::bigint[])', [w.category_ids])) : [];
  const perms = user ? await many('SELECT module, level FROM permissions WHERE user_id=$1', [userId]) : [];
  return { wallet: w, entries, expenses, ledger, allowedCategories: allowed, expensesAccess: perms.find(p => p.module === 'expenses')?.level || null };
}

cashtools.get('/budgets/:userId', ah(async (req, res) => {
  const d = await walletDetail(v.id(req.params.userId), req.user);
  if (!d) throw notFound('This employee has no budget yet.');
  res.json(d);
}));

function walletSettings(b, cur = {}) {
  const ids = b.category_ids === undefined ? cur.category_ids || [] : v.json(b.category_ids, []);
  if (!Array.isArray(ids) || ids.length > 40) throw bad('Choose up to 40 categories.');
  return {
    purpose: v.text(b.purpose ?? cur.purpose, 'Purpose', { max: 200 }),
    valid_until: b.valid_until === undefined ? cur.valid_until ?? null : b.valid_until ? v.date(b.valid_until, 'Budget valid until') : null,
    max_entry: b.max_entry === undefined ? Number(cur.max_entry ?? 0) : v.amount(b.max_entry || 0, 'Maximum per expense', { allowZero: true }),
    category_ids: [...new Set(ids.map(x => v.id(x, 'Category')))],
  };
}

async function notifyHolder(userId, title, body) {
  const u = await one('SELECT email, full_name FROM users WHERE id=$1', [userId]);
  await notify(null, [userId], { kind: 'budget', title, body, link: '/my-budget' });
  if (u?.email) sendMail(u.email, title, template({ title, greeting: `Hi ${u.full_name},`, lines: [body], action: { label: 'Open My Budget', url: link('/my-budget') } }));
}

/** Give cash: to an employee's budget (target=employee) or to the petty cash holder (target=petty). */
cashtools.post('/budgets/allot', writeLimit, canEdit, ah(async (req, res) => {
  const b = req.body;
  const target = v.oneOf(b.target || 'employee', ['employee', 'petty'], 'Allot to');
  const amount = v.amount(b.amount, 'Amount (PKR)');
  const date = v.date(b.entry_date || today(), 'Date');
  if (date > tomorrow()) throw bad('Date cannot be in the future.');
  const method = v.oneOf(b.payment_method || 'Cash', METHODS, 'Payment method');
  const reference = v.text(b.reference_no, 'Reference no.', { max: 80 });
  const note = v.text(b.note, 'Note', { max: 1000 });
  const status = isAdmin(req.user) ? 'approved' : 'pending';
  if (target === 'petty') {
    const paidTo = v.text(b.paid_to, 'Given to (petty cash holder)', { required: true, max: 160 });
    const row = await tx(async db => {
      const ref = (await db.query(`SELECT 'EXP-' || lpad(nextval('expense_seq')::text, 5, '0') AS n`)).rows[0].n;
      const e = (await db.query(`INSERT INTO expenses(ref_no,expense_type,title,category,amount,expense_date,paid_to,payment_method,reference_no,description,status,is_petty_topup,created_by,updated_by,reviewed_by,reviewed_at)
                                 VALUES ($1,'variable',$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$11,$12,$13) RETURNING *`,
      [ref, v.text(b.title, 'Title', { max: 160 }) || 'Petty cash top-up', TOPUP, amount, date, paidTo, method, reference, note, status, req.user.id, status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null])).rows[0];
      await audit(db, req.user, 'petty.topup', 'expense', e.id, { ref, amount, status, via: 'cashflow' });
      return e;
    });
    if (status === 'pending') sendMail(await approverEmails(), `Petty cash top-up to approve: ${row.ref_no}`, template({ title: 'Petty cash top-up needs approval', lines: [`${req.user.full_name}: ${pkr(amount)} given to ${row.paid_to}.`], action: { label: 'Review', url: link('/cash-flow/budgets') } }));
    return res.status(201).json({ source: 'petty', ...row, balance: (await pettyBalance()).balance });
  }
  const userId = v.id(b.user_id, 'Employee');
  const emp = await one('SELECT id, full_name, status, role FROM users WHERE id=$1', [userId]);
  if (!emp || emp.status !== 'approved') throw bad('Choose an approved employee.');
  if (emp.id === req.user.id && !isAdmin(req.user)) throw forbidden('You cannot allot a budget to yourself.');
  const out = await tx(async db => {
    await lockWallet(db, userId);
    const cur = (await db.query('SELECT * FROM budget_wallets WHERE user_id=$1', [userId])).rows[0];
    const ws = walletSettings(b, cur || {});
    if (ws.category_ids.length) {
      const ok = (await db.query(`SELECT COUNT(*)::int AS n FROM expense_categories WHERE id = ANY($1::bigint[]) AND scope='variable' AND parent_id IS NULL`, [ws.category_ids])).rows[0].n;
      if (ok !== ws.category_ids.length) throw bad('Only top-level variable expense categories can be chosen.');
    }
    if (!cur) {
      await db.query(`INSERT INTO budget_wallets(user_id,state,purpose,valid_until,max_entry,category_ids,opened_by) VALUES ($1,'active',$2,$3,$4,$5,$6)`, [userId, ws.purpose, ws.valid_until, ws.max_entry, ws.category_ids, req.user.id]);
    } else {
      await db.query(`UPDATE budget_wallets SET state='active', purpose=$2, valid_until=$3, max_entry=$4, category_ids=$5, closed_at=NULL, closed_by=NULL, close_note=NULL,
                        opened_by=CASE WHEN state='closed' THEN $6 ELSE opened_by END, opened_at=CASE WHEN state='closed' THEN NOW() ELSE opened_at END, version=version+1, updated_at=NOW() WHERE user_id=$1`,
      [userId, ws.purpose || cur.purpose, ws.valid_until, ws.max_entry, ws.category_ids, req.user.id]);
    }
    const ref = (await db.query(`SELECT 'BA-' || lpad(nextval('budget_seq')::text, 5, '0') AS n`)).rows[0].n;
    const e = (await db.query(`INSERT INTO budget_entries(ref_no,user_id,kind,amount,entry_date,title,payment_method,reference_no,note,status,reviewed_by,reviewed_at,created_by)
                               VALUES ($1,$2,'allot',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [ref, userId, amount, date, v.text(b.title, 'Title', { max: 160 }) || ws.purpose || 'Expense budget', method, reference, note, status, status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null, req.user.id])).rows[0];
    await audit(db, req.user, 'budget.allot', 'budget', userId, { ref, amount, status, opened: !cur || cur.state === 'closed' });
    return e;
  });
  if (status === 'approved') await notifyHolder(userId, `${pkr(amount)} added to your expense budget`, `${req.user.full_name} allotted ${pkr(amount)} (${out.ref_no}). Open "My Budget" to record your expenses with receipts.`);
  else sendMail(await approverEmails(), `Budget allotment to approve: ${out.ref_no}`, template({ title: 'Employee budget allotment needs approval', lines: [`${req.user.full_name}: ${pkr(amount)} for ${emp.full_name}.`], action: { label: 'Review', url: link('/cash-flow/budgets') } }));
  res.status(201).json({ source: 'budget', ...out, balance: (await walletBalance(null, userId)).balance });
}));

cashtools.put('/budgets/:userId', writeLimit, canEdit, ah(async (req, res) => {
  const userId = v.id(req.params.userId);
  const cur = await one('SELECT * FROM budget_wallets WHERE user_id=$1', [userId]);
  if (!cur) throw notFound('This employee has no budget yet.');
  if (req.body.version !== undefined && v.int(req.body.version, 'Version', { min: 1 }) !== cur.version) throw conflict();
  const ws = walletSettings(req.body, cur);
  await query('UPDATE budget_wallets SET purpose=$2, valid_until=$3, max_entry=$4, category_ids=$5, version=version+1, updated_at=NOW() WHERE user_id=$1', [userId, ws.purpose, ws.valid_until, ws.max_entry, ws.category_ids]);
  await audit(null, req.user, 'budget.settings', 'budget', userId, diff(cur, ws, ['purpose', 'valid_until', 'max_entry', 'category_ids']));
  res.json(await walletDetail(userId));
}));

/** Cash taken back from an employee (partly or all of the unspent balance). */
async function returnCash(db, user, userId, amount, note, date) {
  await lockWallet(db, userId);
  const bal = await walletBalance(db, userId);
  if (amount > bal.balance) throw bad(`Only ${pkr(bal.balance)} is left in this budget.`);
  const ref = (await db.query(`SELECT 'BA-' || lpad(nextval('budget_seq')::text, 5, '0') AS n`)).rows[0].n;
  const e = (await db.query(`INSERT INTO budget_entries(ref_no,user_id,kind,amount,entry_date,title,payment_method,note,status,reviewed_by,reviewed_at,created_by)
                             VALUES ($1,$2,'return',$3,$4,'Unspent cash returned','Cash',$5,'approved',$6,NOW(),$6) RETURNING *`, [ref, userId, amount, date, note, user.id])).rows[0];
  await audit(db, user, 'budget.return', 'budget', userId, { ref, amount, note });
  return e;
}
cashtools.post('/budgets/:userId/return', requireApprover, ah(async (req, res) => {
  const userId = v.id(req.params.userId);
  if (!(await one('SELECT 1 AS x FROM budget_wallets WHERE user_id=$1', [userId]))) throw notFound('This employee has no budget yet.');
  const amount = v.amount(req.body.amount, 'Amount returned');
  const date = v.date(req.body.entry_date || today(), 'Date');
  const e = await tx(db => returnCash(db, req.user, userId, amount, v.text(req.body.note, 'Note', { max: 1000 }), date));
  await notifyHolder(userId, `${pkr(amount)} returned from your budget`, `${req.user.full_name} recorded ${pkr(amount)} of unspent cash returned (${e.ref_no}).`);
  res.status(201).json({ ...e, balance: (await walletBalance(null, userId)).balance });
}));

/** Close = take back access ("My Budget" becomes read-only); the unspent balance is recorded as returned. */
cashtools.post('/budgets/:userId/close', requireApprover, ah(async (req, res) => {
  const userId = v.id(req.params.userId);
  const note = v.text(req.body.note, 'Reason', { max: 300 }) || 'Budget closed';
  const out = await tx(async db => {
    await lockWallet(db, userId);
    const w = (await db.query('SELECT * FROM budget_wallets WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
    if (!w) throw notFound('This employee has no budget yet.');
    if (w.state === 'closed') throw bad('This budget is already closed.');
    const pendingAllot = (await db.query(`UPDATE budget_entries SET status='rejected', review_note='Budget closed', reviewed_by=$2, reviewed_at=NOW() WHERE user_id=$1 AND kind='allot' AND status='pending' RETURNING id`, [userId, req.user.id])).rowCount;
    const bal = await walletBalance(db, userId);
    let returned = null;
    if (bal.balance > 0 && req.body.return_balance !== false && req.body.return_balance !== 'false') returned = await returnCash(db, req.user, userId, bal.balance, note, today());
    await db.query(`UPDATE budget_wallets SET state='closed', closed_by=$2, closed_at=NOW(), close_note=$3, version=version+1, updated_at=NOW() WHERE user_id=$1`, [userId, req.user.id, note]);
    await audit(db, req.user, 'budget.close', 'budget', userId, { note, returned: returned?.amount || 0, cancelledAllotments: pendingAllot, pendingExpenses: bal.pending_count });
    return { returned, pendingExpenses: bal.pending_count };
  });
  await notifyHolder(userId, 'Your expense budget was closed', `${req.user.full_name} closed your budget${out.returned ? ` — ${pkr(out.returned.amount)} recorded as returned` : ''}. Reason: ${note}`);
  res.json({ ok: true, ...out });
}));

cashtools.post('/budgets/:userId/reopen', canEdit, ah(async (req, res) => {
  const userId = v.id(req.params.userId);
  const u = await query(`UPDATE budget_wallets SET state='active', closed_at=NULL, closed_by=NULL, close_note=NULL, opened_by=$2, opened_at=NOW(), version=version+1, updated_at=NOW()
                          WHERE user_id=$1 AND state='closed'`, [userId, req.user.id]);
  if (!u.rowCount) throw bad('Only a closed budget can be re-opened.');
  await audit(null, req.user, 'budget.reopen', 'budget', userId, {});
  await notifyHolder(userId, 'Your expense budget is active again', `${req.user.full_name} re-opened your budget.`);
  res.json({ ok: true });
}));

cashtools.post('/budgets/entries/:id/review', requireApprover, ah(async (req, res) => {
  const status = v.oneOf(req.body.status, ['approved', 'rejected', 'pending'], 'Status');
  const note = v.text(req.body.note, 'Note', { max: 500 }) || null;
  if (status === 'rejected' && !note) throw bad('Please write the reason for rejecting.');
  const cur = await tx(async db => {
    const e = (await db.query('SELECT * FROM budget_entries WHERE id=$1', [v.id(req.params.id)])).rows[0];
    if (!e) throw notFound('Allotment not found.');
    if (!isAdmin(req.user) && e.created_by === req.user.id) throw forbidden('You cannot approve your own allotment.');
    if (e.status === status) throw bad(`Already ${status}.`);
    await lockWallet(db, e.user_id);
    if (e.kind === 'allot' && e.status === 'approved') {
      const bal = await walletBalance(db, e.user_id);
      if (sub(bal.balance, e.amount) < 0) throw bad(`This allotment (${e.ref_no}) has already been spent, so it cannot be un-approved.`);
    }
    if (e.kind === 'return' && e.status !== 'approved' && status === 'approved') {
      const bal = await walletBalance(db, e.user_id);
      if (e.amount > bal.balance) throw bad('Not enough balance left for this return.');
    }
    await db.query('UPDATE budget_entries SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=NOW(), version=version+1 WHERE id=$4', [status, note, req.user.id, e.id]);
    await audit(db, req.user, 'budget.review', 'budget', e.user_id, { ref: e.ref_no, from: e.status, to: status, note });
    return e;
  });
  if (status === 'approved' && cur.kind === 'allot') await notifyHolder(cur.user_id, `${pkr(cur.amount)} added to your expense budget`, `Allotment ${cur.ref_no} was approved.`);
  res.json({ ok: true, balance: (await walletBalance(null, cur.user_id)).balance });
}));

cashtools.post('/budgets/topups/:id/review', requireApprover, ah(async (req, res) => {
  const status = v.oneOf(req.body.status, ['approved', 'rejected', 'pending'], 'Status');
  const note = v.text(req.body.note, 'Note', { max: 500 }) || null;
  await tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7701)');
    const cur = (await db.query('SELECT * FROM expenses WHERE id=$1 AND is_petty_topup', [v.id(req.params.id)])).rows[0];
    if (!cur) throw notFound('Top-up not found.');
    if (cur.status === status) throw bad(`Already ${status}.`);
    await reviewTopup(db, req.user, cur, status, note);
  });
  res.json({ ok: true, balance: (await pettyBalance()).balance });
}));

// ═════════════ Payment control: constant (and variable) expenses — approve / hold / release in bulk ═════════════
cashtools.get('/control', ah(async (req, res) => {
  const q = { ...req.query };
  if (!['constant', 'variable'].includes(qstr(q.type))) q.type = qstr(q.type) === 'all' ? '' : 'constant';
  await ensureCycles([currentMonth()]).catch(() => {});
  const list = await listExpenses(q, req.user);
  res.json({ ...list, canApprove: can(req.user, 'expense_approve', 'edit') });
}));

const ACTIONS = { approve: 'approved', reject: 'rejected', pending: 'pending', hold: 'hold', release: 'release' };
cashtools.post('/control/bulk', requireApprover, ah(async (req, res) => {
  const action = v.oneOf(req.body.action, Object.keys(ACTIONS), 'Action');
  const note = v.text(req.body.note, 'Note', { max: 300 }) || null;
  if ((action === 'reject' || action === 'hold') && !note) throw bad(action === 'reject' ? 'Please write the reason for rejecting.' : 'Please write why the payment is on hold.');
  const holdUntil = action === 'hold' && req.body.hold_until ? v.date(req.body.hold_until, 'Hold until') : null;
  if (holdUntil && holdUntil < today()) throw bad('"Hold until" must be today or later.');
  let ids;
  if (bool(req.body.all)) {
    const f = v.json(req.body.filters, {});
    const q = { ...(f && typeof f === 'object' ? f : {}) };
    for (const k of Object.keys(q)) q[k] = q[k] == null ? '' : String(q[k]);
    if (!['constant', 'variable'].includes(q.type)) q.type = q.type === 'all' ? '' : 'constant';
    const w = expenseWhere(q, req.user);
    const found = await many(`SELECT e.id FROM expenses e ${w.sql} ORDER BY e.expense_date, e.id LIMIT 2001`, w.params);
    if (found.length > 2000) throw bad('More than 2,000 expenses match. Narrow the filters (dates, category or status) and try again.');
    if (!found.length) throw bad('No expenses match these filters.');
    ids = found.map(x => x.id);
  } else ids = idList(req.body.ids);
  const out = await tx(async db => {
    const rows = (await db.query(`SELECT e.*, u.email, u.full_name AS creator FROM expenses e LEFT JOIN users u ON u.id=e.created_by WHERE e.id = ANY($1::bigint[]) FOR UPDATE OF e`, [ids])).rows;
    const ok = [], skipped = [];
    const budgetLeft = new Map();
    for (const e of rows) {
      const skip = reason => skipped.push({ id: e.id, ref: e.ref_no, reason });
      if (e.is_petty_topup) { skip('Petty cash top-ups are reviewed in Budget allotment'); continue; }
      if (!isAdmin(req.user) && e.created_by === req.user.id) { skip('You cannot approve or hold your own entry'); continue; }
      if (action === 'hold') { if (e.status !== 'pending') { skip(`Already ${e.status} — move it back to “Not approved” first`); continue; } if (e.on_hold && String(e.hold_until || '') === String(holdUntil || '')) { skip('Already on hold'); continue; } }
      if (action === 'release' && !e.on_hold) { skip('Not on hold'); continue; }
      if (['approve', 'reject', 'pending'].includes(action) && e.status === ACTIONS[action]) { skip(`Already ${ACTIONS[action] === 'pending' ? 'not approved' : ACTIONS[action]}`); continue; }
      if (e.budget_holder_id && e.status === 'rejected' && (action === 'approve' || action === 'pending')) {
        if (!budgetLeft.has(e.budget_holder_id)) { await lockWallet(db, e.budget_holder_id); budgetLeft.set(e.budget_holder_id, (await walletBalance(db, e.budget_holder_id)).balance); }
        if (e.amount > budgetLeft.get(e.budget_holder_id)) { skip('Not enough budget left to restore it'); continue; }
        budgetLeft.set(e.budget_holder_id, sub(budgetLeft.get(e.budget_holder_id), e.amount));
      }
      ok.push(e);
    }
    for (const id of ids) if (!rows.find(x => x.id === id)) skipped.push({ id, reason: 'Not found' });
    const list = ok.map(x => x.id);
    if (list.length) {
      if (action === 'hold') await db.query(`UPDATE expenses SET on_hold=TRUE, hold_note=$1, hold_until=$2, held_by=$3, held_at=NOW(), version=version+1 WHERE id = ANY($4::bigint[])`, [note, holdUntil, req.user.id, list]);
      else if (action === 'release') await db.query(`UPDATE expenses SET on_hold=FALSE, hold_until=NULL, version=version+1 WHERE id = ANY($1::bigint[])`, [list]);
      else {
        const st = ACTIONS[action];
        await db.query(`UPDATE expenses SET status=$1::text, review_note=$2, reviewed_by=$3, reviewed_at=NOW(), version=version+1, on_hold = CASE WHEN $1::text = 'pending' THEN on_hold ELSE FALSE END WHERE id = ANY($4::bigint[])`, [st, note, req.user.id, list]);
        await db.query(`UPDATE files SET verify_status=$1, verified_by=$2, verified_at=NOW() WHERE id = ANY($3::bigint[])`, [st === 'approved' ? 'verified' : st === 'rejected' ? 'rejected' : 'unverified', req.user.id, ok.map(x => x.receipt_file_id).filter(Boolean)]);
      }
      for (const e of ok) await audit(db, req.user, action === 'hold' || action === 'release' ? `expense.${action}` : 'expense.review', 'expense', e.id, action === 'hold' || action === 'release' ? { note, hold_until: holdUntil, bulk: true } : { from: e.status, to: ACTIONS[action], note, bulk: true, via: 'payment-control' });
    }
    return { ok, skipped };
  });
  // tell the people who entered them
  const byUser = new Map();
  for (const e of out.ok) if (e.created_by && e.created_by !== req.user.id) byUser.set(e.created_by, [...(byUser.get(e.created_by) || []), e]);
  const verb = { approve: 'approved', reject: 'rejected', pending: 'moved back to not approved', hold: 'put on hold', release: 'released from hold' }[action];
  for (const [uid, list] of byUser) {
    await notify(null, [uid], { kind: 'expense', title: `${list.length} expense(s) ${verb}`, body: list.slice(0, 5).map(e => `${e.ref_no} · ${e.title} — ${pkr(e.amount)}`).join('\n') + (note ? `\nNote: ${note}` : ''), link: list[0].budget_holder_id === uid ? '/my-budget' : '/expenses' });
    if (['approve', 'reject'].includes(action) && list[0].email) sendMail(list[0].email, `${list.length} expense(s) ${verb}`, template({ title: `Expenses ${verb}`, greeting: `Hi ${list[0].creator},`, lines: [...list.slice(0, 15).map(e => `${e.ref_no} · ${e.title} — ${pkr(e.amount)}`), note ? `Note: ${note}` : ''].filter(Boolean) }));
  }
  res.json({ action, updated: out.ok.length, amount: sum(out.ok, 'amount'), skipped: out.skipped });
}));

// ═════════════ "My Budget" — for the employee who received a budget (no Expenses access needed) ═════════════
export const myBudget = express.Router();
myBudget.use(requireAuth);
const MY_SORTS = { date: 'e.expense_date', amount: 'e.amount', status: 'e.status', ref: 'e.ref_no', item: 'lower(e.sub_category)' };

myBudget.get('/me', ah(async (req, res) => {
  const w = await walletOf(null, req.user.id);
  if (!w) return res.json({ wallet: null });
  const bal = await walletBalance(null, req.user.id);
  const entries = await many(`SELECT b.id, b.ref_no, b.kind, b.amount, b.entry_date, b.title, b.payment_method, b.reference_no, b.note, b.status, b.review_note, cb.full_name AS entered_by, b.created_at
                                FROM budget_entries b LEFT JOIN users cb ON cb.id=b.created_by WHERE b.user_id=$1 ORDER BY b.entry_date DESC, b.id DESC LIMIT 200`, [req.user.id]);
  const tree = await categoryTree('variable');
  const ids = (w.category_ids || []).map(Number);
  const byCat = await many(`SELECT category AS name, SUM(amount)::numeric AS value FROM expenses WHERE budget_holder_id=$1 AND status <> 'rejected' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [req.user.id]);
  res.json({
    wallet: { state: w.state, purpose: w.purpose, valid_until: w.valid_until, max_entry: Number(w.max_entry), category_ids: ids, opened_at: w.opened_at, closed_at: w.closed_at, close_note: w.close_note, active: walletActive(w) },
    balance: bal, entries, byCategory: byCat, categories: ids.length ? tree.filter(c => ids.includes(Number(c.id))) : tree,
  });
}));

myBudget.get('/me/expenses', ah(async (req, res) => {
  const w = new Where();
  w.add('e.budget_holder_id = ?', req.user.id);
  const st = qstr(req.query.status); if (['pending', 'approved', 'rejected'].includes(st)) w.add('e.status = ?', st);
  if (req.query.from || req.query.to) { const { from, to } = v.range(req.query); w.add('e.expense_date BETWEEN ? AND ?', from, to); }
  const text = qstr(req.query.q, 80); if (text) { const p = likeText(text); w.add('(lower(e.title) LIKE ? OR lower(e.ref_no) LIKE ? OR lower(e.paid_to) LIKE ? OR lower(e.sub_category) LIKE ?)', p, p, p, p); }
  const tot = await one(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount) FILTER (WHERE status<>'rejected'),0)::numeric AS spent, COALESCE(SUM(amount) FILTER (WHERE status='approved'),0)::numeric AS approved,
      COALESCE(SUM(amount) FILTER (WHERE status='pending'),0)::numeric AS pending, COUNT(*) FILTER (WHERE status='pending')::int AS pending_count,
      COUNT(*) FILTER (WHERE status='approved')::int AS approved_count, COUNT(*) FILTER (WHERE status='rejected')::int AS rejected_count FROM expenses e ${w.sql}`, w.params);
  const pg = paging(req.query, { sorts: MY_SORTS, defaultSort: 'date', tieBreaker: 'e.id DESC' });
  const pages = Math.max(1, Math.ceil(tot.count / pg.limit));
  const page = Math.min(pg.page, pages);
  const params = [...w.params, pg.limit, (page - 1) * pg.limit];
  const rows = await many(`${EXP_SELECT} ${w.sql} ORDER BY ${pg.order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ rows, total: tot.count, page, pages, limit: pg.limit, sort: pg.sort, dir: pg.dir, totals: tot });
}));

myBudget.get('/me/expenses/:id', ah(async (req, res) => {
  const row = await one(`${EXP_SELECT} WHERE e.id=$1 AND e.budget_holder_id=$2`, [v.id(req.params.id), req.user.id]);
  if (!row) throw notFound();
  res.json({ ...row, history: await history('expense', row.id, req.user) });
}));

async function budgetRules(db, user, f) {
  const w = (await db.query('SELECT * FROM budget_wallets WHERE user_id=$1', [user.id])).rows[0];
  if (!w) throw forbidden('You have no expense budget. Ask admin to allot one in Cash Flow Manager.');
  if (w.state !== 'active') throw forbidden('Your budget is closed. Ask admin to re-open it.');
  if (!walletActive(w)) throw forbidden(`Your budget expired on ${String(w.valid_until).slice(0, 10)}. Ask admin to extend it.`);
  if (w.category_ids?.length && !w.category_ids.map(Number).includes(Number(f.category_id))) throw bad(`Your budget can only be used for the categories admin chose.`);
  if (Number(w.max_entry) > 0 && f.amount > Number(w.max_entry)) throw bad(`One expense from your budget can be at most ${pkr(w.max_entry)}.`);
  return w;
}

myBudget.post('/me/expenses', writeLimit, upload.single('receipt'), ah(async (req, res) => {
  const status = isAdmin(req.user) ? 'approved' : 'pending';
  const row = await txWithFiles(async db => {
    await lockWallet(db, req.user.id);
    const f = await variableFields(db, { ...req.body, save_option: false }, req.user);
    await budgetRules(db, req.user, f);
    if (!req.file && (!f.no_receipt_reason || f.no_receipt_reason.length < 5)) throw bad('Please attach the receipt / invoice, or tick “No receipt” and write the reason.');
    const bal = await walletBalance(db, req.user.id);
    if (f.amount > bal.balance) throw bad(`Not enough budget. Available balance is ${pkr(bal.balance)}. Ask admin for more in Cash Flow Manager → Budget allotment.`);
    const receipt = req.file ? await saveFile(db, req.file, 'expense_receipt', req.user.id) : null;
    const ref = (await db.query(`SELECT 'EXP-' || lpad(nextval('expense_seq')::text, 5, '0') AS n`)).rows[0].n;
    const e = (await db.query(`INSERT INTO expenses(ref_no,expense_type,title,category,category_id,sub_category,sub_category_id,location,amount,expense_date,paid_to,payment_method,
                                 reference_no,description,no_receipt_reason,receipt_file_id,status,is_petty_topup,budget_holder_id,created_by,updated_by,reviewed_by,reviewed_at)
                               VALUES ($1,'variable',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,FALSE,$17,$17,$17,$18,$19) RETURNING *`,
    [ref, f.title, f.category, f.category_id, f.sub_category, f.sub_category_id, f.location, f.amount, f.expense_date, f.paid_to, f.payment_method,
      f.reference_no, f.description, receipt ? null : f.no_receipt_reason, receipt?.id || null, status, req.user.id,
      status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null])).rows[0];
    await saveCustom(db, 'expenses', e.id, await readCustom('expenses', req.body.custom_fields));
    await audit(db, req.user, 'expense.create', 'expense', e.id, { ref, type: 'variable', amount: f.amount, category: f.category, item: f.sub_category, status, budget: true });
    return { ...e, balance_after: sub(bal.balance, f.amount), duplicate_receipt: Boolean(receipt?.duplicate_of) };
  });
  if (status === 'pending') sendMail(await approverEmails(), `Budget expense waiting for approval: ${row.ref_no}`, template({ title: 'Expense from an employee budget needs approval', lines: [`${req.user.full_name} spent ${pkr(row.amount)} from their budget on "${row.title}" (${row.category}).`, `Budget left: ${pkr(row.balance_after)}`, row.receipt_file_id ? '' : `No receipt: ${row.no_receipt_reason}`].filter(Boolean), action: { label: 'Review', url: link('/expenses/approvals') } }));
  res.status(201).json(row);
}));

myBudget.put('/me/expenses/:id', writeLimit, upload.single('receipt'), ah(async (req, res) => {
  const id = v.id(req.params.id);
  const ver = version(req.body);
  await txWithFiles(async db => {
    await lockWallet(db, req.user.id);
    const cur = (await db.query('SELECT * FROM expenses WHERE id=$1 AND budget_holder_id=$2', [id, req.user.id])).rows[0];
    if (!cur) throw notFound();
    if (cur.status !== 'pending' && !isAdmin(req.user)) throw forbidden('Only entries that are still “Not approved” can be edited.');
    if (cur.version !== ver) throw conflict();
    const f = await variableFields(db, { ...req.body, save_option: false }, req.user);
    await budgetRules(db, req.user, f);
    if (!req.file && !cur.receipt_file_id && (!f.no_receipt_reason || f.no_receipt_reason.length < 5)) throw bad('Please attach the receipt / invoice, or write why there is no receipt.');
    const bal = await walletBalance(db, req.user.id);
    if (sub(f.amount, cur.amount) > bal.balance) throw bad(`Not enough budget for the new amount. Available: ${pkr(add(bal.balance, cur.amount))}.`);
    const receipt = req.file ? await saveFile(db, req.file, 'expense_receipt', req.user.id) : null;
    const u = await db.query(`UPDATE expenses SET title=$1,category=$2,category_id=$3,sub_category=$4,sub_category_id=$5,location=$6,amount=$7,expense_date=$8,paid_to=$9,payment_method=$10,
                                reference_no=$11,description=$12,no_receipt_reason=CASE WHEN COALESCE($13::bigint, receipt_file_id) IS NULL THEN $14 ELSE NULL END,
                                receipt_file_id=COALESCE($13,receipt_file_id), version=version+1, updated_by=$15, updated_at=NOW() WHERE id=$16 AND version=$17`,
    [f.title, f.category, f.category_id, f.sub_category, f.sub_category_id, f.location, f.amount, f.expense_date, f.paid_to, f.payment_method, f.reference_no, f.description,
      receipt?.id || null, f.no_receipt_reason, req.user.id, id, ver]);
    if (!u.rowCount) throw conflict();
    if (req.body.custom_fields !== undefined) await saveCustom(db, 'expenses', id, await readCustom('expenses', req.body.custom_fields, { existing: cur.custom_fields }));
    await audit(db, req.user, 'expense.update', 'expense', id, { changes: diff(cur, f, ['title', 'category', 'sub_category', 'amount', 'expense_date', 'paid_to', 'payment_method']), budget: true });
  });
  res.json(await one(`${EXP_SELECT} WHERE e.id=$1`, [id]));
}));
