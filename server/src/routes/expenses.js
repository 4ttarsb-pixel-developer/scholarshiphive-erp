// ═══════════════════════════════════════════════════════════════════════════
//  Expenses & Petty Cash (v2)
//  • Constant expenses: recurring templates → one cycle per period, approve / reject per cycle
//  • Variable expenses: daily / ad-hoc entries with receipt
//  • Petty cash: top-ups (+) and purchases (−), receipts verified by an approver
//  Every list is paged, sorted and filtered on the server (whitelisted sort keys,
//  parameterised SQL only). Approvals need admin or "Expense Approvals: edit".
// ═══════════════════════════════════════════════════════════════════════════
import express from 'express';
import { one, many, query, tx } from '../db.js';
import { ah, bad, forbidden, notFound, HttpError } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requirePerm, requireAdmin, requireApprover, rateLimit } from '../middleware/auth.js';
import { isAdmin, canApprove, can } from '../lib/permissions.js';
import { audit, diff } from '../lib/audit.js';
import { readCustom, saveCustom } from '../lib/forms.js';
import { upload, saveFile, txWithFiles } from '../lib/files.js';
import { sendMail, template, link, moduleEmails } from '../lib/email.js';
import { sum, sub, add, monthLabel, pkr, currentMonth, addMonths, today, monthBounds } from '../lib/money.js';
import { paging, Where, qstr, qid, likeText } from '../lib/paging.js';
import { METHODS } from './revenue.js';
import { liabilitySummary } from './liabilities.js';
import { walletBalance, lockWallet } from '../lib/budget.js';

export const TOPUP = 'Petty Cash Top-up';
export const EXPENSE_TYPES = ['constant', 'variable'];
export const FREQUENCIES = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
export const FREQUENCY_LABELS = { monthly: 'Monthly', quarterly: 'Quarterly (every 3 months)', half_yearly: 'Half-yearly (every 6 months)', yearly: 'Yearly' };
export const DEPARTMENTS = ['Head Office', 'Counselling', 'Admissions', 'Visa & Documentation', 'Marketing', 'Test Preparation (IELTS / PTE)', 'Accounts & Finance', 'HR & Administration', 'IT', 'Management', 'Branch Office'];
export const PETTY_MODES = ['Cash', 'JazzCash', 'EasyPaisa', 'Bank Transfer'];
const PETTY_DEFAULTS = { low_balance: 5000, max_entry: 25000, receipt_required_above: 2000 };
const DEFAULT_EXPENSE_OFFICES = ['Office 1', 'Office 2', 'Office 3', 'Office 4'];
const DB = { query };                               // pool as a "db" for helpers that also accept a transaction client

/** Office names are shared across all branches and stored in app_settings.
 * Keep the original four defaults and any location already used by an older recurring template.
 */
export async function loadExpenseOffices(db = DB) {
  const [settings, existing] = await Promise.all([
    db.query("SELECT value FROM app_settings WHERE key='expense_offices'"),
    db.query(`SELECT DISTINCT ON (lower(trim(location))) trim(location) AS name
                FROM recurring_expenses WHERE NULLIF(trim(location),'') IS NOT NULL
               ORDER BY lower(trim(location)), trim(location) LIMIT 50`),
  ]);
  const configured = Array.isArray(settings.rows?.[0]?.value) ? settings.rows[0].value : [];
  const names = [...DEFAULT_EXPENSE_OFFICES, ...configured, ...(existing.rows || []).map(row => row.name)]
    .map(x => String(x || '').trim()).filter(Boolean);
  return [...new Map(names.map(name => [name.toLocaleLowerCase(), name])).values()].slice(0, 50);
}

const bool = x => x === true || x === 1 || ['true', '1', 'on', 'yes'].includes(String(x ?? '').toLowerCase());
export const tomorrow = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const midx = m => { const [y, mo] = m.split('-').map(Number); return y * 12 + mo - 1; };
const lastDay = m => { const { next } = monthBounds(m); return new Date(new Date(next + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10); };
export const conflict = () => new HttpError(409, 'Someone else changed this record a moment ago. Close it, reload the list and try again.', { code: 'VERSION_CONFLICT' });

export function version(b) {
  if (b.version === undefined || b.version === null || b.version === '') throw bad('Record version is missing. Reload the page and try again.');
  return v.int(b.version, 'Version', { min: 1, max: 1e9 });
}

/** JSON / multipart array of numeric ids (max 200). */
export function idList(raw) {
  const list = v.json(raw, []);
  if (!Array.isArray(list) || !list.length) throw bad('Select at least one record.');
  if (list.length > 200) throw bad('You can update at most 200 records at once.');
  return [...new Set(list.map(x => v.id(x)))];
}

export const approverEmails = () => moduleEmails('expense_approve', 'edit');

// ═════════════ Categories ═════════════
export async function categoryTree(scope, { includeInactive = false } = {}) {
  const rows = await many(
    `SELECT id, scope, parent_id, name, description, allow_custom, is_system, is_active, sort_order
       FROM expense_categories WHERE ($1::text IS NULL OR scope = $1) ${includeInactive ? '' : 'AND is_active'}
      ORDER BY sort_order, lower(name)`, [scope || null]);
  const top = rows.filter(r => !r.parent_id).map(r => ({ ...r, subs: [] }));
  const byId = new Map(top.map(t => [t.id, t]));
  for (const r of rows) if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id).subs.push(r);
  return top;
}

/**
 * Validates category + expense item for a scope. "Other" → the typed name is used (and optionally saved as a new option).
 * body: category_id | category (name), sub_category_id ('other' allowed) | sub_category (name), sub_category_other, save_option
 */
async function resolveCategory(db, scope, b, user) {
  const q1 = (t, p) => db.query(t, p).then(r => r.rows[0]);
  let cat = null;
  if (b.category_id) cat = await q1('SELECT * FROM expense_categories WHERE id=$1 AND parent_id IS NULL', [v.id(b.category_id, 'Category')]);
  else if (b.category) cat = await q1('SELECT * FROM expense_categories WHERE scope=$1 AND parent_id IS NULL AND lower(name)=lower($2)', [scope, v.text(b.category, 'Category', { max: 120 })]);
  if (!cat) throw bad('Please select a category.');
  if (cat.scope !== scope) throw bad('This category does not belong to the selected expense type.');
  if (!cat.is_active) throw bad(`Category "${cat.name}" has been disabled by admin.`);

  const subRaw = b.sub_category_id === undefined || b.sub_category_id === null ? '' : String(b.sub_category_id).trim();
  if (subRaw && subRaw !== 'other') {
    const s = await q1('SELECT * FROM expense_categories WHERE id=$1', [v.id(subRaw, 'Expense item')]);
    if (!s || s.parent_id !== cat.id) throw bad('The selected expense item does not belong to this category.');
    if (!s.is_active) throw bad(`"${s.name}" has been disabled by admin. Choose another item.`);
    return { category_id: cat.id, category: cat.name, sub_category_id: s.id, sub_category: s.name };
  }
  const typed = v.text(b.sub_category_other || b.sub_category, 'Expense name', { max: 120 });
  if (!typed) {
    const hasSubs = await q1('SELECT 1 AS x FROM expense_categories WHERE parent_id=$1 AND is_active LIMIT 1', [cat.id]);
    if (hasSubs && !cat.allow_custom) throw bad('Please select the expense item (or choose "Other" and write it).');
    throw bad('Please write the expense name.');
  }
  if (typed.length < 2) throw bad('Expense name must be at least 2 letters.');
  // typed text that matches an existing option → link to it
  const same = await q1('SELECT * FROM expense_categories WHERE parent_id=$1 AND lower(name)=lower($2)', [cat.id, typed]);
  if (same?.is_active) return { category_id: cat.id, category: cat.name, sub_category_id: same.id, sub_category: same.name };
  let saved = null;
  if (bool(b.save_option) && !cat.allow_custom && !same) {
    const count = await q1('SELECT COUNT(*)::int AS n FROM expense_categories WHERE parent_id=$1', [cat.id]);
    if (count.n >= 60) throw bad('This category already has 60 items. Ask admin to tidy the list first.');
    saved = await q1(`INSERT INTO expense_categories(scope,parent_id,name,is_system,sort_order,created_by) VALUES ($1,$2,$3,FALSE,900,$4) RETURNING id, name`, [scope, cat.id, typed, user.id]);
    await audit(db, user, 'category.create', 'category', saved.id, { scope, parent: cat.name, name: typed, via: 'other-option' });
  }
  return { category_id: cat.id, category: cat.name, sub_category_id: saved?.id || null, sub_category: typed };
}

// ═════════════ Shared SQL ═════════════
export const EXP_SELECT = `
  SELECT e.id, e.ref_no, e.expense_type, e.title, e.category, e.category_id, e.sub_category, e.sub_category_id, e.location, e.amount,
         e.expense_date, e.due_date, e.paid_to, e.payment_method, e.reference_no, e.description, e.no_receipt_reason, e.receipt_file_id,
         e.status, e.is_petty_topup, e.recurring_id, e.cycle_month, e.review_note, e.reviewed_by, e.reviewed_at, e.created_by,
         e.created_at, e.updated_at, e.version, e.custom_fields,
         e.budget_holder_id, e.on_hold, e.hold_note, e.hold_until, e.held_at, bh.full_name AS budget_holder_name, hb.full_name AS held_by_name,
         u.full_name AS entered_by, rv.full_name AS reviewed_by_name,
         f.original_name AS receipt_name, f.mime AS receipt_mime, f.duplicate_of AS receipt_duplicate_of, f.verify_status AS receipt_status,
         rc.ref_no AS recurring_ref, rc.frequency AS recurring_frequency
    FROM expenses e
    LEFT JOIN users u ON u.id = e.created_by
    LEFT JOIN users rv ON rv.id = e.reviewed_by
    LEFT JOIN files f ON f.id = e.receipt_file_id
    LEFT JOIN recurring_expenses rc ON rc.id = e.recurring_id
    LEFT JOIN users bh ON bh.id = e.budget_holder_id
    LEFT JOIN users hb ON hb.id = e.held_by`;

export const EXP_SORTS = {
  date: 'e.expense_date', amount: 'e.amount', ref: 'e.ref_no', title: 'lower(e.title)', category: 'lower(e.category)', sub: 'lower(e.sub_category)',
  status: 'e.status', paid_to: 'lower(e.paid_to)', created: 'e.created_at', entered_by: 'lower(u.full_name)', location: 'lower(e.location)', method: 'e.payment_method',
};

/** Filters shared by list, analytics and exports. */
export function expenseWhere(q, user) {
  const w = new Where();
  const type = qstr(q.type);
  if (EXPENSE_TYPES.includes(type)) w.add('e.expense_type = ?', type);
  const month = qstr(q.month, 7);
  if (month && type === 'constant') w.add('e.cycle_month = ?', v.month(month));
  else if (month) { const m = v.month(month); w.add('(e.cycle_month = ? OR (e.cycle_month IS NULL AND e.expense_date BETWEEN ? AND ?))', m, `${m}-01`, lastDay(m)); }
  else if (qstr(q.all) !== '1') { const { from, to } = v.range(q); w.add('e.expense_date BETWEEN ? AND ?', from, to); }
  w.raw(qstr(q.topups) === '1' ? 'e.is_petty_topup' : 'NOT e.is_petty_topup');
  const status = qstr(q.status);
  if (['pending', 'approved', 'rejected'].includes(status)) w.add('e.status = ?', status);
  else if (status === 'hold') w.raw(`e.status = 'pending' AND e.on_hold`);
  else if (status === 'open') w.raw(`e.status = 'pending' AND NOT e.on_hold`);
  const hold = qstr(q.hold); if (hold === '1') w.raw('e.on_hold'); else if (hold === '0') w.raw('NOT e.on_hold');
  const budget = qstr(q.budget, 20);
  if (budget === '1') w.raw('e.budget_holder_id IS NOT NULL');
  else if (budget === '0') w.raw('e.budget_holder_id IS NULL');
  else if (qid(budget)) w.add('e.budget_holder_id = ?', qid(budget));
  const paidTo = qstr(q.paid_to, 160); if (paidTo) w.add('lower(e.paid_to) = lower(?)', paidTo);
  const cat = qid(q.category_id); if (cat) w.add('e.category_id = ?', cat);
  const sc = qid(q.sub_category_id);
  if (sc) w.add('e.sub_category_id = ?', sc);
  else if (qstr(q.sub_category)) w.add('lower(e.sub_category) = lower(?)', qstr(q.sub_category));
  const method = qstr(q.method, 40); if (method) w.add('e.payment_method = ?', method);
  const loc = qstr(q.location); if (loc) w.add('e.location = ?', loc);
  const rid = qid(q.recurring_id); if (rid) w.add('e.recurring_id = ?', rid);
  const by = qid(q.created_by); if (by) w.add('e.created_by = ?', by);
  if (qstr(q.mine) === '1') w.add('e.created_by = ?', user.id);
  if (qstr(q.receipt) === 'missing') w.raw('e.receipt_file_id IS NULL');
  if (qstr(q.receipt) === 'attached') w.raw('e.receipt_file_id IS NOT NULL');
  const min = qstr(q.min, 15), max = qstr(q.max, 15);
  if (min) w.add('e.amount >= ?', v.amount(min, 'Minimum amount', { allowZero: true }));
  if (max) w.add('e.amount <= ?', v.amount(max, 'Maximum amount', { allowZero: true }));
  const text = qstr(q.q, 80);
  if (text) {
    const p = likeText(text);
    w.add('(lower(e.title) LIKE ? OR lower(e.ref_no) LIKE ? OR lower(e.paid_to) LIKE ? OR lower(e.sub_category) LIKE ? OR lower(e.reference_no) LIKE ? OR lower(e.category) LIKE ?)', p, p, p, p, p, p);
  }
  return w;
}

