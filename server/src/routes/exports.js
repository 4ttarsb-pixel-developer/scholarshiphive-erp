import express from 'express';
import { one, many } from '../db.js';
import { ah, bad, forbidden } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { can, isAdmin } from '../lib/permissions.js';
import { tablePdf } from '../lib/pdf.js';
import { audit } from '../lib/audit.js';
import { listDeals } from './revenue.js';
import { salariesInRange, exportExpenses, exportPetty, recurringWhere, nextDue, FREQUENCY_LABELS, pettyBalance } from './expenses.js';
import { qstr, qid } from '../lib/paging.js';
import { liabilitySummary } from './liabilities.js';
import { periodFigures } from './finance.js';
import { forecastData, loadReceivables, IN_LABELS, OUT_LABELS } from './cashflow.js';
import { computeMonth } from './salary.js';
import { sum, sub, add, pkr, currentMonth, monthLabel } from '../lib/money.js';

const fmtDate = d => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : '');
const fmtDT = d => (d ? new Date(d).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const cap = s => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const dmy = d => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const catName = async id => (id ? (await one('SELECT name FROM expense_categories WHERE id=$1', [id]))?.name : null);

/** Human-readable list of the filters that were applied (printed on the PDF). */
async function filterLabels(q, extra = []) {
  const out = [];
  const t = qstr(q.type); if (t === 'constant' || t === 'variable') out.push(['Type', cap(t)]);
  const m = qstr(q.month, 7); if (/^\d{4}-\d{2}$/.test(m)) out.push(['Month', monthLabel(m)]);
  const st = qstr(q.status); if (st) out.push(['Status', st === 'pending' ? 'Not approved / to verify' : cap(st)]);
  const c = await catName(qid(q.category_id)); if (c) out.push(['Category', c]);
  const sc = (await catName(qid(q.sub_category_id))) || qstr(q.sub_category); if (sc) out.push(['Item', sc]);
  for (const [k, label] of [['method', 'Method'], ['mode', 'Paid with'], ['location', 'Department'], ['purchased_by', 'Bought by'], ['frequency', 'Frequency'], ['state', 'State'], ['q', 'Search']]) {
    const val = qstr(q[k], 80); if (val) out.push([label, k === 'frequency' ? FREQUENCY_LABELS[val] || val : k === 'state' ? cap(val) : val]);
  }
  if (qstr(q.receipt) === 'missing') out.push(['Receipt', 'Missing']);
  if (qstr(q.receipt) === 'attached') out.push(['Receipt', 'Attached']);
  if (qstr(q.mine) === '1') out.push(['Entered by', 'Me']);
  return [...out, ...extra];
}
const statusText = s => (s === 'pending' ? 'Not approved' : cap(s));

/** Every exportable table. Each returns {title, columns, rows, summary}. */
const DATASETS = {
  sales: { perm: 'revenue', title: 'Revenue', async build(q) {
    const hasRange = (q.from || q.to) && qstr(q.all) !== '1';
    const { from, to } = hasRange ? v.range(q) : {};
    const { rows } = await listDeals({ ...q, ...(hasRange ? { from, to } : { all: '1' }) }, { cap: 20000 });
    rows.forEach((x, i) => { x._n = i + 1; });
    const filters = [];
    const staffName = qid(q.staff) ? (await one('SELECT full_name FROM users WHERE id=$1', [qid(q.staff)]))?.full_name : null;
    for (const [k, label] of [['q', 'Search'], ['status', 'Status'], ['method', 'Method'], ['category', 'Category'], ['package', 'Package'], ['country', 'Country'], ['service', 'Service']]) { const x = qstr(q[k], 120); if (x) filters.push([label, x]); }
    if (staffName) filters.push(['Staff', staffName]);
    const view = qstr(q.view); if (view) filters.push(['View', { upcoming: 'Upcoming (next 30 days)', overdue: 'Overdue', refunds: 'Refunds', outstanding: 'Outstanding' }[view] || view]);
    const gross = sum(rows, 'total_amount'), paid = sum(rows, 'paid');
    return { title: 'Revenue', from, to, rows, filters, columns: [
      { key: '_n', label: '#', width: 0.35, align: 'center' },
      { key: 'sale_date', label: 'Date', width: 0.95, get: r => dmy(r.sale_date), csv: r => fmtDate(r.sale_date) }, { key: 'invoice_no', label: 'Invoice', width: 0.9 },
      { key: 'customer_name', label: 'Client', width: 1.4 }, { key: 'customer_phone', label: 'Phone', width: 1.1, pdf: false }, { key: 'customer_email', label: 'Email', width: 1.3, pdf: false },
      { key: 'revenue_category', label: 'Category', width: 1.2, pdf: false }, { key: 'service', label: 'Service', width: 1.5, get: r => r.service || '-' }, { key: 'package', label: 'Package', width: 1.3 },
      { key: 'destination', label: 'Country', width: 0.9 }, { key: 'total_amount', label: 'Total', money: true, width: 1.1 }, { key: 'paid', label: 'Received', money: true, width: 1.1 },
      { key: 'outstanding', label: 'Pending', money: true, width: 1.05 }, { key: 'refunded', label: 'Refunded', money: true, width: 1, pdf: false },
      { key: 'due', label: 'Next due', width: 0.9, pdf: false, get: r => (r.due ? dmy(r.due) : ''), csv: r => r.due || '' },
      { key: 'status', label: 'Status', width: 0.95 }, { key: 'employee_name', label: 'Staff', width: 1.05 }],
      summary: [{ label: 'Gross revenue', value: pkr(gross) }, { label: 'Collected', value: pkr(paid), color: 'green' }, { label: 'Outstanding', value: pkr(sum(rows, 'outstanding')), color: 'amber' },
        { label: 'Refunds', value: pkr(sum(rows, 'refunded')), color: 'rose' }, { label: 'Collection rate', value: (gross > 0 ? Math.round((paid / gross) * 1000) / 10 : 0) + '%', color: 'purple' }, { label: 'Deals', value: rows.length, color: 'blue' }] };
  } },
  invoices: { perm: 'revenue', title: 'Invoices', async build(q) { const d = await DATASETS.sales.build(q); return { ...d, title: 'Invoices' }; } },
  customers: { perm: 'revenue', title: 'Customers', async build() {
    const rows = await many(`SELECT c.name, c.phone, c.email, c.country, COUNT(s.id)::int AS deals, COALESCE(SUM(s.total_amount),0)::numeric AS total,
        COALESCE(SUM((SELECT SUM(amount) FROM sale_payments p WHERE p.sale_id=s.id)),0)::numeric AS paid
      FROM customers c JOIN sales s ON s.customer_id=c.id GROUP BY c.id ORDER BY total DESC LIMIT 20000`);
    rows.forEach(x => { x.outstanding = Math.max(0, sub(x.total, x.paid)); });
    return { rows, columns: [{ key: 'name', label: 'Customer', width: 2 }, { key: 'phone', label: 'Phone', width: 1.4 }, { key: 'email', label: 'Email', width: 1.6 }, { key: 'country', label: 'Country', width: 1 }, { key: 'deals', label: 'Deals', width: 0.6, align: 'right' }, { key: 'total', label: 'Total', money: true, width: 1.3 }, { key: 'paid', label: 'Received', money: true, width: 1.3 }, { key: 'outstanding', label: 'Outstanding', money: true, width: 1.3 }],
      summary: [{ label: 'Customers', value: rows.length }, { label: 'Total business', value: pkr(sum(rows, 'total')) }, { label: 'Received', value: pkr(sum(rows, 'paid')), color: 'green' }, { label: 'Outstanding', value: pkr(sum(rows, 'outstanding')), color: 'amber' }] };
  } },
  payments: { perm: 'revenue', title: 'Payments Received', async build(q) {
    const { from, to } = v.range(q);
    const rows = await many(`SELECT p.*, s.invoice_no, c.name AS customer_name, u.full_name AS employee_name FROM sale_payments p JOIN sales s ON s.id=p.sale_id JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.employee_id WHERE p.payment_date BETWEEN $1 AND $2 ORDER BY p.payment_date DESC`, [from, to]);
    return { from, to, rows, columns: [{ key: 'payment_date', label: 'Date', get: r => fmtDate(r.payment_date) }, { key: 'invoice_no', label: 'Invoice #' }, { key: 'customer_name', label: 'Customer', width: 1.6 }, { key: 'employee_name', label: 'Sales staff', width: 1.4 }, { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference' }, { key: 'amount', label: 'Amount', money: true, width: 1.2 }],
      summary: [{ label: 'Payments', value: rows.length }, { label: 'Collected', value: pkr(sum(rows, 'amount')) }] };
  } },
  refunds: { perm: 'revenue', title: 'Refunds', async build(q) {
    const { from, to } = v.range(q);
    const rows = await many(`SELECT r.*, s.invoice_no, c.name AS customer_name FROM sale_refunds r JOIN sales s ON s.id=r.sale_id JOIN customers c ON c.id=s.customer_id WHERE r.refund_date BETWEEN $1 AND $2 ORDER BY r.refund_date DESC`, [from, to]);
    return { from, to, rows, columns: [{ key: 'refund_date', label: 'Date', get: r => fmtDate(r.refund_date) }, { key: 'invoice_no', label: 'Invoice #' }, { key: 'customer_name', label: 'Customer', width: 1.6 }, { key: 'reason', label: 'Reason', width: 2.4 }, { key: 'amount', label: 'Amount', money: true, width: 1.2 }],
      summary: [{ label: 'Refunds', value: rows.length }, { label: 'Total refunded', value: pkr(sum(rows, 'amount')) }] };
  } },
  expenses: { perm: 'expenses', title: 'Expenses', async build(q, user) {
    const t = qstr(q.type);
    const { from, to } = q.month || q.all === '1' ? {} : v.range(q);
    const rows = await exportExpenses(q, user);
    const approved = rows.filter(r => r.status === 'approved'), pending = rows.filter(r => r.status === 'pending'), rejected = rows.filter(r => r.status === 'rejected');
    const title = t === 'constant' ? 'Constant Expenses' : t === 'variable' ? 'Variable Expenses' : 'Expenses';
    return { title, from, to, subtitle: q.month ? monthLabel(q.month) : undefined, rows, filters: await filterLabels(q), columns: [
      { key: 'expense_date', label: t === 'constant' ? 'Due date' : 'Date', width: 1, get: r => dmy(r.expense_date), csv: r => fmtDate(r.expense_date) }, { key: 'ref_no', label: 'Ref #', width: 0.9 },
      ...(t ? [] : [{ key: 'expense_type', label: 'Type', width: 0.8, get: r => cap(r.expense_type) }]),
      { key: 'category', label: 'Category', width: 1.6 }, { key: 'sub_category', label: 'Expense item', width: 1.7, get: r => r.sub_category || '-' },
      { key: 'title', label: 'Details', width: 1.6, get: r => [r.title !== r.sub_category ? r.title : '', r.reference_no ? `Ref ${r.reference_no}` : ''].filter(Boolean).join(' · ') || '-' }, { key: 'paid_to', label: 'Paid to', width: 1.2 }, { key: 'location', label: 'Department', width: 1.1, get: r => r.location || '-' },
      { key: 'payment_method', label: 'Method', width: 0.9 }, { key: 'entered_by', label: 'Entered by', width: 1.1 },
      { key: 'status', label: 'Status', width: 0.95, get: r => statusText(r.status) }, { key: 'amount', label: 'Amount', money: true, width: 1.15 }],
      summary: [{ label: 'Records', value: rows.length }, { label: 'Total', value: pkr(sum(rows, 'amount')), color: 'navy' }, { label: 'Approved', value: pkr(sum(approved, 'amount')) },
        { label: 'Not approved', value: pkr(sum(pending, 'amount')), color: 'amber' }, { label: 'Rejected', value: pkr(sum(rejected, 'amount')) }, { label: 'Approval rate', value: rows.length ? Math.round((approved.length / rows.length) * 100) + '%' : '0%' }],
      note: rows.length >= 20000 ? 'Only the first 20,000 rows are included. Narrow the filters for a complete report.' : undefined };
  } },
  'constant-cycles': { perm: 'expenses', title: 'Constant Expenses', async build(q, user) { return DATASETS.expenses.build({ ...q, type: 'constant', month: q.month || currentMonth() }, user); } },
  'variable-expenses': { perm: 'expenses', title: 'Variable Expenses', async build(q, user) { return DATASETS.expenses.build({ ...q, type: 'variable' }, user); } },
  recurring: { perm: 'expenses', title: 'Recurring Constant Expenses', async build(q) {
    const w = recurringWhere(q);
    const rows = (await many(`SELECT r.*, u.full_name AS entered_by FROM recurring_expenses r LEFT JOIN users u ON u.id=r.created_by ${w.sql} ORDER BY r.state, lower(r.category), lower(r.title) LIMIT 5000`, w.params))
      .map(r => ({ ...r, next_due: nextDue(r), per_month: Math.round((Number(r.amount) / { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 }[r.frequency]) * 100) / 100 }));
    const live = rows.filter(r => r.status === 'approved' && r.state === 'active');
    return { rows, filters: await filterLabels(q), subtitle: `As of ${dmy(new Date().toISOString())}`, columns: [
      { key: 'ref_no', label: 'Ref #', width: 0.8 }, { key: 'title', label: 'Title', width: 1.6 }, { key: 'category', label: 'Category', width: 1.5 }, { key: 'sub_category', label: 'Expense item', width: 1.5, get: r => r.sub_category || '-' },
      { key: 'frequency', label: 'Frequency', width: 0.9, get: r => cap(r.frequency) }, { key: 'billing_day', label: 'Due day', width: 0.6, align: 'center' }, { key: 'start_month', label: 'From', width: 0.8, get: r => monthLabel(r.start_month).replace(/^(\w{3})\w*/, '$1') },
      { key: 'next_due', label: 'Next due', width: 0.9, get: r => (r.next_due ? dmy(r.next_due) : '-'), csv: r => r.next_due || '' }, { key: 'paid_to', label: 'Paid to', width: 1.1 },
      { key: 'status', label: 'Status', width: 0.85, get: r => (r.state !== 'active' ? cap(r.state) : statusText(r.status)) }, { key: 'per_month', label: 'Per month', money: true, width: 1.05 }, { key: 'amount', label: 'Amount', money: true, width: 1.05 }],
      summary: [{ label: 'Recurring expenses', value: rows.length }, { label: 'Active & approved', value: live.length, color: 'green' }, { label: 'Monthly commitment', value: pkr(sum(live, 'per_month')), color: 'navy' }, { label: 'Yearly commitment', value: pkr(sum(live, 'per_month') * 12), color: 'purple' }] };
  } },
  salaries: { perm: 'expenses', title: 'Salaries (Approved & Paid)', async build(q) {
    const { from, to } = v.range(q);
    const rows = await salariesInRange(from, to);
    return { from, to, rows, columns: [{ key: 'month', label: 'Month', get: r => monthLabel(r.month) }, { key: 'employee_code', label: 'Emp ID' }, { key: 'full_name', label: 'Name', width: 1.6 }, { key: 'base_salary', label: 'Base', money: true }, { key: 'commission', label: 'Commission', money: true }, { key: 'bonus', label: 'Bonus', money: true }, { key: 'deductions', label: 'Deductions', money: true }, { key: 'net_salary', label: 'Net salary', money: true, width: 1.2 }, { key: 'status', label: 'Status', get: r => cap(r.status) }],
      summary: [{ label: 'Salaries', value: rows.length }, { label: 'Total', value: pkr(sum(rows, 'net_salary')) }, { label: 'Paid', value: pkr(sum(rows.filter(r => r.status === 'paid'), 'net_salary')) }] };
  } },
  loans: { perm: ['expenses', 'liabilities'], title: 'Loans & Liabilities', async build(q) {
    const { from, to } = v.range(q);
    const d = await liabilitySummary(from, to);
    return { from, to, rows: d.rows, columns: [{ key: 'title', label: 'Title', width: 1.6 }, { key: 'type', label: 'Type', get: r => cap(r.type) }, { key: 'lender', label: 'Lender', width: 1.4 }, { key: 'interest_type', label: 'Interest', get: r => r.interest_type === 'none' ? 'None' : `${cap(r.interest_type)} ${r.annual_rate}%` }, { key: 'start_date', label: 'Start', get: r => fmtDate(r.start_date) }, { key: 'term_months', label: 'Months', align: 'right', width: 0.6 }, { key: 'principal', label: 'Principal', money: true }, { key: 'total_payable', label: 'Payable', money: true }, { key: 'paid', label: 'Paid', money: true }, { key: 'outstanding', label: 'Outstanding', money: true }],
      summary: [{ label: 'Principal', value: pkr(d.totals.principal) }, { label: 'Outstanding', value: pkr(d.totals.outstanding) }, { label: 'Repaid in period', value: pkr(d.paidInRange) }] };
  } },
  petty: { perm: 'petty_cash', title: 'Petty Cash', async build(q, user) {
    const { from, to } = q.all === '1' ? {} : v.range(q);
    const rows = await exportPetty(q, user);
    const live = rows.filter(r => r.status !== 'rejected');
    const bal = await pettyBalance();
    const receipt = r => (r.status === 'pending' ? 'To verify' : cap(r.status));
    return { title: 'Petty Cash', from, to, rows, filters: await filterLabels(q), columns: [
      { key: 'entry_date', label: 'Date', width: 0.95, get: r => dmy(r.entry_date), csv: r => fmtDate(r.entry_date) }, { key: 'ref_no', label: 'Voucher #', width: 0.85 },
      { key: 'category', label: 'Category', width: 1.6 }, { key: 'sub_category', label: 'Expense item', width: 1.6, get: r => r.sub_category || '-' }, { key: 'title', label: 'Details', width: 1.5, get: r => [r.title !== r.sub_category ? r.title : '', r.related_to ? `For ${r.related_to}` : '', r.receipt_file_id ? '' : r.no_receipt_reason || ''].filter(Boolean).join(' · ') || '-' },
      { key: 'purchased_by', label: 'Bought by', width: 1.1 }, { key: 'vendor', label: 'Shop / vendor', width: 1.05, get: r => r.vendor || '-' }, { key: 'payment_mode', label: 'Paid with', width: 0.8 },
      { key: 'receipt', label: 'Receipt', width: 0.8, get: r => (r.receipt_file_id ? 'Attached' : 'No receipt') },
      { key: 'status', label: 'Status', width: 0.85, get: receipt }, { key: 'amount', label: 'Amount', money: true, width: 1.05 }],
      summary: [{ label: 'Entries', value: rows.length }, { label: 'Spent (not rejected)', value: pkr(sum(live, 'amount')), color: 'navy' },
        { label: 'Verified', value: pkr(sum(rows.filter(r => r.status === 'verified'), 'amount')) }, { label: 'To verify', value: pkr(sum(rows.filter(r => r.status === 'pending'), 'amount')) },
        { label: 'Rejected', value: pkr(sum(rows.filter(r => r.status === 'rejected'), 'amount')) }, { label: 'Current balance', value: pkr(bal.balance), color: bal.balance > 0 ? 'green' : 'rose' }] };
  } },
  'petty-ledger': { perm: 'petty_cash', title: 'Petty Cash Book', async build(q) {
    const { from, to } = v.range(q);
    const base = `WITH t AS (
        SELECT 'topup'::text AS kind, e.id, e.ref_no, e.expense_date AS d, e.created_at, e.title, e.paid_to AS party, '' AS category, e.amount AS credit, 0::numeric AS debit FROM expenses e WHERE e.is_petty_topup AND e.status='approved'
        UNION ALL
        SELECT 'spend', p.id, p.ref_no, p.entry_date, p.created_at, p.title, p.purchased_by, p.category || CASE WHEN p.sub_category <> '' THEN ' › ' || p.sub_category ELSE '' END, 0, p.amount FROM petty_cash_entries p WHERE p.status <> 'rejected'
      ), r AS (SELECT t.*, SUM(credit - debit) OVER (ORDER BY d, created_at, kind DESC, id ROWS UNBOUNDED PRECEDING) AS balance FROM t)`;
    const rows = await many(`${base} SELECT * FROM r WHERE d BETWEEN $1 AND $2 ORDER BY d, created_at, kind DESC, id LIMIT 20000`, [from, to]);
    const opening = Number((await one(`${base} SELECT COALESCE(SUM(credit - debit),0)::numeric AS n FROM r WHERE d < $1`, [from])).n);
    const credits = sum(rows, 'credit'), debits = sum(rows, 'debit');
    return { from, to, rows, filters: [['Opening balance', pkr(opening)]], columns: [
      { key: 'd', label: 'Date', width: 0.95, get: r => dmy(r.d), csv: r => fmtDate(r.d) }, { key: 'ref_no', label: 'Ref #', width: 0.9 }, { key: 'kind', label: 'Type', width: 0.8, get: r => (r.kind === 'topup' ? 'Top-up' : 'Purchase') },
      { key: 'title', label: 'Details', width: 1.9 }, { key: 'category', label: 'Category', width: 2.1, get: r => r.category || '-' }, { key: 'party', label: 'Given to / bought by', width: 1.3 },
      { key: 'credit', label: 'In (+)', money: true, width: 1.05 }, { key: 'debit', label: 'Out (-)', money: true, width: 1.05 }, { key: 'balance', label: 'Balance', money: true, total: false, width: 1.1 }],
      summary: [{ label: 'Opening balance', value: pkr(opening), color: 'navy' }, { label: 'Top-ups in', value: pkr(credits), color: 'green' }, { label: 'Spent out', value: pkr(debits), color: 'amber' }, { label: 'Closing balance', value: pkr(sub(add(opening, credits), debits)), color: 'blue' }] };
  } },
  'petty-topups': { perm: 'petty_cash', title: 'Petty Cash Top-ups', async build(q) {
    const params = [];
    let where = 'WHERE e.is_petty_topup';
    if (q.from || q.to) { const { from, to } = v.range(q); params.push(from, to); where += ' AND e.expense_date BETWEEN $1 AND $2'; }
    const rows = await many(`SELECT e.*, u.full_name AS entered_by FROM expenses e LEFT JOIN users u ON u.id=e.created_by ${where} ORDER BY e.expense_date DESC, e.id DESC LIMIT 20000`, params);
    return { from: params[0], to: params[1], rows, columns: [
      { key: 'expense_date', label: 'Date', get: r => dmy(r.expense_date), csv: r => fmtDate(r.expense_date) }, { key: 'ref_no', label: 'Ref #' }, { key: 'paid_to', label: 'Given to', width: 1.4 }, { key: 'payment_method', label: 'Method' },
      { key: 'reference_no', label: 'Reference', get: r => r.reference_no || '-' }, { key: 'entered_by', label: 'Entered by', width: 1.2 }, { key: 'status', label: 'Status', get: r => statusText(r.status) }, { key: 'amount', label: 'Amount', money: true, width: 1.1 }],
      summary: [{ label: 'Top-ups', value: rows.length }, { label: 'Approved', value: pkr(sum(rows.filter(r => r.status === 'approved'), 'amount')) }, { label: 'Not approved', value: pkr(sum(rows.filter(r => r.status === 'pending'), 'amount')), color: 'amber' }] };
  } },
  salary: { perm: 'salary', title: 'Legacy Salary Manager', async build(q) {
    const month = q.month ? v.month(q.month) : currentMonth();
    const users = await many(`SELECT id, employee_code, full_name, designation FROM users WHERE status IN ('approved','blocked') ORDER BY employee_code`);
    const rows = await Promise.all(users.map(async u => ({ ...u, ...(await computeMonth(null, u.id, month)) })));
    return { subtitle: monthLabel(month), rows, columns: [{ key: 'employee_code', label: 'Emp ID' }, { key: 'full_name', label: 'Name', width: 1.6 }, { key: 'designation', label: 'Designation', width: 1.3 }, { key: 'sales', label: 'Monthly sales', money: true }, { key: 'commission_pct', label: 'Comm. %', align: 'right', width: 0.7 }, { key: 'base_salary', label: 'Base', money: true }, { key: 'commission', label: 'Commission', money: true }, { key: 'bonus', label: 'Bonus', money: true }, { key: 'deductions', label: 'Deductions', money: true }, { key: 'net_salary', label: 'Net salary', money: true }, { key: 'status_label', label: 'Status' }],
      summary: [{ label: 'Employees', value: rows.length }, { label: 'Total sales', value: pkr(sum(rows, 'sales')) }, { label: 'Total commission', value: pkr(sum(rows, 'commission')) }, { label: 'Total net salary', value: pkr(sum(rows, 'net_salary')) }] };
  } },
  'my-salary': { perm: null, title: 'My Salary History', async build(_q, user) {
    const rows = await many(`SELECT * FROM payroll_months WHERE user_id=$1 AND status IN ('approved','paid') ORDER BY month DESC`, [user.id]);
    return { subtitle: `${user.full_name} (${user.employee_code})`, rows, columns: [{ key: 'month', label: 'Month', get: r => monthLabel(r.month) }, { key: 'slip_no', label: 'Slip #', width: 1.4 }, { key: 'snap_sales', label: 'Sales', money: true }, { key: 'snap_commission', label: 'Commission', money: true }, { key: 'snap_net', label: 'Net salary', money: true }, { key: 'status', label: 'Status', get: r => cap(r.status) }, { key: 'paid_at', label: 'Paid on', get: r => fmtDT(r.paid_at), width: 1.4 }] };
  } },
  assets: { perm: 'assets', title: 'Assets Register', async build(q) {
    const where = []; const params = [];
    const LQ = { high: 'High liquid', medium: 'Medium liquid', low: 'Low / illiquid' };
    if (LQ[q.liquidity]) { params.push(q.liquidity); where.push(`liquidity=$${params.length}`); }
    if (['active', 'disposed'].includes(q.status)) { params.push(q.status); where.push(`status=$${params.length}`); }
    if (q.category) { params.push(qstr(q.category, 120)); where.push(`category=$${params.length}`); }
    if (q.from) { params.push(v.date(q.from, 'From date')); where.push(`purchase_date >= $${params.length}`); }
    if (q.to) { params.push(v.date(q.to, 'To date')); where.push(`purchase_date <= $${params.length}`); }
    const rows = await many(`SELECT * FROM assets ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY liquidity, status, purchase_date DESC`, params);
    const filters = [];
    if (LQ[q.liquidity]) filters.push(['Liquidity', LQ[q.liquidity]]);
    if (q.status) filters.push(['Status', cap(q.status)]);
    if (q.category) filters.push(['Category', qstr(q.category, 120)]);
    const active = rows.filter(r => r.status === 'active');
    return { rows, filters, from: q.from || undefined, to: q.to || undefined, columns: [{ key: 'name', label: 'Asset', width: 1.7 }, { key: 'liquidity', label: 'Liquidity', get: r => LQ[r.liquidity] || r.liquidity, width: 1.1 }, { key: 'category', label: 'Category', width: 1.3 }, { key: 'sub_category', label: 'Sub-category', width: 1.3, get: r => r.sub_category || '-' }, { key: 'asset_type', label: 'Type', get: r => cap(r.asset_type), width: 0.8 }, { key: 'quantity', label: 'Qty', width: 0.5, pdf: false }, { key: 'purchase_date', label: 'Acquired', get: r => fmtDate(r.purchase_date) }, { key: 'location', label: 'Location', pdf: false }, { key: 'serial_no', label: 'Serial / ref', pdf: false }, { key: 'vendor', label: 'Vendor', pdf: false }, { key: 'status', label: 'Status', get: r => cap(r.status), width: 0.8 }, { key: 'cost', label: 'Cost', money: true }, { key: 'current_value', label: 'Current value', money: true }],
      summary: [{ label: 'Assets', value: rows.length }, { label: 'Total cost', value: pkr(sum(rows, 'cost')) }, { label: 'Current value', value: pkr(sum(active, 'current_value')) },
        ...Object.entries(LQ).map(([k, l]) => ({ label: l, value: pkr(sum(active.filter(r => r.liquidity === k), 'current_value')) }))] };
  } },
  liabilities: { perm: 'liabilities', title: 'Liabilities', async build(q) { return DATASETS.loans.build(q); } },
  capital: { perm: ['cashflow', 'assets'], title: 'Capital Entries', async build(q) {
    const where = []; const params = [];
    if (['equity', 'debt', 'fixed', 'working'].includes(q.class)) { params.push(q.class); where.push(`capital_class=$${params.length}`); }
    if (q.from) { params.push(v.date(q.from, 'From date')); where.push(`entry_date >= $${params.length}`); }
    if (q.to) { params.push(v.date(q.to, 'To date')); where.push(`entry_date <= $${params.length}`); }
    const rows = await many(`SELECT * FROM capital_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY entry_date DESC`, params);
    const inv = sum(rows.filter(r => r.type === 'investment'), 'amount'); const dr = sum(rows.filter(r => r.type === 'drawing'), 'amount');
    return { rows, from: q.from || undefined, to: q.to || undefined, columns: [{ key: 'entry_date', label: 'Date', get: r => fmtDate(r.entry_date) }, { key: 'capital_class', label: 'Capital type', get: r => cap(r.capital_class) }, { key: 'type', label: 'Movement', get: r => (r.type === 'investment' ? 'Added' : 'Withdrawn') }, { key: 'source_type', label: 'Source' }, { key: 'party', label: 'Owner / partner', width: 1.5 }, { key: 'method', label: 'Method', pdf: false }, { key: 'reference_no', label: 'Reference', pdf: false }, { key: 'note', label: 'Note', width: 2 }, { key: 'amount', label: 'Amount', money: true }],
      summary: [{ label: 'Added', value: pkr(inv) }, { label: 'Withdrawn', value: pkr(dr) }, { label: 'Net', value: pkr(sub(inv, dr)) }] };
  } },
  cashflow: { perm: 'cashflow', title: 'Cash Flow & Profit / Loss', async build(q) {
    const { from, to } = v.range(q);
    const p = await periodFigures(from, to);
    const rows = [
      { section: 'Revenue', item: 'Sales booked (deal value)', amount: p.revenue.salesBooked },
      { section: 'Revenue', item: 'Collected from customers', amount: p.revenue.collected },
      { section: 'Revenue', item: 'Less: refunds', amount: -p.revenue.refunds },
      { section: 'Revenue', item: 'NET REVENUE', amount: p.revenue.net },
      { section: 'Expenses', item: 'Operating expenses (approved)', amount: p.expenses.operating },
      { section: 'Expenses', item: 'Petty cash spent', amount: p.expenses.petty },
      { section: 'Expenses', item: 'Salaries (approved + paid)', amount: p.expenses.salaries },
      { section: 'Expenses', item: 'Loan interest', amount: p.expenses.loanInterest },
      { section: 'Expenses', item: 'TOTAL EXPENSES', amount: p.expenses.total },
      { section: 'Profit', item: `NET PROFIT / LOSS (margin ${p.profit.margin}%)`, amount: p.profit.net },
      { section: 'Cash in', item: 'Customer payments', amount: p.cash.in.collected },
      { section: 'Cash in', item: 'Owner investment', amount: p.cash.in.investment },
      { section: 'Cash in', item: 'Loans received', amount: p.cash.in.loansReceived },
      { section: 'Cash out', item: 'Refunds', amount: p.cash.out.refunds },
      { section: 'Cash out', item: 'Operating expenses', amount: p.cash.out.operating },
      { section: 'Cash out', item: 'Petty cash', amount: p.cash.out.petty },
      { section: 'Cash out', item: 'Salaries paid', amount: p.cash.out.salariesPaid },
      { section: 'Cash out', item: 'Loan repayments', amount: p.cash.out.loanRepayments },
      { section: 'Cash out', item: 'Asset purchases', amount: p.cash.out.assetPurchases },
      { section: 'Cash out', item: 'Owner drawings', amount: p.cash.out.drawing },
      { section: 'Cash', item: 'NET CASH FLOW', amount: p.cash.net },
    ];
    return { from, to, rows, columns: [{ key: 'section', label: 'Section', width: 1 }, { key: 'item', label: 'Item', width: 3 }, { key: 'amount', label: 'Amount', money: true, total: false, width: 1.3 }],
      summary: [{ label: 'Net revenue', value: pkr(p.revenue.net) }, { label: 'Total expenses', value: pkr(p.expenses.total) }, { label: 'Net profit / loss', value: pkr(p.profit.net) }, { label: 'Net cash flow', value: pkr(p.cash.net) }], landscape: false };
  } },
  'cash-forecast': { perm: 'cashflow', title: 'Cash Forecast (Cash Budget)', async build(q) {
    const months = Math.min(18, Math.max(2, parseInt(qstr(q.months, 2), 10) || 6));
    const scenario = ['base', 'best', 'worst'].includes(qstr(q.scenario)) ? qstr(q.scenario) : 'base';
    const f = await forecastData({ months, scenario });
    const rows = [];
    const line = (section, item, get) => rows.push({ section, item, ...Object.fromEntries(f.monthly.map((m, i) => [`m${i}`, get(m)])) });
    line('Cash', 'Opening cash', m => m.opening);
    for (const k of Object.keys(IN_LABELS)) line('Cash in', IN_LABELS[k], m => m.in[k]);
    line('Cash in', 'TOTAL CASH IN', m => m.inflow);
    for (const k of Object.keys(OUT_LABELS)) line('Cash out', OUT_LABELS[k], m => m.out[k]);
    line('Cash out', 'TOTAL CASH OUT', m => m.outflow);
    line('Result', 'Net cash flow', m => m.net);
    line('Result', 'Closing cash', m => m.closing);
    line('Result', 'Lowest point in the month', m => m.low);
    line('Result', 'Minimum cash buffer', m => m.buffer);
    line('Result', 'Surplus above buffer', m => m.surplus);
    line('Result', 'Financing needed', m => m.need);
    return { title: `Cash Forecast — ${scenario === 'base' ? 'expected' : scenario + ' case'}`, subtitle: `${f.monthly[0]?.label || ''} – ${f.monthly[f.monthly.length - 1]?.label || ''}`, rows, landscape: true,
      columns: [{ key: 'section', label: 'Section', width: 0.8 }, { key: 'item', label: 'Item', width: 2.2 }, ...f.monthly.map((m, i) => ({ key: `m${i}`, label: m.label.replace(' (rest)', '*'), money: true, total: false }))],
      summary: [{ label: 'Cash today', value: pkr(f.pos.cash) }, { label: 'Closing', value: pkr(f.monthly[f.monthly.length - 1]?.closing || 0) }, { label: 'Deficit months', value: f.monthly.filter(m => m.status !== 'surplus').length, color: 'amber' }],
      note: '* rest of the current month (from today).' };
  } },
  receivables: { perm: ['cashflow', 'revenue'], title: 'Receivables (Student Fees Due)', async build() {
    const { items } = await loadReceivables();
    const rows = items.sort((a, b) => b.days_overdue - a.days_overdue || a.due_date.localeCompare(b.due_date));
    return { rows, columns: [
      { key: 'due_date', label: 'Due date', get: r => dmy(r.due_date), csv: r => fmtDate(r.due_date) }, { key: 'invoice_no', label: 'Invoice' }, { key: 'customer', label: 'Student / client', width: 1.5 },
      { key: 'phone', label: 'Phone', get: r => r.phone || '-' }, { key: 'employee_name', label: 'Counsellor', width: 1.2 }, { key: 'destination', label: 'Country', get: r => r.destination || '-' },
      { key: 'days_overdue', label: 'Days overdue', get: r => (r.days_overdue ? String(r.days_overdue) : '-') }, { key: 'amount', label: 'Amount due', money: true, width: 1.1 }],
      summary: [{ label: 'Open installments', value: rows.length }, { label: 'Total due', value: pkr(sum(rows, 'amount')) }, { label: 'Overdue', value: pkr(sum(rows.filter(r => r.days_overdue > 0), 'amount')), color: 'amber' }] };
  } },
  'budget-entries': { perm: 'cashflow', title: 'Budget Allotments & Petty Top-ups', async build() {
    const rows = await many(`SELECT * FROM (
        SELECT 'Employee budget' AS source, b.ref_no, b.kind, u.full_name AS holder, b.amount, b.entry_date, b.payment_method, b.reference_no, b.status, cb.full_name AS entered_by
          FROM budget_entries b JOIN users u ON u.id=b.user_id LEFT JOIN users cb ON cb.id=b.created_by
        UNION ALL
        SELECT 'Petty cash', e.ref_no, 'topup', e.paid_to, e.amount, e.expense_date, e.payment_method, e.reference_no, e.status, cb.full_name
          FROM expenses e LEFT JOIN users cb ON cb.id=e.created_by WHERE e.is_petty_topup) t ORDER BY entry_date DESC LIMIT 20000`);
    return { rows, columns: [
      { key: 'entry_date', label: 'Date', get: r => dmy(r.entry_date), csv: r => fmtDate(r.entry_date) }, { key: 'ref_no', label: 'Ref #' }, { key: 'source', label: 'For', width: 1.1 },
      { key: 'kind', label: 'Type', get: r => (r.kind === 'return' ? 'Returned' : r.kind === 'topup' ? 'Top-up' : 'Allotted') }, { key: 'holder', label: 'Given to', width: 1.4 },
      { key: 'payment_method', label: 'Method' }, { key: 'status', label: 'Status', get: r => statusText(r.status) }, { key: 'entered_by', label: 'Entered by', width: 1.2 }, { key: 'amount', label: 'Amount', money: true, total: false }],
      summary: [{ label: 'Given (approved)', value: pkr(sum(rows.filter(r => r.status === 'approved' && r.kind !== 'return'), 'amount')) }, { label: 'Returned', value: pkr(sum(rows.filter(r => r.status === 'approved' && r.kind === 'return'), 'amount')) }, { label: 'Waiting approval', value: pkr(sum(rows.filter(r => r.status === 'pending'), 'amount')), color: 'amber' }] };
  } },
  'payment-control': { perm: 'cashflow', title: 'Payment Control', async build(q, user) {
    const type = ['constant', 'variable'].includes(qstr(q.type)) ? qstr(q.type) : qstr(q.type) === 'all' ? '' : 'constant';
    const d = await DATASETS.expenses.build({ ...q, type }, user);
    return { ...d, title: 'Payment Control' };
  } },
  users: { perm: 'users', title: 'Users & Employees', async build() {
    const rows = await many(`SELECT u.employee_code, u.full_name, u.email, u.phone1, u.designation, u.role, u.status, u.created_at,
      COALESCE((SELECT string_agg(p.module || ':' || p.level, ', ') FROM permissions p WHERE p.user_id=u.id), '') AS access FROM users u ORDER BY u.employee_code`);
    return { rows, columns: [{ key: 'employee_code', label: 'Emp ID' }, { key: 'full_name', label: 'Name', width: 1.5 }, { key: 'email', label: 'Email', width: 2 }, { key: 'phone1', label: 'Phone', width: 1.2 }, { key: 'designation', label: 'Designation', width: 1.2 }, { key: 'role', label: 'Role', get: r => cap(r.role) }, { key: 'status', label: 'Status', get: r => cap(r.status) }, { key: 'access', label: 'Access', width: 2.2, get: r => ['admin', 'super_admin'].includes(r.role) ? 'Full access' : r.access }] };
  } },
  audit: { perm: 'admin', title: 'Activity Log', async build() {
    const rows = await many('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 2000');
    return { rows, columns: [{ key: 'created_at', label: 'Time', get: r => fmtDT(r.created_at), width: 1.4 }, { key: 'user_name', label: 'User', width: 1.3 }, { key: 'action', label: 'Action', width: 1.4 }, { key: 'entity', label: 'Record' }, { key: 'entity_id', label: 'ID', width: 0.6 }, { key: 'details', label: 'Details', width: 3, get: r => JSON.stringify(r.details) }] };
  } },
};

function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop Excel from treating text as a formula
  return /[",\r\n']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function companyInfo() {
  const row = await one(`SELECT value FROM app_settings WHERE key='owner_info'`).catch(() => null);
  const i = row?.value || {};
  return { name: i.company_name || undefined, tagline: 'Dreams to Degrees', contact: [i.address, i.phone, i.email].filter(Boolean).join('  |  ') || 'Lahore, Pakistan' };
}

const r = express.Router();
r.use(requireAuth);
r.get('/:dataset', ah(async (req, res) => {
  const ds = Object.prototype.hasOwnProperty.call(DATASETS, req.params.dataset) ? DATASETS[req.params.dataset] : null;
  if (!ds) throw bad('Unknown export.');
  const perms = ds.perm === null ? [] : Array.isArray(ds.perm) ? ds.perm : [ds.perm];
  if (perms.includes('admin') ? !isAdmin(req.user) : perms.length && !perms.some(p => can(req.user, p, 'view'))) throw forbidden();
  const format = req.query.format === 'pdf' ? 'pdf' : 'csv';
  const d = await ds.build(req.query, req.user);
  const title = d.title || ds.title;
  const subtitle = d.subtitle || (d.from ? `${dmy(d.from)} – ${dmy(d.to)}` : `As of ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`);
  const fname = `${title.replace(/[^\w]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
  await audit(null, req.user, 'export.' + format, 'export', req.params.dataset, { rows: d.rows.length });
  if (format === 'pdf') {
    // Big PDFs take too long on a 30-second serverless function — print the first 3,000 rows and say so.
    const MAX_PDF = 3000;
    const rows = d.rows.length > MAX_PDF ? d.rows.slice(0, MAX_PDF) : d.rows;
    const note = d.rows.length > MAX_PDF ? `Showing the first ${MAX_PDF.toLocaleString()} of ${d.rows.length.toLocaleString()} rows. Use CSV for the full list, or narrow the filters.` : d.note;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
    return tablePdf(res, { title, subtitle, columns: d.columns.filter(c => c.pdf !== false), rows, summary: d.summary || [], landscape: d.landscape, filters: d.filters || [], company: await companyInfo(), note });
  }
  // CSV: UTF-8 with BOM so Excel shows columns correctly; numbers stay numbers; TOTAL row for money columns.
  const val = (c, row) => (typeof c.get === 'function' ? c.get(row) : row[c.key]);
  d.columns = d.columns.filter(c => c.csv !== false);
  const lines = [d.columns.map(c => csvCell(c.label + (c.money ? ' (PKR)' : ''))).join(',')];
  for (const row of d.rows) {
    lines.push(d.columns.map(c => {
      const x = c.csv ? c.csv(row) : val(c, row);
      if (c.money) return x == null || x === '' ? '' : Number(x).toFixed(2);
      return csvCell(x instanceof Date ? x.toISOString().slice(0, 10) : x);
    }).join(','));
  }
  if (d.rows.length && d.columns.some(c => c.money && c.total !== false)) {
    lines.push(d.columns.map((c, i) => {
      if (c.money && c.total !== false) return (d.rows.reduce((a, row) => a + Math.round(Number(val(c, row) || 0) * 100), 0) / 100).toFixed(2);
      return i === 0 ? `TOTAL (${d.rows.length})` : '';
    }).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fname}.csv"`);
  res.send('\ufeff' + lines.join('\r\n') + '\r\n');
}));

export default r;