export async function expenseTotals(w) {
  return one(`SELECT COUNT(*)::int AS count, COALESCE(SUM(e.amount),0)::numeric AS amount,
      COALESCE(SUM(e.amount) FILTER (WHERE e.status='approved'),0)::numeric AS approved,
      COALESCE(SUM(e.amount) FILTER (WHERE e.status='pending'),0)::numeric AS pending,
      COALESCE(SUM(e.amount) FILTER (WHERE e.status='rejected'),0)::numeric AS rejected,
      COUNT(*) FILTER (WHERE e.status='approved')::int AS approved_count,
      COUNT(*) FILTER (WHERE e.status='pending')::int AS pending_count,
      COUNT(*) FILTER (WHERE e.status='rejected')::int AS rejected_count,
      COALESCE(SUM(e.amount) FILTER (WHERE e.status='pending' AND e.on_hold),0)::numeric AS held,
      COUNT(*) FILTER (WHERE e.status='pending' AND e.on_hold)::int AS held_count,
      COALESCE(MAX(e.amount),0)::numeric AS largest
    FROM expenses e ${w.sql}`, w.params);
}

export async function listExpenses(q, user) {
  const w = expenseWhere(q, user);
  const totals = await expenseTotals(w);
  const pg = paging(q, { sorts: EXP_SORTS, defaultSort: 'date', tieBreaker: 'e.id DESC' });
  const pages = Math.max(1, Math.ceil(totals.count / pg.limit));
  const page = Math.min(pg.page, pages);
  const params = [...w.params, pg.limit, (page - 1) * pg.limit];
  const rows = await many(`${EXP_SELECT} ${w.sql} ORDER BY ${pg.order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { rows, total: totals.count, page, pages, limit: pg.limit, sort: pg.sort, dir: pg.dir, totals };
}

/** Rows for exports (no paging, capped). */
export async function exportExpenses(q, user, cap = 20000) {
  const w = expenseWhere(q, user);
  const pg = paging(q, { sorts: EXP_SORTS, defaultSort: 'date', tieBreaker: 'e.id DESC' });
  return many(`${EXP_SELECT} ${w.sql} ORDER BY ${pg.order} LIMIT ${Number(cap)}`, w.params);
}

/**
 * Salaries across the legacy ERP payroll and the integrated Workforce engine.
 * Legacy rows remain authoritative for an employee/month already booked there;
 * this prevents a transition-period double count while keeping all new payroll
 * visible in Expenses, exports, cash flow and finance reports.
 */
export async function salariesInRange(from, to) {
  const startMonth = from.slice(0, 7), endMonth = to.slice(0, 7);
  const [legacy, workforce] = await Promise.all([
    many(`SELECT pm.id, pm.month, pm.status, pm.snap_base AS base_salary, pm.snap_commission AS commission, pm.snap_commission_pct AS commission_pct, pm.snap_sales AS sales,
                 pm.bonus, pm.deductions, pm.snap_net AS net_salary, pm.slip_no, pm.paid_at, pm.payment_method,
                 u.id AS user_id, u.employee_code, u.full_name, u.designation, u.photo_file_id,
                 'legacy'::text AS source, NULL::text AS payment_reference
            FROM payroll_months pm JOIN users u ON u.id=pm.user_id
           WHERE pm.status IN ('approved','paid') AND pm.month >= $1 AND pm.month <= $2`, [startMonth, endMonth]),
    many(`SELECT ('wf:' || pr.id::text) AS id,
                 to_char(pp.period_month, 'YYYY-MM') AS month, lower(pr.status) AS status,
                 pr.base_salary, pr.commission_total AS commission, NULL::numeric AS commission_pct,
                 pr.revenue_total AS sales, pr.bonus_total AS bonus, pr.total_deductions AS deductions,
                 pr.net_salary, ('WF-' || to_char(pp.period_month, 'YYYYMM') || '-' || pr.id::text) AS slip_no,
                 COALESCE(pay.payment_date::timestamptz, pr.paid_at) AS paid_at,
                 pay.payment_method, e.id AS user_id, e.employee_code, e.full_name, e.designation,
                 NULL::bigint AS photo_file_id, 'workforce'::text AS source, pay.payment_reference
            FROM workforce.payroll_records pr
            JOIN workforce.payroll_periods pp ON pp.id=pr.period_id
            JOIN workforce.employees e ON e.id=pr.employee_id
            LEFT JOIN workforce.payment_records pay ON pay.payroll_record_id=pr.id
           WHERE pr.status IN ('Approved','Paid')
             AND pp.period_month >= ($1 || '-01')::date AND pp.period_month <= ($2 || '-01')::date
             AND NOT EXISTS (
               SELECT 1 FROM payroll_months legacy_pm
               JOIN users legacy_u ON legacy_u.id=legacy_pm.user_id
               WHERE legacy_pm.month=to_char(pp.period_month, 'YYYY-MM')
                 AND legacy_pm.status IN ('approved','paid')
                 AND upper(legacy_u.employee_code)=upper(e.employee_code)
             )`, [startMonth, endMonth]),
  ]);
  const rows = [...legacy.map(x => ({ ...x, source: 'legacy' })), ...workforce];
  return rows.sort((a, b) => String(b.month).localeCompare(String(a.month)) || String(a.employee_code || '').localeCompare(String(b.employee_code || '')));
}

export async function pettyBalance(db) {
  const q = db?.query ? (t, p) => db.query(t, p).then(x => x.rows[0]) : one;
  const t = await q(`SELECT COALESCE(SUM(amount),0)::numeric AS n FROM expenses WHERE is_petty_topup AND status='approved'`);
  const s = await q(`SELECT COALESCE(SUM(amount),0)::numeric AS n FROM petty_cash_entries WHERE status <> 'rejected'`);
  return { topups: t.n, spent: s.n, balance: sub(t.n, s.n) };
}

// ═════════════ Recurring (constant) helpers ═════════════
export function isDue(t, m) {
  if (m < t.start_month) return false;
  if (t.end_month && m > t.end_month) return false;
  return (midx(m) - midx(t.start_month)) % FREQUENCIES[t.frequency] === 0;
}
export function nextDue(t, from = currentMonth()) {
  if (t.state !== 'active' || t.status === 'rejected') return null;
  let m = from < t.start_month ? t.start_month : from;
  for (let i = 0; i < 13; i++) {
    if (t.end_month && m > t.end_month) return null;
    if (isDue(t, m)) return `${m}-${String(t.billing_day).padStart(2, '0')}`;
    m = addMonths(m, 1);
  }
  return null;
}
const perMonth = t => Math.round((Number(t.amount) / FREQUENCIES[t.frequency]) * 100) / 100;

/**
 * Creates the constant-expense cycle for every approved, active template that is due in each month
 * (only up to next month). Safe to call often: existing cycles and skipped months are never touched.
 */
export async function ensureCycles(months, { recurringId = null, recurringIds = null } = {}) {
  const limit = addMonths(currentMonth(), 1);
  const list = [...new Set(months)].filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m <= limit).sort().slice(-36);
  if (!list.length) return 0;
  return tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7702)'); // one generator at a time
    let created = 0;
    for (const m of list) {
      const [y, mo] = m.split('-').map(Number);
      const r = await db.query(`
        INSERT INTO expenses(ref_no, expense_type, title, category, category_id, sub_category, sub_category_id, location, amount, expense_date, due_date,
                             paid_to, payment_method, reference_no, description, status, recurring_id, cycle_month, created_by, reviewed_by, reviewed_at, review_note)
        SELECT 'EXP-' || lpad(nextval('expense_seq')::text, 5, '0'), 'constant', r.title, r.category, r.category_id, r.sub_category, r.sub_category_id, r.location,
               COALESCE(o.amount, r.amount), make_date($2, $3, r.billing_day), make_date($2, $3, r.billing_day),
               r.paid_to, r.payment_method, r.reference_no, r.description,
               CASE WHEN r.auto_approve THEN 'approved' ELSE 'pending' END, r.id, $1, r.created_by,
               CASE WHEN r.auto_approve THEN r.reviewed_by END, CASE WHEN r.auto_approve THEN NOW() END,
               CASE WHEN r.auto_approve THEN 'Auto-approved recurring cycle' END
          FROM recurring_expenses r
          LEFT JOIN recurring_overrides o ON o.recurring_id = r.id AND o.cycle_month = $1
         WHERE r.status = 'approved' AND r.state = 'active'
           AND r.start_month <= $1 AND (r.end_month IS NULL OR r.end_month >= $1)
           AND ($4::bigint IS NULL OR r.id = $4)
           AND ($6::bigint[] IS NULL OR r.id = ANY($6))
           AND MOD($5::int - ((substr(r.start_month,1,4)::int * 12) + substr(r.start_month,6,2)::int - 1),
                   CASE r.frequency WHEN 'quarterly' THEN 3 WHEN 'half_yearly' THEN 6 WHEN 'yearly' THEN 12 ELSE 1 END) = 0
           AND (o.action IS NULL OR o.action <> 'skip')
           AND NOT EXISTS (SELECT 1 FROM expenses x WHERE x.recurring_id = r.id AND x.cycle_month = $1)
        ON CONFLICT DO NOTHING RETURNING id`, [m, y, mo, recurringId, midx(m), recurringIds]);
      created += r.rowCount;
    }
    if (created) await audit(db, null, 'recurring.generate', 'recurring', recurringId, { months: list, created });
    return created;
  });
}

const REC_SELECT = `
  SELECT r.*, u.full_name AS entered_by, rv.full_name AS reviewed_by_name,
         (SELECT COUNT(*)::int FROM expenses x WHERE x.recurring_id = r.id) AS cycles,
         (SELECT COUNT(*)::int FROM expenses x WHERE x.recurring_id = r.id AND x.status = 'pending') AS pending_cycles,
         (SELECT x.status FROM expenses x WHERE x.recurring_id = r.id ORDER BY x.cycle_month DESC LIMIT 1) AS last_cycle_status,
         (SELECT x.cycle_month FROM expenses x WHERE x.recurring_id = r.id ORDER BY x.cycle_month DESC LIMIT 1) AS last_cycle_month
    FROM recurring_expenses r
    LEFT JOIN users u ON u.id = r.created_by
    LEFT JOIN users rv ON rv.id = r.reviewed_by`;
const REC_SORTS = { title: 'lower(r.title)', amount: 'r.amount', category: 'lower(r.category)', start: 'r.start_month', status: 'r.status', state: 'r.state', created: 'r.created_at', ref: 'r.ref_no', day: 'r.billing_day' };

export function recurringWhere(q) {
  const w = new Where();
  const status = qstr(q.status); if (['pending', 'approved', 'rejected'].includes(status)) w.add('r.status = ?', status);
  const state = qstr(q.state); if (['active', 'paused', 'ended'].includes(state)) w.add('r.state = ?', state);
  const freq = qstr(q.frequency); if (FREQUENCIES[freq]) w.add('r.frequency = ?', freq);
  const cat = qid(q.category_id); if (cat) w.add('r.category_id = ?', cat);
  const office = qstr(q.office, 120); if (office) w.add('r.location = ?', office);
  const text = qstr(q.q, 80);
  if (text) { const p = likeText(text); w.add('(lower(r.title) LIKE ? OR lower(r.ref_no) LIKE ? OR lower(r.paid_to) LIKE ? OR lower(r.sub_category) LIKE ?)', p, p, p, p); }
  return w;
}
const decorateRec = r => ({ ...r, next_due: nextDue(r), per_month: perMonth(r), frequency_label: FREQUENCY_LABELS[r.frequency] });

function reminderChannels(raw) {
  const list = Array.isArray(raw) ? raw : v.json(raw, []);
  if (!Array.isArray(list)) throw bad('Reminder channels are not valid.');
  return [...new Set(list.map(String))].filter(x => ['app', 'email', 'whatsapp'].includes(x));
}

async function recurringFields(db, b, user, cur) {
  const cat = await resolveCategory(db, 'constant', b, user);
  const f = {
    ...cat,
    title: v.text(b.title, 'Title', { max: 160 }) || cat.sub_category || cat.category,
    amount: v.amount(b.amount, 'Amount (PKR)'),
    frequency: v.oneOf(b.frequency || 'monthly', Object.keys(FREQUENCIES), 'Frequency'),
    billing_day: v.int(b.billing_day ?? '1', 'Due day of the month', { min: 1, max: 28 }),
    start_month: v.month(b.start_month || currentMonth(), 'Start month'),
    end_month: b.end_month ? v.month(b.end_month, 'End month') : null,
    paid_to: v.text(b.paid_to, 'Paid to / vendor', { required: true, max: 160 }),
    payment_method: v.oneOf(b.payment_method || 'Bank Transfer', METHODS, 'Payment method'),
    location: v.text(b.location, 'Office', { max: 120 }),
    reference_no: v.text(b.reference_no, 'Account / reference no.', { max: 80 }),
    description: v.text(b.description, 'Description', { max: 1000 }),
    reminder_days: b.reminder_days !== undefined && b.reminder_days !== '' ? v.int(b.reminder_days, 'Reminder days', { min: 0, max: 30 }) : cur?.reminder_days ?? 3,
    reminder_channels: b.reminder_channels !== undefined ? reminderChannels(b.reminder_channels) : cur?.reminder_channels || ['app', 'email'],
    auto_approve: canApprove(user) ? bool(b.auto_approve) : Boolean(cur?.auto_approve),
  };
  const offices = await loadExpenseOffices(db);
  if (!offices.includes(f.location)) throw bad('Select an office configured by an admin for this recurring expense.');
  if (f.title.length < 3) throw bad('Title must be at least 3 characters.');
  if (f.end_month && f.end_month < f.start_month) throw bad('End month cannot be before the start month.');
  if (f.start_month < addMonths(currentMonth(), -24)) throw bad('Start month can be at most 24 months in the past.');
  if (f.start_month > addMonths(currentMonth(), 24)) throw bad('Start month can be at most 24 months in the future.');
  return f;
}

/** All due months from the template start up to the current month (max 24) — used when a template is approved. */
const backfillMonths = t => {
  const out = [];
  let m = t.start_month < addMonths(currentMonth(), -23) ? addMonths(currentMonth(), -23) : t.start_month;
  while (m <= currentMonth()) { if (isDue(t, m)) out.push(m); m = addMonths(m, 1); }
  return out;
};

// ═════════════════════════════════ Expenses router ═════════════════════════════════
const r = express.Router();
r.use(requireAuth);
const writeLimit = rateLimit('expense-write', 120, 60 * 1000);

r.get('/meta', ah(async (req, res) => {
  const pettySettings = await getPettySettings();
  res.json({
    types: [{ value: 'constant', label: 'Constant (fixed, every month)' }, { value: 'variable', label: 'Variable (daily / ad-hoc)' }],
    categories: {
      constant: await categoryTree('constant'),
      variable: await categoryTree('variable'),
      petty: await categoryTree('petty'),
    },
    methods: METHODS, departments: DEPARTMENTS, pettyModes: PETTY_MODES, offices: await loadExpenseOffices(),
    frequencies: Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({ value, label })),
    canApprove: canApprove(req.user), isAdmin: isAdmin(req.user), pettySettings,
  });
}));

// Office / branch names are centrally managed so recurring expenses can be tracked per location.
r.post('/offices', writeLimit, requireAdmin, ah(async (req, res) => {
  const name = v.text(req.body.name, 'Office name', { required: true, min: 2, max: 120 });
  const offices = await tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7704)');
    const current = await loadExpenseOffices(db);
    if (current.some(x => x.toLocaleLowerCase() === name.toLocaleLowerCase())) throw bad('This office / branch already exists.');
    if (current.length >= 50) throw bad('You can configure up to 50 offices.');
    const next = [...current, name];
    await db.query(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES ('expense_offices',$1,$2,NOW())
                    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, [JSON.stringify(next), req.user.id]);
    return next;
  });
  await audit(null, req.user, 'expense.office.create', 'settings', 'expense_offices', { name });
  res.status(201).json({ ok: true, offices });
}));

r.use(requirePerm('expenses', 'view'));

// ── Category management (admin) ──
r.get('/categories', ah(async (req, res) => {
  const scope = qstr(req.query.scope);
  res.json(await categoryTree(['constant', 'variable', 'petty'].includes(scope) ? scope : null, { includeInactive: isAdmin(req.user) }));
}));

r.post('/categories', requireAdmin, ah(async (req, res) => {
  const scope = v.oneOf(req.body.scope, ['constant', 'variable', 'petty'], 'Type');
  const parent = req.body.parent_id ? await one('SELECT * FROM expense_categories WHERE id=$1 AND parent_id IS NULL', [v.id(req.body.parent_id, 'Parent category')]) : null;
  if (req.body.parent_id && !parent) throw bad('Parent category not found.');
  if (parent && parent.scope !== scope) throw bad('Parent category belongs to another type.');
  const name = v.text(req.body.name, 'Name', { required: true, min: 2, max: parent ? 120 : 60 });
  const row = await one(`INSERT INTO expense_categories(scope,parent_id,name,description,allow_custom,sort_order,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [scope, parent?.id || null, name, v.text(req.body.description, 'Description', { max: 300 }), parent ? false : bool(req.body.allow_custom), parent ? 800 : 500, req.user.id]);
  await audit(null, req.user, 'category.create', 'category', row.id, { scope, parent: parent?.name || null, name });
  res.status(201).json(row);
}));

r.put('/categories/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM expense_categories WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound('Category not found.');
  const name = v.text(req.body.name ?? cur.name, 'Name', { required: true, min: 2, max: cur.parent_id ? 120 : 60 });
  const is_active = req.body.is_active === undefined ? cur.is_active : bool(req.body.is_active);
  const sort_order = req.body.sort_order === undefined ? cur.sort_order : v.int(req.body.sort_order, 'Order', { min: 0, max: 100000 });
  const description = req.body.description === undefined ? cur.description : v.text(req.body.description, 'Description', { max: 300 });
  await tx(async db => {
    await db.query('UPDATE expense_categories SET name=$1, is_active=$2, sort_order=$3, description=$4, updated_at=NOW() WHERE id=$5', [name, is_active, sort_order, description, cur.id]);
    if (name !== cur.name) {   // keep name snapshots in sync for readable reports
      const col = cur.parent_id ? 'sub_category' : 'category';
      const key = cur.parent_id ? 'sub_category_id' : 'category_id';
      for (const t of ['expenses', 'recurring_expenses', 'petty_cash_entries']) await db.query(`UPDATE ${t} SET ${col}=$1 WHERE ${key}=$2`, [name, cur.id]);
    }
    await audit(db, req.user, 'category.update', 'category', cur.id, diff(cur, { name, is_active, sort_order, description }, ['name', 'is_active', 'sort_order', 'description']));
  });
  res.json({ ok: true });
}));

r.delete('/categories/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM expense_categories WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound('Category not found.');
  if (cur.is_system) throw bad('Built-in categories cannot be deleted — switch them off instead.');
  const used = await one(`SELECT (SELECT COUNT(*) FROM expenses WHERE category_id=$1 OR sub_category_id=$1) + (SELECT COUNT(*) FROM petty_cash_entries WHERE category_id=$1 OR sub_category_id=$1)
                          + (SELECT COUNT(*) FROM recurring_expenses WHERE category_id=$1 OR sub_category_id=$1) AS n`, [cur.id]);
  if (Number(used.n) > 0) throw bad('This category is used by saved records — switch it off instead of deleting.');
  await query('DELETE FROM expense_categories WHERE id=$1', [cur.id]);
  await audit(null, req.user, 'category.delete', 'category', cur.id, { name: cur.name, scope: cur.scope });
  res.json({ ok: true });
}));

// ── Overview ──
r.get('/summary', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  await ensureCycles([currentMonth()]).catch(e => console.error('[cycles]', e.message));
  const rows = await many(`SELECT expense_type, category, category_id, sub_category, amount, status, is_petty_topup, location FROM expenses WHERE expense_date BETWEEN $1 AND $2`, [from, to]);
  const marketingRows = await many(`SELECT c.name AS category, sc.name AS sub_category, e.amount_pkr AS amount, e.status, e.occurred_on AS expense_date FROM marketing.expenses e JOIN marketing.subcategories sc ON sc.id=e.subcategory_id JOIN marketing.categories c ON c.id=sc.category_id WHERE e.occurred_on BETWEEN $1 AND $2`, [from, to]);
  const marketingApproved = marketingRows.filter(x => x.status === 'Approved');
  const real = rows.filter(x => !x.is_petty_topup);
  const approved = real.filter(x => x.status === 'approved');
  const salaries = await salariesInRange(from, to);
  const loans = await liabilitySummary(from, to);
  const pettyTopups = sum(rows.filter(x => x.is_petty_topup && x.status === 'approved'), 'amount');
  const pettySpent = Number((await one(`SELECT COALESCE(SUM(amount),0)::numeric AS n FROM petty_cash_entries WHERE status <> 'rejected' AND entry_date BETWEEN $1 AND $2`, [from, to])).n);
  const constant = sum(approved.filter(x => x.expense_type === 'constant'), 'amount');
  const variable = sum(approved.filter(x => x.expense_type === 'variable'), 'amount');
  const marketingTotal = sum(marketingApproved, 'amount');
  const operating = add(constant, variable, marketingTotal);
  const salaryTotal = sum(salaries, 'net_salary');
  const group = (list, key) => {
    const m = new Map();
    for (const x of list) { const k = x[key] || '—'; m.set(k, add(m.get(k) || 0, x.amount)); }
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  const byCat = new Map();
  for (const e of [...approved, ...marketingApproved.map(x => ({ ...x, expense_type: 'marketing', category_id: null }))]) {
    const k = `${e.expense_type}:${e.category}`;
    const c = byCat.get(k) || { name: e.category, type: e.expense_type, id: e.category_id, value: 0 };
    c.value = add(c.value, e.amount); byCat.set(k, c);
  }
  // 12-month trend ending at "to"
  const end = to.slice(0, 7), start = addMonths(end, -11);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
  const t1 = await many(`SELECT to_char(expense_date,'YYYY-MM') AS m, expense_type AS t, SUM(amount)::numeric AS n FROM expenses
                          WHERE status='approved' AND NOT is_petty_topup AND expense_date >= $1 AND expense_date <= $2 GROUP BY 1,2`, [`${start}-01`, lastDay(end)]);
  const tm = await many(`SELECT to_char(occurred_on,'YYYY-MM') AS m, SUM(amount_pkr)::numeric AS n FROM marketing.expenses WHERE status='Approved' AND occurred_on >= $1 AND occurred_on <= $2 GROUP BY 1`, [`${start}-01`, lastDay(end)]);
  const t2 = await many(`SELECT to_char(entry_date,'YYYY-MM') AS m, SUM(amount)::numeric AS n FROM petty_cash_entries WHERE status <> 'rejected' AND entry_date >= $1 AND entry_date <= $2 GROUP BY 1`, [`${start}-01`, lastDay(end)]);
  const [t3, t4] = await Promise.all([
    many(`SELECT month AS m, SUM(snap_net)::numeric AS n FROM payroll_months WHERE status IN ('approved','paid') AND month >= $1 AND month <= $2 GROUP BY 1`, [start, end]),
    many(`SELECT to_char(pp.period_month,'YYYY-MM') AS m, SUM(pr.net_salary)::numeric AS n
            FROM workforce.payroll_records pr JOIN workforce.payroll_periods pp ON pp.id=pr.period_id
            JOIN workforce.employees e ON e.id=pr.employee_id
           WHERE pr.status IN ('Approved','Paid') AND pp.period_month >= ($1 || '-01')::date AND pp.period_month <= ($2 || '-01')::date
             AND NOT EXISTS (SELECT 1 FROM payroll_months pm JOIN users u ON u.id=pm.user_id
                              WHERE pm.month=to_char(pp.period_month,'YYYY-MM') AND pm.status IN ('approved','paid')
                                AND upper(u.employee_code)=upper(e.employee_code))
           GROUP BY 1`, [start, end]),
  ]);
  const monthly = months.map(m => {
    const c = Number(t1.find(x => x.m === m && x.t === 'constant')?.n || 0), va = Number(t1.find(x => x.m === m && x.t === 'variable')?.n || 0), mk = Number(tm.find(x => x.m === m)?.n || 0);
    const p = Number(t2.find(x => x.m === m)?.n || 0), s = add(Number(t3.find(x => x.m === m)?.n || 0), Number(t4.find(x => x.m === m)?.n || 0));
    return { month: m, constant: c, variable: va, marketing: mk, petty: p, salaries: s, total: add(c, va, mk, p, s) };
  });
  const rec = await one(`SELECT COUNT(*) FILTER (WHERE status='approved' AND state='active')::int AS active, COUNT(*) FILTER (WHERE status='pending')::int AS pending,
                          COALESCE(SUM(CASE frequency WHEN 'quarterly' THEN amount/3 WHEN 'half_yearly' THEN amount/6 WHEN 'yearly' THEN amount/12 ELSE amount END)
                                   FILTER (WHERE status='approved' AND state='active'),0)::numeric(14,2) AS per_month FROM recurring_expenses`);
  const pend = real.filter(x => x.status === 'pending');
  res.json({
    range: { from, to },
    constant, variable, marketing: marketingTotal, operating,
    salaries: salaryTotal, salariesPaid: sum(salaries.filter(s => s.status === 'paid'), 'net_salary'),
    pettyTopups, pettySpent, loanPayments: loans.paidInRange,
    total: add(operating, salaryTotal, pettySpent, loans.paidInRange),
    pending: { count: pend.length, amount: sum(pend, 'amount'), constant: pend.filter(x => x.expense_type === 'constant').length, variable: pend.filter(x => x.expense_type === 'variable').length },
    rejected: sum(real.filter(x => x.status === 'rejected'), 'amount'),
    recurring: rec,
    byCategory: [...byCat.values()].map(c => ({ name: c.name, value: c.value, type: c.type, id: c.id }))
      .concat(salaryTotal ? [{ name: 'Salaries (Salary & Workforce)', value: salaryTotal, type: 'salary' }] : [], pettySpent ? [{ name: 'Petty Cash (spent)', value: pettySpent, type: 'petty' }] : [], loans.paidInRange ? [{ name: 'Loan repayments', value: loans.paidInRange, type: 'loan' }] : [])
      .sort((a, b) => b.value - a.value),
    byDepartment: group(approved, 'location').slice(0, 8),
    bySubCategory: group(approved.map(x => ({ ...x, sub_category: x.sub_category || x.category })), 'sub_category').slice(0, 10),
    monthly,
  });
}));

// ── Charts for the Constant / Variable tabs (same filters as the table) ──
r.get('/analytics', ah(async (req, res) => {
  const kw = expenseWhere(req.query, req.user);
  const kpi = await expenseTotals(kw);
  const w = expenseWhere(req.query, req.user);
  if (!qstr(req.query.status)) w.raw(`e.status <> 'rejected'`);
  const byCategory = await many(`SELECT e.category_id AS id, e.category AS name, SUM(e.amount)::numeric AS value, COUNT(*)::int AS n FROM expenses e ${w.sql} GROUP BY 1,2 ORDER BY value DESC LIMIT 20`, w.params);
  const bySub = await many(`SELECT e.sub_category_id AS id, COALESCE(NULLIF(e.sub_category,''), e.category) AS name, e.category, SUM(e.amount)::numeric AS value, COUNT(*)::int AS n
                              FROM expenses e ${w.sql} GROUP BY 1,2,3 ORDER BY value DESC LIMIT 10`, w.params);
  const byMethod = await many(`SELECT e.payment_method AS name, SUM(e.amount)::numeric AS value FROM expenses e ${w.sql} GROUP BY 1 ORDER BY value DESC`, w.params);
  const byLocation = await many(`SELECT COALESCE(NULLIF(e.location,''),'Not set') AS name, SUM(e.amount)::numeric AS value FROM expenses e ${w.sql} GROUP BY 1 ORDER BY value DESC LIMIT 8`, w.params);
  let daily = Boolean(qstr(req.query.month));
  if (!daily && qstr(req.query.all) !== '1') { const { from, to } = v.range(req.query); daily = (new Date(to) - new Date(from)) / 86400000 <= 62; }
  const keyExpr = daily ? `to_char(e.expense_date,'YYYY-MM-DD')` : `to_char(e.expense_date,'YYYY-MM')`;
  const trend = await many(`SELECT ${keyExpr} AS key, COALESCE(SUM(e.amount) FILTER (WHERE e.status='approved'),0)::numeric AS approved,
                                   COALESCE(SUM(e.amount) FILTER (WHERE e.status='pending'),0)::numeric AS pending, COUNT(*)::int AS n
                              FROM expenses e ${w.sql} GROUP BY 1 ORDER BY 1`, w.params);
  res.json({ kpi: { ...kpi, average: kpi.count ? Math.round((Number(kpi.amount) / kpi.count) * 100) / 100 : 0 }, byCategory, bySub, byMethod, byLocation, trend, granularity: daily ? 'day' : 'month' });
}));

r.get('/salaries', requirePerm('salary', 'view'), ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  const rows = await salariesInRange(from, to);
  res.json({ rows: rows.map(x => ({ ...x, month_label: monthLabel(x.month) })), total: sum(rows, 'net_salary'), paid: sum(rows.filter(x => x.status === 'paid'), 'net_salary'), approvedUnpaid: sum(rows.filter(x => x.status === 'approved'), 'net_salary') });
}));

r.get('/loans', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  res.json(await liabilitySummary(from, to));
}));

// ── Approval queue (everything waiting, one screen) ──
r.get('/approvals', requireApprover, ah(async (req, res) => {
  await ensureCycles([currentMonth()]).catch(() => {});
  // non-admin approvers never see their own entries here (segregation of duties)
  const me = [isAdmin(req.user) ? null : req.user.id];
  const variable = await many(`${EXP_SELECT} WHERE e.status='pending' AND e.expense_type='variable' AND NOT e.is_petty_topup AND ($1::bigint IS NULL OR e.created_by IS DISTINCT FROM $1)
                               ORDER BY e.expense_date DESC, e.id DESC LIMIT 100`, me);
  const cycles = await many(`${EXP_SELECT} WHERE e.status='pending' AND e.expense_type='constant' AND ($1::bigint IS NULL OR e.created_by IS DISTINCT FROM $1)
                             ORDER BY e.cycle_month DESC NULLS LAST, e.expense_date DESC LIMIT 100`, me);
  const templates = (await many(`${REC_SELECT} WHERE r.status='pending' AND ($1::bigint IS NULL OR r.created_by IS DISTINCT FROM $1) ORDER BY r.created_at DESC LIMIT 100`, me)).map(decorateRec);
  const out = { variable, cycles, templates, petty: [], topups: [] };
  if (can(req.user, 'petty_cash', 'view')) {
    out.petty = await many(`${PETTY_SELECT} WHERE p.status='pending' AND ($1::bigint IS NULL OR p.created_by IS DISTINCT FROM $1) ORDER BY p.entry_date DESC, p.id DESC LIMIT 100`, me);
    out.topups = await many(`${EXP_SELECT} WHERE e.status='pending' AND e.is_petty_topup AND ($1::bigint IS NULL OR e.created_by IS DISTINCT FROM $1) ORDER BY e.expense_date DESC LIMIT 100`, me);
  }
  out.counts = Object.fromEntries(Object.entries(out).map(([k, list]) => [k, list.length]));
  res.json(out);
}));

// ═════════════ Constant expenses: templates ═════════════
r.get('/recurring/switches', ah(async (req, res) => {
  const office = v.text(req.query.office, 'Office', { required: true, max: 120 });
  const rows = await many(`${REC_SELECT} WHERE r.location=$1 AND r.status <> 'rejected' ORDER BY lower(r.category), lower(r.sub_category), lower(r.title), r.created_at DESC`, [office]);
  res.json({ office, rows: rows.map(decorateRec) });
}));

r.get('/recurring', ah(async (req, res) => {
  const w = recurringWhere(req.query);
  const t = await one(`SELECT COUNT(*)::int AS count,
      COALESCE(SUM(CASE r.frequency WHEN 'quarterly' THEN r.amount/3 WHEN 'half_yearly' THEN r.amount/6 WHEN 'yearly' THEN r.amount/12 ELSE r.amount END)
               FILTER (WHERE r.status='approved' AND r.state='active'),0)::numeric(14,2) AS per_month,
      COUNT(*) FILTER (WHERE r.status='approved' AND r.state='active')::int AS active,
      COUNT(*) FILTER (WHERE r.status='pending')::int AS pending,
      COUNT(*) FILTER (WHERE r.state='paused')::int AS paused
    FROM recurring_expenses r ${w.sql}`, w.params);
  const pg = paging(req.query, { sorts: REC_SORTS, defaultSort: 'created', tieBreaker: 'r.id DESC' });
  const pages = Math.max(1, Math.ceil(t.count / pg.limit));
  const page = Math.min(pg.page, pages);
  const params = [...w.params, pg.limit, (page - 1) * pg.limit];
  const rows = (await many(`${REC_SELECT} ${w.sql} ORDER BY ${pg.order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).map(decorateRec);
  res.json({ rows, total: t.count, page, pages, limit: pg.limit, sort: pg.sort, dir: pg.dir, totals: t });
}));

r.get('/recurring/upcoming', ah(async (req, res) => {
  const n = Math.min(12, Math.max(1, parseInt(qstr(req.query.months, 2), 10) || 6));
  const months = Array.from({ length: n }, (_, i) => addMonths(currentMonth(), i));
  const templates = await many(`SELECT * FROM recurring_expenses WHERE status <> 'rejected' AND state = 'active'`);
  const overrides = await many(`SELECT * FROM recurring_overrides WHERE cycle_month >= $1`, [months[0]]);
  const made = await many(`SELECT id, recurring_id, cycle_month, status, amount FROM expenses WHERE recurring_id IS NOT NULL AND cycle_month >= $1`, [months[0]]);
  const out = months.map(m => {
    const items = [];
    for (const t of templates) {
      if (!isDue(t, m)) continue;
      const o = overrides.find(x => x.recurring_id === t.id && x.cycle_month === m);
      const e = made.find(x => x.recurring_id === t.id && x.cycle_month === m);
      items.push({
        recurring_id: t.id, ref_no: t.ref_no, title: t.title, category: t.category, sub_category: t.sub_category, template_status: t.status,
        amount: e ? e.amount : o?.action === 'amount' ? o.amount : t.amount, base_amount: t.amount,
        skipped: !e && o?.action === 'skip', override: o ? { action: o.action, amount: o.amount, note: o.note } : null,
        cycle: e ? { id: e.id, status: e.status } : null, due_date: `${m}-${String(t.billing_day).padStart(2, '0')}`,
      });
    }
    const counted = items.filter(i => !i.skipped && i.template_status === 'approved' && i.cycle?.status !== 'rejected');
    return { month: m, label: monthLabel(m), items: items.sort((a, b) => a.due_date.localeCompare(b.due_date)), total: sum(counted, 'amount'), count: counted.length };
  });
  res.json({ months: out });
}));

r.get('/recurring/:id', ah(async (req, res) => {
  const row = await one(`${REC_SELECT} WHERE r.id=$1`, [v.id(req.params.id)]);
  if (!row) throw notFound();
  const cycles = await many(`${EXP_SELECT} WHERE e.recurring_id=$1 ORDER BY e.cycle_month DESC LIMIT 36`, [row.id]);
  const overrides = await many('SELECT * FROM recurring_overrides WHERE recurring_id=$1 ORDER BY cycle_month', [row.id]);
  res.json({ ...decorateRec(row), cycles, overrides, history: await history('recurring', row.id, req.user) });
}));

r.post('/recurring/bulk', writeLimit, requirePerm('expenses', 'edit'), ah(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) throw bad('Add at least one constant expense.');
  if (items.length > 50) throw bad('You can set up at most 50 constant expenses at once.');
  const status = isAdmin(req.user) ? 'approved' : 'pending';
  const rows = await tx(async db => {
    const created = [];
    for (let i = 0; i < items.length; i++) {
      const f = await recurringFields(db, items[i] || {}, req.user);
      const ref = (await db.query(`SELECT 'CE-' || lpad(nextval('recurring_seq')::text, 5, '0') AS n`)).rows[0].n;
      const row = (await db.query(`INSERT INTO recurring_expenses(ref_no,title,category_id,sub_category_id,category,sub_category,amount,frequency,billing_day,start_month,end_month,
                                   paid_to,payment_method,location,reference_no,description,reminder_days,reminder_channels,auto_approve,status,reviewed_by,reviewed_at,created_by,updated_by)
                                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23) RETURNING *`,
        [ref, f.title, f.category_id, f.sub_category_id, f.category, f.sub_category, f.amount, f.frequency, f.billing_day, f.start_month, f.end_month,
          f.paid_to, f.payment_method, f.location, f.reference_no, f.description, f.reminder_days, f.reminder_channels, f.auto_approve, status,
          status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null, req.user.id])).rows[0];
      await audit(db, req.user, 'recurring.create', 'recurring', row.id, { ref, amount: f.amount, category: f.category, item: f.sub_category, frequency: f.frequency, status, bulk: true });
      created.push(row);
    }
    return created;
  });
  const ids = rows.map(r => r.id);
  let generated = 0;
  if (status === 'approved') {
    const months = [...new Set(rows.flatMap(backfillMonths))];
    generated = await ensureCycles(months, { recurringIds: ids });
  } else {
    const summary = rows.slice(0, 12).map(r => `${r.title} — ${pkr(r.amount)} ${FREQUENCY_LABELS[r.frequency].toLowerCase()}`);
    sendMail(await approverEmails(), `${rows.length} constant expenses waiting for approval`, template({ title: 'New constant expenses need approval', greeting: `Hello, ${req.user.full_name} set up ${rows.length} recurring expense(s).`, lines: [...summary, ...(rows.length > 12 ? [`And ${rows.length - 12} more…`] : [])], action: { label: 'Review expenses', url: link('/expenses/approvals') } }));
  }
  res.status(201).json({ count: rows.length, status, generated, rows: rows.map(decorateRec) });
}));

r.post('/recurring', writeLimit, requirePerm('expenses', 'edit'), ah(async (req, res) => {
  const status = isAdmin(req.user) ? 'approved' : 'pending';
  const row = await tx(async db => {
    const f = await recurringFields(db, req.body, req.user);
    const ref = (await db.query(`SELECT 'CE-' || lpad(nextval('recurring_seq')::text, 5, '0') AS n`)).rows[0].n;
    const t = (await db.query(`INSERT INTO recurring_expenses(ref_no,title,category_id,sub_category_id,category,sub_category,amount,frequency,billing_day,start_month,end_month,
                                 paid_to,payment_method,location,reference_no,description,reminder_days,reminder_channels,auto_approve,status,reviewed_by,reviewed_at,created_by,updated_by)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23) RETURNING *`,
      [ref, f.title, f.category_id, f.sub_category_id, f.category, f.sub_category, f.amount, f.frequency, f.billing_day, f.start_month, f.end_month,
        f.paid_to, f.payment_method, f.location, f.reference_no, f.description, f.reminder_days, f.reminder_channels, f.auto_approve, status,
        status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null, req.user.id])).rows[0];
    await audit(db, req.user, 'recurring.create', 'recurring', t.id, { ref, amount: f.amount, category: f.category, item: f.sub_category, frequency: f.frequency, status });
    return t;
  });
  let generated = 0;
  if (row.status === 'approved') generated = await ensureCycles(backfillMonths(row), { recurringId: row.id });
  else sendMail(await approverEmails(), `Constant expense waiting for approval: ${row.ref_no}`, template({ title: 'New constant (monthly) expense needs approval', lines: [`${req.user.full_name} added "${row.title}" — ${pkr(row.amount)} ${FREQUENCY_LABELS[row.frequency].toLowerCase()} (${row.category}).`], action: { label: 'Review', url: link('/expenses/approvals') } }));
  res.status(201).json({ ...decorateRec(row), generated });
}));

r.put('/recurring/:id', writeLimit, requirePerm('expenses', 'edit'), ah(async (req, res) => {
  const cur = await one('SELECT * FROM recurring_expenses WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  if (!isAdmin(req.user) && (cur.status !== 'pending' || cur.created_by !== req.user.id)) throw forbidden('Only your own pending constant expenses can be edited. Ask admin for changes.');
  const ver = version(req.body);
  const out = await tx(async db => {
    const f = await recurringFields(db, req.body, req.user, cur);
    const u = await db.query(`UPDATE recurring_expenses SET title=$1,category_id=$2,sub_category_id=$3,category=$4,sub_category=$5,amount=$6,frequency=$7,billing_day=$8,start_month=$9,end_month=$10,
                                paid_to=$11,payment_method=$12,location=$13,reference_no=$14,description=$15,reminder_days=$16,reminder_channels=$17,auto_approve=$18,version=version+1,updated_by=$19,updated_at=NOW()
                              WHERE id=$20 AND version=$21 RETURNING *`,
      [f.title, f.category_id, f.sub_category_id, f.category, f.sub_category, f.amount, f.frequency, f.billing_day, f.start_month, f.end_month,
        f.paid_to, f.payment_method, f.location, f.reference_no, f.description, f.reminder_days, f.reminder_channels, f.auto_approve, req.user.id, cur.id, ver]);
    if (!u.rowCount) throw conflict();
    // pending cycles from this month onwards follow the new details (approved / rejected cycles never change)
    const upd = await db.query(`UPDATE expenses SET title=$1, category_id=$2, sub_category_id=$3, category=$4, sub_category=$5, paid_to=$6, payment_method=$7, location=$8,
                                  reference_no=$9, description=$10, expense_date=make_date(substr(cycle_month,1,4)::int, substr(cycle_month,6,2)::int, $11),
                                  due_date=make_date(substr(cycle_month,1,4)::int, substr(cycle_month,6,2)::int, $11),
                                  amount=COALESCE((SELECT o.amount FROM recurring_overrides o WHERE o.recurring_id=$12 AND o.cycle_month=expenses.cycle_month AND o.action='amount'), $13),
                                  version=version+1, updated_by=$14, updated_at=NOW()
                                WHERE recurring_id=$12 AND status='pending' AND cycle_month >= $15`,
      [f.title, f.category_id, f.sub_category_id, f.category, f.sub_category, f.paid_to, f.payment_method, f.location, f.reference_no, f.description, f.billing_day, cur.id, f.amount, req.user.id, currentMonth()]);
    await audit(db, req.user, 'recurring.update', 'recurring', cur.id, { changes: diff(cur, f, ['title', 'category', 'sub_category', 'amount', 'frequency', 'billing_day', 'start_month', 'end_month', 'paid_to', 'payment_method', 'location', 'reference_no', 'reminder_days', 'reminder_channels', 'auto_approve']), cyclesUpdated: upd.rowCount });
    return { row: u.rows[0], cyclesUpdated: upd.rowCount };
  });
  let generated = 0;
  if (out.row.status === 'approved' && out.row.state === 'active') generated = await ensureCycles(backfillMonths(out.row), { recurringId: out.row.id });
  res.json({ ...decorateRec(out.row), cyclesUpdated: out.cyclesUpdated, generated });
}));

r.post('/recurring/:id/review', requireApprover, ah(async (req, res) => {
  const cur = await one('SELECT r.*, u.email, u.full_name AS creator FROM recurring_expenses r LEFT JOIN users u ON u.id=r.created_by WHERE r.id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  if (!isAdmin(req.user) && cur.created_by === req.user.id) throw forbidden('You cannot approve your own entry. Another approver must review it.');
  const status = v.oneOf(req.body.status, ['approved', 'rejected', 'pending'], 'Status');
  const note = v.text(req.body.note, 'Note', { max: 500 }) || null;
  if (status === 'rejected' && !note) throw bad('Please write the reason for rejecting.');
  await query('UPDATE recurring_expenses SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=NOW(), version=version+1, updated_at=NOW() WHERE id=$4', [status, note, req.user.id, cur.id]);
  await audit(null, req.user, 'recurring.review', 'recurring', cur.id, { from: cur.status, to: status, note });
  let generated = 0;
  if (status === 'approved' && cur.state === 'active') generated = await ensureCycles(backfillMonths(cur), { recurringId: cur.id });
  if (cur.email && cur.created_by !== req.user.id) sendMail(cur.email, `Constant expense ${cur.ref_no} ${status}`, template({ title: `Your constant expense was ${status}`, greeting: `Hi ${cur.creator},`, lines: [`${cur.title} — ${pkr(cur.amount)} ${FREQUENCY_LABELS[cur.frequency].toLowerCase()}`, note ? `Note: ${note}` : ''].filter(Boolean), action: { label: 'Open constant expenses', url: link('/expenses/constant') } }));
  res.json({ ok: true, generated });
}));

r.post('/recurring/:id/state', requireApprover, ah(async (req, res) => {
  const cur = await one('SELECT * FROM recurring_expenses WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const state = v.oneOf(req.body.state, ['active', 'paused', 'ended'], 'State');
  if (state === cur.state) throw bad(`This constant expense is already ${state}.`);
  const now = currentMonth();
  const out = await tx(async db => {
    let end = cur.end_month, pausedFrom = cur.paused_from, removed = 0;
    if (state === 'ended') {
      end = cur.start_month > now ? cur.start_month : now;
      removed = (await db.query(`DELETE FROM expenses WHERE recurring_id=$1 AND status='pending' AND cycle_month > $2`, [cur.id, end])).rowCount;
    }
    if (state === 'paused') {
      pausedFrom = now;
      removed = (await db.query(`DELETE FROM expenses WHERE recurring_id=$1 AND status='pending' AND cycle_month > $2`, [cur.id, now])).rowCount;
    }
    if (state === 'active') {
      if (cur.state === 'ended') end = null;
      // months that passed while paused stay skipped (they are not created later)
      if (cur.state === 'paused' && cur.paused_from) {
        for (let m = addMonths(cur.paused_from, 1); m < now; m = addMonths(m, 1)) {
          await db.query(`INSERT INTO recurring_overrides(recurring_id,cycle_month,action,note,created_by) SELECT $1,$2,'skip','Paused',$3
                           WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE recurring_id=$1 AND cycle_month=$2) ON CONFLICT DO NOTHING`, [cur.id, m, req.user.id]);
        }
      }
      pausedFrom = null;
    }
    await db.query('UPDATE recurring_expenses SET state=$1, end_month=$2, paused_from=$3, version=version+1, updated_by=$4, updated_at=NOW() WHERE id=$5', [state, end, pausedFrom, req.user.id, cur.id]);
    await audit(db, req.user, 'recurring.state', 'recurring', cur.id, { from: cur.state, to: state, removedPendingCycles: removed });
    return { removed };
  });
  if (state === 'active' && cur.status === 'approved') await ensureCycles([now], { recurringId: cur.id });
  res.json({ ok: true, ...out });
}));

r.post('/recurring/:id/override', requireApprover, ah(async (req, res) => {
  const cur = await one('SELECT * FROM recurring_expenses WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const month = v.month(req.body.month, 'Month');
  if (month < currentMonth()) throw bad('Only this month or future months can be changed.');
  if (!isDue(cur, month)) throw bad(`${cur.title} is not due in ${monthLabel(month)}.`);
  const action = v.oneOf(req.body.action, ['skip', 'amount', 'clear'], 'Action');
  const amount = action === 'amount' ? v.amount(req.body.amount, 'Amount for this month') : null;
  const note = v.text(req.body.note, 'Note', { max: 300 });
  await tx(async db => {
    const cyc = (await db.query('SELECT * FROM expenses WHERE recurring_id=$1 AND cycle_month=$2', [cur.id, month])).rows[0];
    if (cyc && cyc.status !== 'pending') throw bad(`The ${monthLabel(month)} cycle is already ${cyc.status}. Open that cycle to change it.`);
    if (action === 'clear') await db.query('DELETE FROM recurring_overrides WHERE recurring_id=$1 AND cycle_month=$2', [cur.id, month]);
    else await db.query(`INSERT INTO recurring_overrides(recurring_id,cycle_month,action,amount,note,created_by) VALUES ($1,$2,$3,$4,$5,$6)
                         ON CONFLICT (recurring_id,cycle_month) DO UPDATE SET action=EXCLUDED.action, amount=EXCLUDED.amount, note=EXCLUDED.note, created_by=EXCLUDED.created_by, created_at=NOW()`,
      [cur.id, month, action, amount, note, req.user.id]);
    if (cyc && action === 'skip') await db.query('DELETE FROM expenses WHERE id=$1', [cyc.id]);
    if (cyc && action === 'amount') await db.query('UPDATE expenses SET amount=$1, version=version+1, updated_by=$2, updated_at=NOW() WHERE id=$3', [amount, req.user.id, cyc.id]);
    if (cyc && action === 'clear') await db.query('UPDATE expenses SET amount=$1, version=version+1, updated_by=$2, updated_at=NOW() WHERE id=$3', [cur.amount, req.user.id, cyc.id]);
    await audit(db, req.user, 'recurring.override', 'recurring', cur.id, { month, action, amount, note });
  });
  if (action === 'clear') await ensureCycles([month], { recurringId: cur.id });
  res.json({ ok: true });
}));

r.delete('/recurring/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM recurring_expenses WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const done = await one(`SELECT COUNT(*)::int AS n FROM expenses WHERE recurring_id=$1 AND status <> 'pending'`, [cur.id]);
  if (done.n) throw bad(`This constant expense already has ${done.n} approved / rejected cycle(s) in the books. Use "End" instead of deleting.`);
  await tx(async db => {
    await db.query('DELETE FROM expenses WHERE recurring_id=$1', [cur.id]);
    await db.query('DELETE FROM recurring_expenses WHERE id=$1', [cur.id]);
    await audit(db, req.user, 'recurring.delete', 'recurring', cur.id, { snapshot: cur });
  });
  res.json({ ok: true });
}));

// ═════════════ Constant expenses: monthly cycles ═════════════
r.get('/cycles', ah(async (req, res) => {
  const month = v.month(qstr(req.query.month, 7) || currentMonth(), 'Month');
  await ensureCycles([month]).catch(e => console.error('[cycles]', e.message));
  const list = await listExpenses({ ...req.query, type: 'constant', month }, req.user);
  const due = await one(`SELECT COUNT(*)::int AS n FROM recurring_expenses WHERE status='approved' AND state='active' AND start_month <= $1 AND (end_month IS NULL OR end_month >= $1)`, [month]);
  res.json({ ...list, month, label: monthLabel(month), activeTemplates: due.n });
}));

r.post('/cycles/generate', requirePerm('expenses', 'edit'), ah(async (req, res) => {
  const month = v.month(req.body.month || currentMonth(), 'Month');
  const created = await ensureCycles([month]);
  res.json({ ok: true, created });
}));

// ═════════════ Expense list / detail / create / edit / review ═════════════
r.get('/', ah(async (req, res) => res.json(await listExpenses(req.query, req.user))));

export async function history(entity, id, user) {
  const rows = await many(`SELECT id, user_name, action, details, ip, created_at FROM audit_log WHERE entity=$1 AND entity_id=$2 ORDER BY created_at, id LIMIT 200`, [entity, String(id)]);
  return isAdmin(user) ? rows : rows.map(({ ip: _ip, ...x }) => x);
}

r.post('/review/bulk', requireApprover, ah(async (req, res) => {
  const ids = idList(req.body.ids);
  const status = v.oneOf(req.body.status, ['approved', 'rejected', 'pending'], 'Status');
  const note = v.text(req.body.note, 'Note', { max: 500 }) || null;
  if (status === 'rejected' && !note) throw bad('Please write the reason for rejecting.');
  const result = await tx(async db => {
    const rows = (await db.query(`SELECT e.*, u.email, u.full_name AS creator FROM expenses e LEFT JOIN users u ON u.id=e.created_by WHERE e.id = ANY($1::bigint[]) FOR UPDATE OF e`, [ids])).rows;
    const skipped = [];
    const ok = [];
    for (const e of rows) {
      if (e.is_petty_topup) skipped.push({ id: e.id, ref: e.ref_no, reason: 'Petty cash top-ups are reviewed in Petty Cash' });
      else if (!isAdmin(req.user) && e.created_by === req.user.id) skipped.push({ id: e.id, ref: e.ref_no, reason: 'You cannot approve your own entry' });
      else if (e.status === status) skipped.push({ id: e.id, ref: e.ref_no, reason: `Already ${status}` });
      else ok.push(e);
    }
    for (const id of ids) if (!rows.find(x => x.id === id)) skipped.push({ id, reason: 'Not found' });
    if (ok.length) {
      await db.query(`UPDATE expenses SET status=$1::text, review_note=$2, reviewed_by=$3, reviewed_at=NOW(), version=version+1,
                        on_hold = CASE WHEN $1::text = 'pending' THEN on_hold ELSE FALSE END WHERE id = ANY($4::bigint[])`, [status, note, req.user.id, ok.map(x => x.id)]);
      await db.query(`UPDATE files SET verify_status=$1, verified_by=$2, verified_at=NOW() WHERE id = ANY($3::bigint[])`, [status === 'approved' ? 'verified' : status === 'rejected' ? 'rejected' : 'unverified', req.user.id, ok.map(x => x.receipt_file_id).filter(Boolean)]);
      for (const e of ok) await audit(db, req.user, 'expense.review', 'expense', e.id, { from: e.status, to: status, note, bulk: true });
    }
    return { ok, skipped };
  });
  const byCreator = new Map();
  for (const e of result.ok) if (e.email && e.created_by !== req.user.id) byCreator.set(e.email, [...(byCreator.get(e.email) || []), e]);
  for (const [email, list] of byCreator) {
    sendMail(email, `${list.length} expense(s) ${status}`, template({ title: `Expenses ${status}`, greeting: `Hi ${list[0].creator},`, lines: [...list.slice(0, 15).map(e => `${e.ref_no} · ${e.title} — ${pkr(e.amount)}`), note ? `Note: ${note}` : ''].filter(Boolean), action: { label: 'Open expenses', url: link('/expenses') } }));
  }
  res.json({ updated: result.ok.length, skipped: result.skipped });
}));

r.get('/:id', ah(async (req, res) => {
  const row = await one(`${EXP_SELECT} WHERE e.id=$1`, [v.id(req.params.id)]);
  if (!row) throw notFound();
  res.json({ ...row, history: await history('expense', row.id, req.user) });
}));

export async function variableFields(db, b, user) {
  const cat = await resolveCategory(db, 'variable', b, user);
  const f = {
    ...cat,
    title: v.text(b.title, 'Title', { max: 160 }) || cat.sub_category || cat.category,
    amount: v.amount(b.amount, 'Amount (PKR)'),
    expense_date: v.date(b.expense_date, 'Expense date'),
    paid_to: v.text(b.paid_to, 'Paid to / vendor', { required: true, max: 160 }),
    payment_method: v.oneOf(b.payment_method || 'Cash', METHODS, 'Payment method'),
    location: v.text(b.location, 'Department / branch', { max: 120 }),
    reference_no: v.text(b.reference_no, 'Bill / invoice no.', { max: 80 }),
    description: v.text(b.description, 'Description', { max: 1000 }),
    no_receipt_reason: v.text(b.no_receipt_reason, 'Reason for no receipt', { max: 300 }) || null,
  };
  if (f.title.length < 3) throw bad('Title must be at least 3 characters.');
  if (f.expense_date > tomorrow()) throw bad('Expense date cannot be in the future.');
  return f;
}

async function cycleFields(db, b, user, cur) {
  const cat = await resolveCategory(db, 'constant', b, user);
  const f = {
    ...cat,
    title: v.text(b.title, 'Title', { max: 160 }) || cat.sub_category || cat.category,
    amount: v.amount(b.amount, 'Amount (PKR)'),
    expense_date: v.date(b.expense_date || cur.expense_date, 'Due date'),
    paid_to: v.text(b.paid_to, 'Paid to / vendor', { required: true, max: 160 }),
    payment_method: v.oneOf(b.payment_method || 'Bank Transfer', METHODS, 'Payment method'),
    location: v.text(b.location, 'Department / branch', { max: 120 }),
    reference_no: v.text(b.reference_no, 'Bill / reference no.', { max: 80 }),
    description: v.text(b.description, 'Description', { max: 1000 }),
    no_receipt_reason: cur.no_receipt_reason,
  };
  if (f.title.length < 3) throw bad('Title must be at least 3 characters.');
  if (cur.cycle_month && f.expense_date.slice(0, 7) !== cur.cycle_month) throw bad(`Due date must be inside ${monthLabel(cur.cycle_month)}.`);
  return f;
}

r.post('/', writeLimit, requirePerm('expenses', 'edit'), upload.single('receipt'), ah(async (req, res) => {
  const type = v.oneOf(req.body.expense_type || 'variable', EXPENSE_TYPES, 'Expense type');
  if (type === 'constant') throw bad('Constant (monthly) expenses are added once as a recurring expense — use “Add constant expense”.');
  const status = isAdmin(req.user) ? 'approved' : 'pending';
  const row = await txWithFiles(async db => {
    const f = await variableFields(db, req.body, req.user);
    if (!req.file && (!f.no_receipt_reason || f.no_receipt_reason.length < 5)) throw bad('Please attach the receipt / invoice, or tick “No receipt” and write the reason.');
    const receipt = req.file ? await saveFile(db, req.file, 'expense_receipt', req.user.id) : null;
    const ref = (await db.query(`SELECT 'EXP-' || lpad(nextval('expense_seq')::text, 5, '0') AS n`)).rows[0].n;
    const e = (await db.query(`INSERT INTO expenses(ref_no,expense_type,title,category,category_id,sub_category,sub_category_id,location,amount,expense_date,paid_to,payment_method,
                                 reference_no,description,no_receipt_reason,receipt_file_id,status,is_petty_topup,created_by,updated_by,reviewed_by,reviewed_at)
                               VALUES ($1,'variable',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,FALSE,$17,$17,$18,$19) RETURNING *`,
      [ref, f.title, f.category, f.category_id, f.sub_category, f.sub_category_id, f.location, f.amount, f.expense_date, f.paid_to, f.payment_method,
        f.reference_no, f.description, receipt ? null : f.no_receipt_reason, receipt?.id || null, status, req.user.id,
        status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null])).rows[0];
    await saveCustom(db, 'expenses', e.id, await readCustom('expenses', req.body.custom_fields));
    await audit(db, req.user, 'expense.create', 'expense', e.id, { ref, type: 'variable', amount: f.amount, category: f.category, item: f.sub_category, status });
    return { ...e, duplicate_receipt: Boolean(receipt?.duplicate_of) };
  });
  if (status === 'pending') {
    sendMail(await approverEmails(), `Expense waiting for approval: ${row.ref_no}`, template({ title: 'New expense needs approval', lines: [`${req.user.full_name} added "${row.title}" — ${pkr(row.amount)} (${row.category}${row.sub_category ? ' › ' + row.sub_category : ''}).`, row.duplicate_receipt ? 'Warning: this receipt file was uploaded before (possible duplicate).' : '', row.receipt_file_id ? '' : `No receipt: ${row.no_receipt_reason}`].filter(Boolean), action: { label: 'Review expenses', url: link('/expenses/approvals') } }));
  }
  res.status(201).json(row);
}));

const EDIT_KEYS = ['title', 'category', 'sub_category', 'amount', 'expense_date', 'paid_to', 'payment_method', 'location', 'reference_no', 'description'];

r.put('/:id', writeLimit, requirePerm('expenses', 'edit'), upload.single('receipt'), ah(async (req, res) => {
  const cur = await one('SELECT * FROM expenses WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  if (cur.is_petty_topup) throw bad('Petty cash top-ups are changed in Petty Cash → Top-ups.');
  // "Expenses: edit" = full access → can correct any employee's entry that is not approved yet. Approved entries: admin only.
  if (!isAdmin(req.user) && cur.status !== 'pending') throw forbidden('Approved / rejected expenses can only be changed by admin.');
  const ver = version(req.body);
  await txWithFiles(async db => {
    const f = cur.expense_type === 'constant' ? await cycleFields(db, req.body, req.user, cur) : await variableFields(db, req.body, req.user);
    if (cur.budget_holder_id && cur.status !== 'rejected' && f.amount > Number(cur.amount)) {
      await lockWallet(db, cur.budget_holder_id);
      const bal = await walletBalance(db, cur.budget_holder_id);
      if (sub(f.amount, cur.amount) > bal.balance) throw bad(`Not enough budget left for the new amount. Available: ${pkr(add(bal.balance, cur.amount))}.`);
    }
    if (cur.expense_type === 'variable' && !req.file && !cur.receipt_file_id && (!f.no_receipt_reason || f.no_receipt_reason.length < 5)) throw bad('Please attach the receipt / invoice, or write why there is no receipt.');
    const receipt = req.file ? await saveFile(db, req.file, 'expense_receipt', req.user.id) : null;
    const u = await db.query(`UPDATE expenses SET title=$1,category=$2,category_id=$3,sub_category=$4,sub_category_id=$5,location=$6,amount=$7,expense_date=$8,
                                due_date=CASE WHEN expense_type='constant' THEN $8::date ELSE due_date END,paid_to=$9,payment_method=$10,reference_no=$11,description=$12,
                                no_receipt_reason=CASE WHEN COALESCE($13::bigint, receipt_file_id) IS NULL THEN $14 ELSE NULL END,
                                receipt_file_id=COALESCE($13,receipt_file_id), version=version+1, updated_by=$15, updated_at=NOW()
                              WHERE id=$16 AND version=$17`,
      [f.title, f.category, f.category_id, f.sub_category, f.sub_category_id, f.location, f.amount, f.expense_date, f.paid_to, f.payment_method, f.reference_no, f.description,
        receipt?.id || null, f.no_receipt_reason, req.user.id, cur.id, ver]);
    if (!u.rowCount) throw conflict();
    if (req.body.custom_fields !== undefined) await saveCustom(db, 'expenses', cur.id, await readCustom('expenses', req.body.custom_fields, { existing: cur.custom_fields }));
    await audit(db, req.user, 'expense.update', 'expense', cur.id, { changes: diff(cur, f, EDIT_KEYS), receipt: receipt ? 'replaced' : undefined });
  });
  res.json(await one(`${EXP_SELECT} WHERE e.id=$1`, [cur.id]));
}));

r.post('/:id/review', requireApprover, ah(async (req, res) => {
  const cur = await one('SELECT e.*, u.email, u.full_name AS creator FROM expenses e LEFT JOIN users u ON u.id=e.created_by WHERE e.id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  if (cur.is_petty_topup) throw bad('Petty cash top-ups are reviewed in Petty Cash → Top-ups.');
  if (!isAdmin(req.user) && cur.created_by === req.user.id) throw forbidden('You cannot approve your own entry. Another approver must review it.');
  const status = v.oneOf(req.body.status, ['approved', 'rejected', 'pending'], 'Status');
  const note = v.text(req.body.note, 'Note', { max: 500 }) || null;
  if (status === 'rejected' && !note) throw bad('Please write the reason for rejecting.');
  const u = await query(`UPDATE expenses SET status=$1::text, review_note=$2, reviewed_by=$3, reviewed_at=NOW(), version=version+1,
                           on_hold = CASE WHEN $1::text = 'pending' THEN on_hold ELSE FALSE END WHERE id=$4 AND status=$5`, [status, note, req.user.id, cur.id, cur.status]);
  if (!u.rowCount) throw conflict();
  if (cur.receipt_file_id && status !== 'pending') await query(`UPDATE files SET verify_status=$1, verified_by=$2, verified_at=NOW() WHERE id=$3`, [status === 'approved' ? 'verified' : 'rejected', req.user.id, cur.receipt_file_id]);
  await audit(null, req.user, 'expense.review', 'expense', cur.id, { from: cur.status, to: status, note });
  if (cur.email && cur.created_by !== req.user.id) sendMail(cur.email, `Expense ${cur.ref_no} ${status}`, template({ title: `Your expense was ${status}`, greeting: `Hi ${cur.creator},`, lines: [`${cur.title} — ${pkr(cur.amount)}`, note ? `Note: ${note}` : ''].filter(Boolean), action: { label: 'Open expenses', url: link('/expenses') } }));
  res.json({ ok: true });
}));

r.delete('/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM expenses WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  if (cur.is_petty_topup) throw bad('Delete petty cash top-ups from Petty Cash → Top-ups.');
  await tx(async db => {
    // deleting a generated cycle must not bring it back on the next refresh
    if (cur.recurring_id && cur.cycle_month) {
      await db.query(`INSERT INTO recurring_overrides(recurring_id,cycle_month,action,note,created_by) VALUES ($1,$2,'skip','Cycle deleted',$3)
                      ON CONFLICT (recurring_id,cycle_month) DO UPDATE SET action='skip', amount=NULL, note='Cycle deleted'`, [cur.recurring_id, cur.cycle_month, req.user.id]);
    }
    await db.query('DELETE FROM expenses WHERE id=$1', [cur.id]);
    await audit(db, req.user, 'expense.delete', 'expense', cur.id, { snapshot: { ...cur, receipt_file_id: cur.receipt_file_id } });
  });
  res.json({ ok: true });
}));

export default r;

// ═════════════════════════════════ Petty cash router (separate permission) ═════════════════════════════════
export const petty = express.Router();
petty.use(requireAuth, requirePerm('petty_cash', 'view'));

export async function getPettySettings() {
  const row = await one(`SELECT value FROM app_settings WHERE key='petty_cash'`);
  return { ...PETTY_DEFAULTS, ...(row?.value || {}) };
}

const PETTY_SELECT = `
  SELECT p.id, p.ref_no, p.title, p.category, p.category_id, p.sub_category, p.sub_category_id, p.amount, p.entry_date, p.purchased_by, p.vendor,
         p.payment_mode, p.location, p.related_to, p.description, p.no_receipt_reason, p.receipt_file_id, p.status, p.review_note, p.reviewed_by, p.reviewed_at,
         p.created_by, p.created_at, p.updated_at, p.version, p.custom_fields,
         u.full_name AS entered_by, rv.full_name AS reviewed_by_name, f.original_name AS receipt_name, f.mime AS receipt_mime, f.duplicate_of AS receipt_duplicate_of
    FROM petty_cash_entries p
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN users rv ON rv.id = p.reviewed_by
    LEFT JOIN files f ON f.id = p.receipt_file_id`;
const PETTY_SORTS = { date: 'p.entry_date', amount: 'p.amount', ref: 'p.ref_no', title: 'lower(p.title)', category: 'lower(p.category)', sub: 'lower(p.sub_category)', status: 'p.status', buyer: 'lower(p.purchased_by)', created: 'p.created_at', mode: 'p.payment_mode' };

export function pettyWhere(q, user) {
  const w = new Where();
  if (qstr(q.all) !== '1') { const { from, to } = v.range(q); w.add('p.entry_date BETWEEN ? AND ?', from, to); }
  const status = qstr(q.status); if (['pending', 'verified', 'rejected'].includes(status)) w.add('p.status = ?', status);
  const cat = qid(q.category_id); if (cat) w.add('p.category_id = ?', cat);
  const sc = qid(q.sub_category_id); if (sc) w.add('p.sub_category_id = ?', sc);
  else if (qstr(q.sub_category)) w.add('lower(p.sub_category) = lower(?)', qstr(q.sub_category));
  const mode = qstr(q.mode, 40); if (mode) w.add('p.payment_mode = ?', mode);
  const loc = qstr(q.location); if (loc) w.add('p.location = ?', loc);
  const buyer = qstr(q.purchased_by); if (buyer) w.add('lower(p.purchased_by) = lower(?)', buyer);
  const by = qid(q.created_by); if (by) w.add('p.created_by = ?', by);
  if (qstr(q.mine) === '1') w.add('p.created_by = ?', user.id);
  if (qstr(q.receipt) === 'missing') w.raw('p.receipt_file_id IS NULL');
  if (qstr(q.receipt) === 'attached') w.raw('p.receipt_file_id IS NOT NULL');
  const text = qstr(q.q, 80);
  if (text) { const p = likeText(text); w.add('(lower(p.title) LIKE ? OR lower(p.ref_no) LIKE ? OR lower(p.purchased_by) LIKE ? OR lower(p.vendor) LIKE ? OR lower(p.sub_category) LIKE ? OR lower(p.related_to) LIKE ?)', p, p, p, p, p, p); }
  return w;
}

async function pettyTotals(w) {
  return one(`SELECT COUNT(*)::int AS count, COALESCE(SUM(p.amount),0)::numeric AS amount,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status <> 'rejected'),0)::numeric AS spent,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status='verified'),0)::numeric AS verified,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status='pending'),0)::numeric AS pending,
      COALESCE(SUM(p.amount) FILTER (WHERE p.status='rejected'),0)::numeric AS rejected,
      COUNT(*) FILTER (WHERE p.status='verified')::int AS verified_count, COUNT(*) FILTER (WHERE p.status='pending')::int AS pending_count,
      COUNT(*) FILTER (WHERE p.status='rejected')::int AS rejected_count, COUNT(*) FILTER (WHERE p.receipt_file_id IS NULL)::int AS no_receipt_count
    FROM petty_cash_entries p ${w.sql}`, w.params);
}

export async function exportPetty(q, user, cap = 20000) {
  const w = pettyWhere(q, user);
  const pg = paging(q, { sorts: PETTY_SORTS, defaultSort: 'date', tieBreaker: 'p.id DESC' });
  return many(`${PETTY_SELECT} ${w.sql} ORDER BY ${pg.order} LIMIT ${Number(cap)}`, w.params);
}

petty.get('/settings', ah(async (_req, res) => res.json(await getPettySettings())));
petty.put('/settings', requireAdmin, ah(async (req, res) => {
  const s = {
    low_balance: v.amount(req.body.low_balance ?? 0, 'Low balance alert', { allowZero: true }),
    max_entry: v.amount(req.body.max_entry ?? 0, 'Maximum single entry', { allowZero: true }),
    receipt_required_above: v.amount(req.body.receipt_required_above ?? 0, 'Receipt required above', { allowZero: true }),
  };
  await query(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES ('petty_cash',$1,$2,NOW())
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, [JSON.stringify(s), req.user.id]);
  await audit(null, req.user, 'petty.settings', 'settings', 'petty_cash', s);
  res.json(s);
}));

petty.get('/summary', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  const bal = await pettyBalance();
  const settings = await getPettySettings();
  const w = pettyWhere({ from, to }, req.user);
  const totals = await pettyTotals(w);
  const live = `${w.sql} AND p.status <> 'rejected'`;
  const byCategory = await many(`SELECT p.category_id AS id, p.category AS name, SUM(p.amount)::numeric AS value, COUNT(*)::int AS n FROM petty_cash_entries p ${live} GROUP BY 1,2 ORDER BY value DESC`, w.params);
  const bySub = await many(`SELECT p.sub_category_id AS id, COALESCE(NULLIF(p.sub_category,''), p.category) AS name, p.category, SUM(p.amount)::numeric AS value, COUNT(*)::int AS n
                              FROM petty_cash_entries p ${live} GROUP BY 1,2,3 ORDER BY value DESC LIMIT 10`, w.params);
  const byBuyer = await many(`SELECT p.purchased_by AS name, SUM(p.amount)::numeric AS value, COUNT(*)::int AS n FROM petty_cash_entries p ${live} GROUP BY 1 ORDER BY value DESC LIMIT 8`, w.params);
  const byMode = await many(`SELECT p.payment_mode AS name, SUM(p.amount)::numeric AS value FROM petty_cash_entries p ${live} GROUP BY 1 ORDER BY value DESC`, w.params);
  const daily = (new Date(to) - new Date(from)) / 86400000 <= 62;
  const k = daily ? `to_char(p.entry_date,'YYYY-MM-DD')` : `to_char(p.entry_date,'YYYY-MM')`;
  const spend = await many(`SELECT ${k} AS key, SUM(p.amount)::numeric AS spent FROM petty_cash_entries p ${live} GROUP BY 1 ORDER BY 1`, w.params);
  const tk = daily ? `to_char(expense_date,'YYYY-MM-DD')` : `to_char(expense_date,'YYYY-MM')`;
  const tops = await many(`SELECT ${tk} AS key, SUM(amount)::numeric AS topup FROM expenses WHERE is_petty_topup AND status='approved' AND expense_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [from, to]);
  const keys = [...new Set([...spend.map(x => x.key), ...tops.map(x => x.key)])].sort();
  const trend = keys.map(key => ({ key, spent: Number(spend.find(x => x.key === key)?.spent || 0), topup: Number(tops.find(x => x.key === key)?.topup || 0) }));
  const periodTopups = Number((await one(`SELECT COALESCE(SUM(amount),0)::numeric AS n FROM expenses WHERE is_petty_topup AND status='approved' AND expense_date BETWEEN $1 AND $2`, [from, to])).n);
  const pendingTopups = await one(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::numeric AS amount FROM expenses WHERE is_petty_topup AND status='pending'`);
  const opening = Number((await one(`SELECT (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE is_petty_topup AND status='approved' AND expense_date < $1)
                                         - (SELECT COALESCE(SUM(amount),0) FROM petty_cash_entries WHERE status <> 'rejected' AND entry_date < $1) AS n`, [from])).n);
  const days = Math.max(1, Math.round((Math.min(Date.now(), new Date(to + 'T23:59:59').getTime()) - new Date(from + 'T00:00:00').getTime()) / 86400000) + 1);
  res.json({
    ...bal, range: { from, to }, settings, lowBalance: settings.low_balance > 0 && bal.balance <= settings.low_balance,
    periodTopups, periodSpent: Number(totals.spent), opening, closing: sub(add(opening, periodTopups), totals.spent),
    pending: totals.pending_count, verified: totals.verified_count, rejected: totals.rejected_count, noReceipt: totals.no_receipt_count, totals,
    pendingTopups, avgPerDay: Math.round((Number(totals.spent) / days) * 100) / 100,
    byCategory, bySub, byBuyer, byMode, trend, granularity: daily ? 'day' : 'month',
  });
}));

petty.get('/ledger', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  const base = `
    WITH t AS (
      SELECT 'topup'::text AS kind, e.id, e.ref_no, e.expense_date AS d, e.created_at, e.title, e.paid_to AS party, '' AS category, e.amount AS credit, 0::numeric AS debit
        FROM expenses e WHERE e.is_petty_topup AND e.status = 'approved'
      UNION ALL
      SELECT 'spend', p.id, p.ref_no, p.entry_date, p.created_at, p.title, p.purchased_by, p.category || CASE WHEN p.sub_category <> '' THEN ' › ' || p.sub_category ELSE '' END, 0, p.amount
        FROM petty_cash_entries p WHERE p.status <> 'rejected'
    ), r AS (SELECT t.*, SUM(credit - debit) OVER (ORDER BY d, created_at, kind DESC, id ROWS UNBOUNDED PRECEDING) AS balance FROM t)`;
  const agg = await one(`${base} SELECT COUNT(*) FILTER (WHERE d BETWEEN $1 AND $2)::int AS n,
      COALESCE(SUM(credit - debit) FILTER (WHERE d < $1),0)::numeric AS opening,
      COALESCE(SUM(credit) FILTER (WHERE d BETWEEN $1 AND $2),0)::numeric AS credits,
      COALESCE(SUM(debit) FILTER (WHERE d BETWEEN $1 AND $2),0)::numeric AS debits FROM r`, [from, to]);
  const pg = paging(req.query, { sorts: { date: 'd' }, defaultSort: 'date', tieBreaker: 'created_at DESC, id DESC', maxLimit: 200 });
  const all = qstr(req.query.limit) === 'all';
  const rows = await many(`${base} SELECT * FROM r WHERE d BETWEEN $1 AND $2 ORDER BY d ${pg.dir.toUpperCase()}, created_at ${pg.dir.toUpperCase()}, id ${pg.dir.toUpperCase()}
                           ${all ? 'LIMIT 20000' : `LIMIT ${pg.limit} OFFSET ${(pg.page - 1) * pg.limit}`}`, [from, to]);
  res.json({ rows, total: agg.n, page: pg.page, pages: Math.max(1, Math.ceil(agg.n / pg.limit)), limit: pg.limit, dir: pg.dir,
    opening: agg.opening, credits: agg.credits, debits: agg.debits, closing: sub(add(agg.opening, agg.credits), agg.debits) });
}));

// ── Top-ups (money given to the petty cash holder) ──
const TOPUP_SORTS = { date: 'e.expense_date', amount: 'e.amount', ref: 'e.ref_no', status: 'e.status', given_to: 'lower(e.paid_to)' };
petty.get('/topups', ah(async (req, res) => {
  const w = new Where();
  w.raw('e.is_petty_topup');
  if (qstr(req.query.all) !== '1' && (req.query.from || req.query.to)) { const { from, to } = v.range(req.query); w.add('e.expense_date BETWEEN ? AND ?', from, to); }
  const status = qstr(req.query.status); if (['pending', 'approved', 'rejected'].includes(status)) w.add('e.status = ?', status);
  const t = await expenseTotals(w);
  const pg = paging(req.query, { sorts: TOPUP_SORTS, defaultSort: 'date', tieBreaker: 'e.id DESC' });
  const pages = Math.max(1, Math.ceil(t.count / pg.limit));
  const page = Math.min(pg.page, pages);
  const params = [...w.params, pg.limit, (page - 1) * pg.limit];
  const rows = await many(`${EXP_SELECT} ${w.sql} ORDER BY ${pg.order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ rows, total: t.count, page, pages, limit: pg.limit, sort: pg.sort, dir: pg.dir, totals: t });
}));

petty.post('/topups', writeLimit, requirePerm('petty_cash', 'edit'), ah(async (req, res) => {
  const f = {
    title: v.text(req.body.title, 'Title', { max: 160 }) || 'Petty cash top-up',
    amount: v.amount(req.body.amount, 'Amount (PKR)'),
    expense_date: v.date(req.body.expense_date || today(), 'Date'),
    paid_to: v.text(req.body.paid_to, 'Given to (petty cash holder)', { required: true, max: 160 }),
    payment_method: v.oneOf(req.body.payment_method || 'Cash', METHODS, 'Payment method'),
    reference_no: v.text(req.body.reference_no, 'Reference no.', { max: 80 }),
    description: v.text(req.body.description, 'Note', { max: 1000 }),
  };
  if (f.expense_date > tomorrow()) throw bad('Top-up date cannot be in the future.');
  const status = isAdmin(req.user) ? 'approved' : 'pending';
  const row = await tx(async db => {
    const ref = (await db.query(`SELECT 'EXP-' || lpad(nextval('expense_seq')::text, 5, '0') AS n`)).rows[0].n;
    const e = (await db.query(`INSERT INTO expenses(ref_no,expense_type,title,category,amount,expense_date,paid_to,payment_method,reference_no,description,status,is_petty_topup,created_by,updated_by,reviewed_by,reviewed_at)
                               VALUES ($1,'variable',$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$11,$12,$13) RETURNING *`,
      [ref, f.title, TOPUP, f.amount, f.expense_date, f.paid_to, f.payment_method, f.reference_no, f.description, status, req.user.id, status === 'approved' ? req.user.id : null, status === 'approved' ? new Date() : null])).rows[0];
    await audit(db, req.user, 'petty.topup', 'expense', e.id, { ref, amount: f.amount, status });
    return e;
  });
  if (status === 'pending') sendMail(await approverEmails(), `Petty cash top-up to approve: ${row.ref_no}`, template({ title: 'Petty cash top-up needs approval', lines: [`${req.user.full_name}: ${pkr(row.amount)} given to ${row.paid_to}.`], action: { label: 'Review', url: link('/expenses/approvals') } }));
  res.status(201).json({ ...row, balance: (await pettyBalance()).balance });
}));

export async function reviewTopup(db, user, cur, status, note) {
  if (!isAdmin(user) && cur.created_by === user.id) throw forbidden('You cannot approve your own top-up.');
  if (status === 'rejected' && !note) throw bad('Please write the reason for rejecting.');
  if (cur.status === 'approved' && status !== 'approved') {
    const bal = await pettyBalance(db);
    if (sub(bal.balance, cur.amount) < 0) throw bad(`Petty cash has already spent this top-up (${cur.ref_no}), so it cannot be un-approved.`);
  }
  await db.query('UPDATE expenses SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=NOW(), version=version+1 WHERE id=$4', [status, note, user.id, cur.id]);
  await audit(db, user, 'petty.topup_review', 'expense', cur.id, { from: cur.status, to: status, note });
}

petty.post('/topups/:id/review', requireApprover, ah(async (req, res) => {
  const status = v.oneOf(req.body.status, ['approved', 'rejected', 'pending'], 'Status');
  const note = v.text(req.body.note, 'Note', { max: 500 }) || null;
  await tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7701)');
    const cur = (await db.query('SELECT * FROM expenses WHERE id=$1 AND is_petty_topup', [v.id(req.params.id)])).rows[0];
    if (!cur) throw notFound('Top-up not found.');
    await reviewTopup(db, req.user, cur, status, note);
  });
  res.json({ ok: true, balance: (await pettyBalance()).balance });
}));

petty.delete('/topups/:id', requireAdmin, ah(async (req, res) => {
  await tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7701)');
    const cur = (await db.query('SELECT * FROM expenses WHERE id=$1 AND is_petty_topup', [v.id(req.params.id)])).rows[0];
    if (!cur) throw notFound('Top-up not found.');
    if (cur.status === 'approved') {
      const bal = await pettyBalance(db);
      if (sub(bal.balance, cur.amount) < 0) throw bad('Petty cash has already spent this top-up, so it cannot be deleted.');
    }
    await db.query('DELETE FROM expenses WHERE id=$1', [cur.id]);
    await audit(db, req.user, 'petty.topup_delete', 'expense', cur.id, { snapshot: cur });
  });
  res.json({ ok: true });
}));

// ── Bulk receipt verification ──
petty.post('/review/bulk', requireApprover, ah(async (req, res) => {
  const ids = idList(req.body.ids);
  const status = v.oneOf(req.body.status, ['verified', 'rejected', 'pending'], 'Status');
  const note = v.text(req.body.note, 'Note', { max: 500 }) || null;
  if (status === 'rejected' && !note) throw bad('Please write why the receipts are not valid.');
  const out = await tx(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7701)');
    const rows = (await db.query('SELECT * FROM petty_cash_entries WHERE id = ANY($1::bigint[]) FOR UPDATE', [ids])).rows;
    const skipped = [], ok = [];
    let bal = (await pettyBalance(db)).balance;
    for (const p of rows) {
      if (!isAdmin(req.user) && p.created_by === req.user.id) { skipped.push({ id: p.id, ref: p.ref_no, reason: 'You cannot verify your own entry' }); continue; }
      if (p.status === status) { skipped.push({ id: p.id, ref: p.ref_no, reason: `Already ${status}` }); continue; }
      if (p.status === 'rejected' && status !== 'rejected') {
        if (p.amount > bal) { skipped.push({ id: p.id, ref: p.ref_no, reason: 'Not enough balance to restore' }); continue; }
        bal = sub(bal, p.amount);
      }
      if (status === 'rejected') bal = add(bal, p.amount);
      ok.push(p);
    }
    for (const id of ids) if (!rows.find(x => x.id === id)) skipped.push({ id, reason: 'Not found' });
    if (ok.length) {
      await db.query('UPDATE petty_cash_entries SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=NOW(), version=version+1 WHERE id = ANY($4::bigint[])', [status, note, req.user.id, ok.map(p => p.id)]);
      await db.query('UPDATE files SET verify_status=$1, verify_note=$2, verified_by=$3, verified_at=NOW() WHERE id = ANY($4::bigint[])', [status === 'verified' ? 'verified' : status === 'rejected' ? 'rejected' : 'unverified', note, req.user.id, ok.map(p => p.receipt_file_id).filter(Boolean)]);
      for (const p of ok) await audit(db, req.user, 'petty.review', 'petty', p.id, { from: p.status, to: status, note, bulk: true });
    }
    return { updated: ok.length, skipped };
  });
  res.json(out);
}));

// ── Entries ──
petty.get('/', ah(async (req, res) => {
  const w = pettyWhere(req.query, req.user);
  const totals = await pettyTotals(w);
  const pg = paging(req.query, { sorts: PETTY_SORTS, defaultSort: 'date', tieBreaker: 'p.id DESC' });
  const pages = Math.max(1, Math.ceil(totals.count / pg.limit));
  const page = Math.min(pg.page, pages);
  const params = [...w.params, pg.limit, (page - 1) * pg.limit];
  const rows = await many(`${PETTY_SELECT} ${w.sql} ORDER BY ${pg.order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ rows, total: totals.count, page, pages, limit: pg.limit, sort: pg.sort, dir: pg.dir, totals });
}));

petty.get('/:id', ah(async (req, res) => {
  const row = await one(`${PETTY_SELECT} WHERE p.id=$1`, [v.id(req.params.id)]);
  if (!row) throw notFound();
  res.json({ ...row, history: await history('petty', row.id, req.user) });
}));

async function pettyFields(db, b, user) {
  const cat = await resolveCategory(db, 'petty', b, user);
  const f = {
    ...cat,
    title: v.text(b.title, 'Item / purpose', { max: 160 }) || cat.sub_category || cat.category,
    amount: v.amount(b.amount, 'Amount (PKR)'),
    entry_date: v.date(b.entry_date, 'Purchase date'),
    purchased_by: v.text(b.purchased_by, 'Purchased by', { required: true, max: 160 }),
    vendor: v.text(b.vendor, 'Shop / vendor', { max: 160 }),
    payment_mode: v.oneOf(b.payment_mode || 'Cash', PETTY_MODES, 'Paid with'),
    location: v.text(b.location, 'Department / branch', { max: 120 }),
    related_to: v.text(b.related_to, 'Student / client', { max: 160 }),
    description: v.text(b.description, 'Description', { max: 1000 }),
    no_receipt_reason: v.text(b.no_receipt_reason, 'Reason for no receipt', { max: 300 }) || null,
  };
  if (f.title.length < 2) throw bad('Write what was bought.');
  if (f.entry_date > tomorrow()) throw bad('Purchase date cannot be in the future.');
  return f;
}

function receiptRule(f, hasReceipt, settings) {
  if (hasReceipt) return;
  if (settings.receipt_required_above > 0 && f.amount > settings.receipt_required_above) throw bad(`A receipt is required for purchases above ${pkr(settings.receipt_required_above)}.`);
  if (!f.no_receipt_reason || f.no_receipt_reason.length < 5) throw bad('Upload the purchase receipt, or tick “No receipt” and write the reason (e.g. rickshaw fare).');
}

petty.post('/', writeLimit, requirePerm('petty_cash', 'edit'), upload.single('receipt'), ah(async (req, res) => {
  const settings = await getPettySettings();
  const row = await txWithFiles(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7701)'); // one petty-cash write at a time → balance can never go negative
    const f = await pettyFields(db, req.body, req.user);
    receiptRule(f, Boolean(req.file), settings);
    if (!isAdmin(req.user) && settings.max_entry > 0 && f.amount > settings.max_entry) throw bad(`One petty cash entry can be at most ${pkr(settings.max_entry)}. Bigger purchases go in Expenses.`);
    const bal = await pettyBalance(db);
    if (f.amount > bal.balance) throw bad(`Not enough petty cash. Available balance is ${pkr(bal.balance)}. Ask admin to add a top-up in Cash Flow Manager → Budget Allotment.`);
    const receipt = req.file ? await saveFile(db, req.file, 'petty_receipt', req.user.id) : null;
    const ref = (await db.query(`SELECT 'PC-' || lpad(nextval('petty_seq')::text, 5, '0') AS n`)).rows[0].n;
    const status = isAdmin(req.user) && receipt ? 'verified' : 'pending';
    const p = (await db.query(`INSERT INTO petty_cash_entries(ref_no,title,category,category_id,sub_category,sub_category_id,amount,entry_date,purchased_by,vendor,payment_mode,location,
                                 related_to,description,no_receipt_reason,receipt_file_id,status,created_by,updated_by,reviewed_by,reviewed_at)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18,$19,$20) RETURNING *`,
      [ref, f.title, f.category, f.category_id, f.sub_category, f.sub_category_id, f.amount, f.entry_date, f.purchased_by, f.vendor, f.payment_mode, f.location,
        f.related_to, f.description, receipt ? null : f.no_receipt_reason, receipt?.id || null, status, req.user.id,
        status === 'verified' ? req.user.id : null, status === 'verified' ? new Date() : null])).rows[0];
    await saveCustom(db, 'petty', p.id, await readCustom('petty', req.body.custom_fields));
    await audit(db, req.user, 'petty.create', 'petty', p.id, { ref, amount: f.amount, category: f.category, item: f.sub_category, receipt: Boolean(receipt) });
    return { ...p, duplicate_receipt: Boolean(receipt?.duplicate_of), balance_after: sub(bal.balance, f.amount) };
  });
  if (row.status === 'pending') sendMail(await approverEmails(), `Petty cash entry to verify: ${row.ref_no}`, template({ title: 'Petty cash receipt needs verification', lines: [`${req.user.full_name}: "${row.title}" — ${pkr(row.amount)} bought by ${row.purchased_by}.`, `Balance left: ${pkr(row.balance_after)}`, row.receipt_file_id ? '' : `No receipt: ${row.no_receipt_reason}`, row.duplicate_receipt ? 'Warning: this receipt file was uploaded before (possible duplicate).' : ''].filter(Boolean), action: { label: 'Verify receipt', url: link('/petty-cash/entries') } }));
  if (row.balance_after <= settings.low_balance && settings.low_balance > 0) sendMail(await approverEmails(), 'Petty cash balance is low', template({ title: 'Petty cash balance is low', lines: [`Balance is now ${pkr(row.balance_after)} (alert level ${pkr(settings.low_balance)}).`, 'Please add a top-up.'], action: { label: 'Add top-up', url: link('/cash-flow/budgets?allot=petty') } }));
  res.status(201).json(row);
}));

const PETTY_EDIT_KEYS = ['title', 'category', 'sub_category', 'amount', 'entry_date', 'purchased_by', 'vendor', 'payment_mode', 'location', 'related_to', 'description'];

petty.put('/:id', writeLimit, requirePerm('petty_cash', 'edit'), upload.single('receipt'), ah(async (req, res) => {
  const settings = await getPettySettings();
  const id = v.id(req.params.id);
  const ver = version(req.body);
  await txWithFiles(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7701)');
    const cur = (await db.query('SELECT * FROM petty_cash_entries WHERE id=$1', [id])).rows[0];
    if (!cur) throw notFound();
    if (!isAdmin(req.user) && (cur.status !== 'pending' || cur.created_by !== req.user.id)) throw forbidden('Only your own entries that are still “to verify” can be edited.');
    if (cur.version !== ver) throw conflict();
    const f = await pettyFields(db, req.body, req.user);
    receiptRule(f, Boolean(req.file || cur.receipt_file_id), settings);
    if (!isAdmin(req.user) && settings.max_entry > 0 && f.amount > settings.max_entry) throw bad(`One petty cash entry can be at most ${pkr(settings.max_entry)}.`);
    if (cur.status !== 'rejected') {
      const bal = await pettyBalance(db);
      if (sub(f.amount, cur.amount) > bal.balance) throw bad(`Not enough petty cash for the new amount. Available: ${pkr(add(bal.balance, cur.amount))}.`);
    }
    const receipt = req.file ? await saveFile(db, req.file, 'petty_receipt', req.user.id) : null;
    const u = await db.query(`UPDATE petty_cash_entries SET title=$1,category=$2,category_id=$3,sub_category=$4,sub_category_id=$5,amount=$6,entry_date=$7,purchased_by=$8,vendor=$9,
                                payment_mode=$10,location=$11,related_to=$12,description=$13,
                                no_receipt_reason=CASE WHEN COALESCE($14::bigint, receipt_file_id) IS NULL THEN $15 ELSE NULL END,
                                receipt_file_id=COALESCE($14,receipt_file_id), version=version+1, updated_by=$16, updated_at=NOW()
                              WHERE id=$17 AND version=$18`,
      [f.title, f.category, f.category_id, f.sub_category, f.sub_category_id, f.amount, f.entry_date, f.purchased_by, f.vendor, f.payment_mode, f.location, f.related_to, f.description,
        receipt?.id || null, f.no_receipt_reason, req.user.id, cur.id, ver]);
    if (!u.rowCount) throw conflict();
    if (req.body.custom_fields !== undefined) await saveCustom(db, 'petty', cur.id, await readCustom('petty', req.body.custom_fields, { existing: cur.custom_fields }));
    await audit(db, req.user, 'petty.update', 'petty', cur.id, { changes: diff(cur, f, PETTY_EDIT_KEYS), receipt: receipt ? 'replaced' : undefined });
  });
  res.json(await one(`${PETTY_SELECT} WHERE p.id=$1`, [id]));
}));

petty.post('/:id/review', requireApprover, ah(async (req, res) => {
  const cur = await one('SELECT p.*, u.email, u.full_name AS creator FROM petty_cash_entries p LEFT JOIN users u ON u.id=p.created_by WHERE p.id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  if (!isAdmin(req.user) && cur.created_by === req.user.id) throw forbidden('You cannot verify your own entry. Another approver must check it.');
  const status = v.oneOf(req.body.status, ['verified', 'rejected', 'pending'], 'Status');
  const note = v.text(req.body.note, 'Note', { max: 500 }) || null;
  if (status === 'rejected' && !note) throw bad('Please write why the receipt is not valid.');
  await txWithFiles(async db => {
    await db.query('SELECT pg_advisory_xact_lock(7701)');
    if (cur.status === 'rejected' && status !== 'rejected') {
      const bal = await pettyBalance(db);
      if (cur.amount > bal.balance) throw bad('Not enough petty cash balance to restore this entry.');
    }
    await db.query('UPDATE petty_cash_entries SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=NOW(), version=version+1 WHERE id=$4', [status, note, req.user.id, cur.id]);
    if (cur.receipt_file_id) await db.query('UPDATE files SET verify_status=$1, verify_note=$2, verified_by=$3, verified_at=NOW() WHERE id=$4', [status === 'verified' ? 'verified' : status === 'rejected' ? 'rejected' : 'unverified', note, req.user.id, cur.receipt_file_id]);
    await audit(db, req.user, 'petty.review', 'petty', cur.id, { from: cur.status, to: status, note });
  });
  if (cur.email && cur.created_by !== req.user.id && status !== 'pending') sendMail(cur.email, `Petty cash ${cur.ref_no}: receipt ${status}`, template({ title: `Receipt ${status}`, greeting: `Hi ${cur.creator},`, lines: [`${cur.title} — ${pkr(cur.amount)}`, status === 'rejected' ? 'This amount has been returned to the petty cash balance.' : '', note ? `Note: ${note}` : ''].filter(Boolean) }));
  res.json({ ok: true });
}));

petty.delete('/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM petty_cash_entries WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  await tx(async db => {
    await db.query('DELETE FROM petty_cash_entries WHERE id=$1', [cur.id]);
    await audit(db, req.user, 'petty.delete', 'petty', cur.id, { snapshot: cur });
  });
  res.json({ ok: true });
}));
