// ═══════════════════════════════════════════════════════════════════════════
//  Revenue — sales / deals, customers, payments, refunds, installment plans,
//  documents, reminders, targets, forecast.
//  Filters, sorting and paging run in SQL (whitelisted sort keys, parameterised values).
// ═══════════════════════════════════════════════════════════════════════════
import express from 'express';
import { one, many, tx } from '../db.js';
import { ah, bad, notFound, forbidden } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requirePerm, requireAdmin, rateLimit } from '../middleware/auth.js';
import { isAdmin } from '../lib/permissions.js';
import { audit, diff } from '../lib/audit.js';
import { readCustom, saveCustom } from '../lib/forms.js';
import { upload, saveFile, txWithFiles } from '../lib/files.js';
import { notify } from '../lib/notify.js';
import { sum, sub, add, toPaisa, fromPaisa, addMonths, currentMonth, today, monthBounds } from '../lib/money.js';
import { paging, Where, qstr, qid, likeText } from '../lib/paging.js';
import { invoicePdf } from '../lib/pdf.js';

export const CATEGORIES = ['Operating Revenue', 'Non-Operating Revenue', 'Recurring Revenue', 'Transactional / One-time Revenue', 'Advertising & Affiliate Revenue'];
export const SERVICES = ['University Admission Application', 'Scholarship Application Support', 'Student Visa Processing', 'IELTS / PTE Preparation', 'SOP & Personal Statement Writing',
  'Document Attestation & Translation', 'Offer Letter / CAS Processing', 'Pre-Departure Counselling', 'Accommodation Arrangement', 'Airport Pickup & Travel Booking',
  'Career Counselling & Course Selection', 'Post-Arrival Support', 'Other'];
export const PACKAGES = ['Guided Success Package', 'Premium Package', 'Standard Package', 'Study Visa Services', 'Scholarship Assistance', 'Career Counseling', 'End-to-End Package', 'Internship & Management', 'Other'];
export const COUNTRIES = ['Pakistan', 'UK', 'Canada', 'Italy', 'Germany', 'Australia', 'USA', 'Ireland', 'France', 'Hungary', 'Cyprus', 'Turkey', 'Malaysia', 'China', 'New Zealand', 'UAE', 'Netherlands', 'Sweden', 'Poland', 'Japan', 'South Korea', 'Other'];
export const METHODS = ['Cash', 'Bank Transfer', 'JazzCash', 'EasyPaisa', 'Online Gateway', 'Card', 'Cheque', 'Other'];
export const NOTE_TYPES = ['First installment received', 'Advance payment only', 'Full payment received', 'Client requested extension', 'Discount / special offer applied', 'Referral client', 'Follow-up required', 'Other (write below)'];
export const REMIND_DAYS = [0, 1, 2, 3, 5, 7, 10];
export const DOC_TYPES = ['passport', 'transcript', 'offer_letter', 'other'];
export const STATUSES = ['Paid', 'Partially Paid', 'Pending', 'Overdue', 'Refunded'];

const r = express.Router();
r.use(requireAuth);
r.get('/meta', (_req, res) => res.json({
  categories: CATEGORIES, services: SERVICES, packages: PACKAGES, countries: COUNTRIES, methods: METHODS, noteTypes: NOTE_TYPES,
  remindDays: REMIND_DAYS, docTypes: DOC_TYPES, statuses: STATUSES,
}));
r.use(requirePerm('revenue', 'view'));
const writeLimit = rateLimit('revenue-write', 120, 60 * 1000);

// ── One row per sale with money, next due installment and status (all computed in SQL) ──
const STATUS_SQL = `CASE
    WHEN COALESCE(rf.refunded,0) > 0 AND COALESCE(rf.refunded,0) >= COALESCE(p.paid,0) THEN 'Refunded'
    WHEN s.total_amount - COALESCE(p.paid,0) <= 0.004 THEN 'Paid'
    WHEN COALESCE(nx.next_due, s.due_date) < CURRENT_DATE THEN 'Overdue'
    WHEN COALESCE(p.paid,0) > 0 THEN 'Partially Paid'
    ELSE 'Pending' END`;
export const SALES_SQL = `
  SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.country AS customer_country,
         u.full_name AS employee_name, u.employee_code,
         COALESCE(p.paid,0)::numeric AS paid, COALESCE(rf.refunded,0)::numeric AS refunded, p.last_payment, COALESCE(p.methods,'{}') AS methods,
         nx.next_due, nx.next_amount, ${STATUS_SQL} AS status
    FROM sales s
    JOIN customers c ON c.id=s.customer_id
    JOIN users u ON u.id=s.employee_id
    LEFT JOIN LATERAL (SELECT SUM(amount) AS paid, MAX(payment_date) AS last_payment, array_agg(DISTINCT method) AS methods FROM sale_payments WHERE sale_id=s.id) p ON TRUE
    LEFT JOIN LATERAL (SELECT SUM(amount) AS refunded FROM sale_refunds WHERE sale_id=s.id) rf ON TRUE
    LEFT JOIN LATERAL (
      SELECT x.due_date AS next_due, LEAST(x.amount, x.cum - COALESCE(p.paid,0))::numeric AS next_amount
        FROM (SELECT due_date, amount, SUM(amount) OVER (ORDER BY seq) AS cum FROM sale_installments WHERE sale_id=s.id) x
       WHERE x.cum > COALESCE(p.paid,0) + 0.004 ORDER BY x.cum LIMIT 1) nx ON TRUE`;
const ROWS = `SELECT * FROM (${SALES_SQL}) t`;

/** Adds outstanding / net received. `status` already comes from SQL. */
export function decorate(s) {
  const balance = Math.max(0, sub(s.total_amount, s.paid));
  const status = s.status || (balance <= 0 ? 'Paid' : Number(s.paid) > 0 ? 'Partially Paid' : 'Pending');
  return { ...s, status, outstanding: status === 'Refunded' ? 0 : balance, balance, net_received: sub(s.paid, s.refunded), due: s.next_due || s.due_date || null };
}

const SORTS = {
  date: 't.sale_date', invoice: 't.invoice_no', client: 'lower(t.customer_name)', total: 't.total_amount', paid: 't.paid',
  balance: '(t.total_amount - t.paid)', status: 't.status', staff: 'lower(t.employee_name)', due: 'COALESCE(t.next_due, t.due_date)',
  country: 't.destination', package: 't.package', service: 't.service', category: 't.revenue_category', created: 't.created_at',
};

/** Filters shared by the deals list, the summary and the exports. */
export function saleWhere(q, { dates = true } = {}) {
  const w = new Where();
  if (dates && qstr(q.all) !== '1' && (q.from || q.to)) { const { from, to } = v.range(q); w.add('t.sale_date BETWEEN ? AND ?', from, to); }
  const text = qstr(q.q, 80);
  if (text) {
    const p = likeText(text);
    w.add(`(lower(t.customer_name) LIKE ? OR lower(COALESCE(t.customer_email,'')) LIKE ? OR COALESCE(t.customer_phone,'') LIKE ? OR lower(t.invoice_no) LIKE ?
            OR lower(t.service) LIKE ? OR lower(t.package) LIKE ? OR lower(COALESCE(t.destination,'')) LIKE ? OR lower(t.employee_name) LIKE ?)`, p, p, p, p, p, p, p, p);
  }
  const status = qstr(q.status); if (STATUSES.includes(status)) w.add('t.status = ?', status);
  const cat = qstr(q.category); if (cat) w.add('t.revenue_category = ?', cat);
  const pkg = qstr(q.package); if (pkg) w.add('t.package = ?', pkg);
  const country = qstr(q.country); if (country) w.add('t.destination = ?', country);
  const service = qstr(q.service, 120); if (service) w.add('t.service = ?', service);
  const staff = qid(q.staff); if (staff) w.add('t.employee_id = ?', staff);
  const method = qstr(q.method, 40); if (method) w.add('? = ANY(t.methods)', method);
  const view = qstr(q.view);
  if (view === 'upcoming') w.raw(`t.status NOT IN ('Paid','Refunded') AND COALESCE(t.next_due, t.due_date) BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`);
  if (view === 'outstanding') w.raw(`t.status NOT IN ('Paid','Refunded')`);
  if (view === 'overdue') w.raw(`t.status = 'Overdue'`);
  if (view === 'refunds') w.raw('t.refunded > 0');
  return w;
}

export async function listDeals(q, { cap } = {}) {
  const w = saleWhere(q);
  const t = await one(`SELECT COUNT(*)::int AS count, COALESCE(SUM(t.total_amount),0)::numeric AS total, COALESCE(SUM(t.paid),0)::numeric AS paid,
      COALESCE(SUM(CASE WHEN t.status <> 'Refunded' THEN GREATEST(t.total_amount - t.paid, 0) ELSE 0 END),0)::numeric AS outstanding,
      COALESCE(SUM(t.refunded),0)::numeric AS refunded FROM (${SALES_SQL}) t ${w.sql}`, w.params);
  const pg = paging(q, { sorts: SORTS, defaultSort: 'date', tieBreaker: 't.id DESC', maxLimit: 100 });
  if (cap) return { rows: (await many(`${ROWS} ${w.sql} ORDER BY ${pg.order} LIMIT ${Number(cap)}`, w.params)).map(decorate), totals: t };
  const pages = Math.max(1, Math.ceil(t.count / pg.limit));
  const page = Math.min(pg.page, pages);
  const params = [...w.params, pg.limit, (page - 1) * pg.limit];
  const rows = (await many(`${ROWS} ${w.sql} ORDER BY ${pg.order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).map(decorate);
  return { rows, total: t.count, page, pages, limit: pg.limit, sort: pg.sort, dir: pg.dir, totals: t };
}

const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
const rateOf = (c, g) => (g > 0 ? Math.round((c / g) * 1000) / 10 : 0);

async function kpis(q, from, to) {
  const w = saleWhere({ ...q, from, to, all: from ? '' : '1' });
  const k = await one(`SELECT COUNT(*)::int AS deals, COALESCE(SUM(t.total_amount),0)::numeric AS gross, COALESCE(SUM(t.paid),0)::numeric AS collected,
      COALESCE(SUM(CASE WHEN t.status <> 'Refunded' THEN GREATEST(t.total_amount - t.paid, 0) ELSE 0 END),0)::numeric AS outstanding,
      COALESCE(SUM(t.refunded),0)::numeric AS refunds,
      COUNT(*) FILTER (WHERE t.status='Overdue')::int AS overdue_count,
      COALESCE(SUM(GREATEST(t.total_amount - t.paid,0)) FILTER (WHERE t.status='Overdue'),0)::numeric AS overdue
    FROM (${SALES_SQL}) t ${w.sql}`, w.params);
  return { ...k, rate: rateOf(k.collected, k.gross) };
}

// ── Summary: KPIs (+ trend), 12-month chart, breakdowns, targets, forecast — all following the filters ──
r.get('/summary', ah(async (req, res) => {
  const q = req.query;
  const hasRange = Boolean(q.from || q.to) && qstr(q.all) !== '1';
  const { from, to } = hasRange ? v.range(q) : { from: null, to: today() };
  const k = await kpis(q, from, to);
  let trend = {};
  if (hasRange) {
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    const pFrom = new Date(new Date(from).getTime() - days * 86400000).toISOString().slice(0, 10);
    const pTo = new Date(new Date(from).getTime() - 86400000).toISOString().slice(0, 10);
    const p = await kpis(q, pFrom, pTo);
    trend = { gross: pct(k.gross, p.gross), collected: pct(k.collected, p.collected), outstanding: pct(k.outstanding, p.outstanding), refunds: pct(k.refunds, p.refunds), rate: p.gross > 0 ? Math.round((k.rate - p.rate) * 10) / 10 : null, deals: pct(k.deals, p.deals) };
  }
  // 12 months ending at "to", other filters applied
  const end = to.slice(0, 7);
  const start = addMonths(end, -11);
  const lastOfEnd = new Date(new Date(monthBounds(end).next + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const wm = saleWhere({ ...q, from: `${start}-01`, to: lastOfEnd, all: '' });
  const mrows = await many(`SELECT to_char(t.sale_date,'YYYY-MM') AS month, SUM(t.total_amount)::numeric AS gross, SUM(t.paid)::numeric AS collected,
      SUM(CASE WHEN t.status <> 'Refunded' THEN GREATEST(t.total_amount - t.paid,0) ELSE 0 END)::numeric AS outstanding, SUM(t.refunded)::numeric AS refunds, COUNT(*)::int AS deals
    FROM (${SALES_SQL}) t ${wm.sql} GROUP BY 1`, wm.params);
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = addMonths(start, i);
    const x = mrows.find(y => y.month === m) || { gross: 0, collected: 0, outstanding: 0, refunds: 0, deals: 0 };
    return { month: m, gross: Number(x.gross), collected: Number(x.collected), outstanding: Number(x.outstanding), refunds: Number(x.refunds), deals: x.deals, rate: rateOf(x.collected, x.gross) };
  });
  const w = saleWhere({ ...q, from, to, all: hasRange ? '' : '1' });
  const group = async col => (await many(`SELECT COALESCE(NULLIF(${col}::text,''),'Other') AS name, SUM(t.total_amount)::numeric AS value, COUNT(*)::int AS deals, SUM(t.paid)::numeric AS collected
      FROM (${SALES_SQL}) t ${w.sql} GROUP BY 1 ORDER BY value DESC LIMIT 12`, w.params)).map(x => ({ ...x, share: k.gross > 0 ? Math.round((x.value / k.gross) * 1000) / 10 : 0 }));
  const byStaff = await many(`SELECT t.employee_id AS id, t.employee_name AS name, SUM(t.total_amount)::numeric AS value, COUNT(*)::int AS deals FROM (${SALES_SQL}) t ${w.sql} GROUP BY 1,2 ORDER BY value DESC LIMIT 12`, w.params);
  const byMethod = await many(`SELECT p.method AS name, SUM(p.amount)::numeric AS value FROM sale_payments p WHERE p.sale_id IN (SELECT t.id FROM (${SALES_SQL}) t ${w.sql}) GROUP BY 1 ORDER BY value DESC`, w.params);
  res.json({
    range: { from, to }, kpi: { ...k, trend }, monthly,
    byCategory: await group('t.revenue_category'), byPackage: await group('t.package'), byCountry: await group('t.destination'), byService: await group('t.service'),
    byStaff, byMethod, targets: await targets(), forecast: forecastFrom(await collectionsHistory()),
  });
}));

// ── Deals list (paged) ──
r.get('/deals', ah(async (req, res) => res.json(await listDeals(req.query))));

// ── Old dashboard endpoint (kept so older screens keep working) ──
r.get('/overview', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  const k = await kpis({}, from, to);
  const collected = sum(await many('SELECT amount FROM sale_payments WHERE payment_date BETWEEN $1 AND $2', [from, to]), 'amount');
  const refunds = sum(await many('SELECT amount FROM sale_refunds WHERE refund_date BETWEEN $1 AND $2', [from, to]), 'amount');
  const sales = (await many(`${ROWS} WHERE t.sale_date BETWEEN $1 AND $2 ORDER BY t.sale_date DESC, t.id DESC`, [from, to])).map(decorate);
  const group = key => {
    const map = new Map();
    for (const s of sales) map.set(s[key] || 'Other', add(map.get(s[key] || 'Other') || 0, s.total_amount));
    return [...map.entries()].map(([name, value]) => ({ name, value, share: k.gross > 0 ? Math.round((value / k.gross) * 1000) / 10 : 0 })).sort((a, b) => b.value - a.value);
  };
  res.json({ range: { from, to }, kpi: { gross: k.gross, collected, outstanding: k.outstanding, refunds, rate: rateOf(collected, k.gross), trend: {} }, byPackage: group('package'), byCountry: group('destination'), recent: sales.slice(0, 10), deals: sales.length });
}));

async function collectionsHistory() {
  const end = currentMonth();
  const start = addMonths(end, -11);
  const c = await many(`SELECT to_char(payment_date,'YYYY-MM') AS m, SUM(amount)::numeric AS n FROM sale_payments WHERE payment_date >= $1 GROUP BY 1`, [`${start}-01`]);
  const g = await many(`SELECT to_char(sale_date,'YYYY-MM') AS m, SUM(total_amount)::numeric AS n FROM sales WHERE sale_date >= $1 GROUP BY 1`, [`${start}-01`]);
  return Array.from({ length: 12 }, (_, i) => { const m = addMonths(start, i); return { month: m, collected: Number(c.find(x => x.m === m)?.n || 0), gross: Number(g.find(x => x.m === m)?.n || 0) }; });
}

/** Simple linear-trend forecast on the last 6 months of collections. */
export function forecastFrom(monthlyRows) {
  const last = monthlyRows.slice(-6);
  const n = last.length;
  const ys = last.map(m => Number(m.collected));
  const xs = last.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / (n || 1);
  const my = ys.reduce((a, b) => a + b, 0) / (n || 1);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = den ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : 0;
  const lastMonth = monthlyRows.length ? monthlyRows[monthlyRows.length - 1].month : currentMonth();
  return [1, 2, 3].map(k => ({ month: addMonths(lastMonth, k), expected: Math.max(0, Math.round(my + slope * (n - 1 - mx + k))) }));
}

// ── Targets (company + each staff member, this month's booked sales) ──
async function targets() {
  const { from, next } = monthBounds(currentMonth());
  const company = await one(`SELECT COALESCE((SELECT (value->>'amount')::numeric FROM app_settings WHERE key='company_target'),0) AS target,
      (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE sale_date >= $1 AND sale_date < $2)::numeric AS achieved`, [from, next]);
  const staff = await many(`SELECT u.id, u.full_name, u.employee_code, u.monthly_target AS target,
      COALESCE((SELECT SUM(total_amount) FROM sales s WHERE s.employee_id=u.id AND s.sale_date >= $1 AND s.sale_date < $2),0)::numeric AS achieved,
      COALESCE((SELECT COUNT(*) FROM sales s WHERE s.employee_id=u.id AND s.sale_date >= $1 AND s.sale_date < $2),0)::int AS deals
    FROM users u WHERE u.status='approved' AND (u.monthly_target > 0 OR EXISTS (SELECT 1 FROM sales s WHERE s.employee_id=u.id AND s.sale_date >= $1 AND s.sale_date < $2))
    ORDER BY achieved DESC, u.full_name LIMIT 50`, [from, next]);
  return { month: currentMonth(), company: { target: Number(company.target), achieved: Number(company.achieved) }, staff };
}
r.get('/targets', ah(async (_req, res) => {
  const t = await targets();
  const all = await many(`SELECT id, full_name, employee_code, monthly_target AS target FROM users WHERE status='approved' ORDER BY full_name`);
  res.json({ ...t, everyone: all });
}));
r.put('/targets', requireAdmin, ah(async (req, res) => {
  const company = v.amount(req.body.company_target ?? 0, 'Company target', { allowZero: true });
  const list = Array.isArray(req.body.staff) ? req.body.staff.slice(0, 500) : [];
  await tx(async db => {
    await db.query(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES ('company_target',$1,$2,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, [JSON.stringify({ amount: company }), req.user.id]);
    for (const s of list) await db.query('UPDATE users SET monthly_target=$1 WHERE id=$2', [v.amount(s.target ?? 0, 'Staff target', { allowZero: true }), v.id(s.id)]);
    await audit(db, req.user, 'targets.update', 'settings', 'targets', { company, staff: list.length });
  });
  res.json(await targets());
}));

// Staff picker for the New Sale form (commission % from Salary & Workforce)
r.get('/staff', ah(async (_req, res) => {
  res.json(await many(`SELECT u.id, u.full_name, u.employee_code, u.designation, u.monthly_target,
      COALESCE((SELECT t.commission_pct FROM salary_terms t WHERE t.user_id=u.id AND t.effective_month <= $1 ORDER BY t.effective_month DESC LIMIT 1),0)::numeric AS commission_pct
    FROM users u WHERE u.status='approved' ORDER BY u.full_name`, [currentMonth()]));
}));

// ── Sales & deals ──
r.get('/sales', ah(async (req, res) => {
  const range = req.query.all === '1' ? { all: '1' } : v.range(req.query);
  const rows = await listDeals({ ...req.query, ...range, limit: 100 }, { cap: 5000 });
  res.json(rows.rows);
}));

/** Splits paid money over the installment plan, oldest first. */
export function allocate(installments, paid) {
  let left = toPaisa(paid);
  const t = today();
  return installments.map(i => {
    const amt = toPaisa(i.amount);
    const covered = Math.min(amt, Math.max(0, left));
    left -= covered;
    const done = covered >= amt;
    return { ...i, paid_amount: fromPaisa(covered), remaining: fromPaisa(amt - covered), paid: done, overdue: !done && i.due_date < t };
  });
}

async function saleDetail(id, user) {
  const s = await one(`${ROWS} WHERE t.id=$1`, [id]);
  if (!s) throw notFound('Sale not found.');
  const sale = decorate(s);
  const installments = allocate(await many('SELECT id, seq, due_date, amount, last_reminded_on FROM sale_installments WHERE sale_id=$1 ORDER BY seq', [id]), sale.paid);
  const payments = await many('SELECT p.*, u.full_name AS entered_by FROM sale_payments p LEFT JOIN users u ON u.id=p.created_by WHERE p.sale_id=$1 ORDER BY p.payment_date, p.id', [id]);
  const refunds = await many('SELECT * FROM sale_refunds WHERE sale_id=$1 ORDER BY refund_date, id', [id]);
  const documents = await many(`SELECT d.id, d.doc_type, d.created_at, f.id AS file_id, f.original_name, f.mime, f.size_bytes, f.duplicate_of
                                  FROM sale_documents d JOIN files f ON f.id=d.file_id WHERE d.sale_id=$1 ORDER BY d.id`, [id]);
  const history = await many(`SELECT id, user_name, action, details, created_at${isAdmin(user) ? ', ip' : ''} FROM audit_log WHERE entity='sale' AND entity_id=$1 ORDER BY created_at, id LIMIT 200`, [String(id)]);
  return { ...sale, installments, payments, refunds, documents, history };
}

r.get('/sales/:id', ah(async (req, res) => res.json(await saleDetail(v.id(req.params.id), req.user))));

r.get('/sales/:id/invoice', ah(async (req, res) => {
  const d = await saleDetail(v.id(req.params.id), req.user);
  const owner = (await one(`SELECT value FROM app_settings WHERE key='owner_info'`))?.value || {};
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Receipt-${d.invoice_no}.pdf"`);
  await invoicePdf(res, { sale: d, payments: d.payments, refunds: d.refunds, installments: d.installments, owner });
}));

async function approvedEmployee(id) {
  const u = await one(`SELECT id, full_name FROM users WHERE id=$1 AND status='approved'`, [v.id(id, 'Sales staff member')]);
  if (!u) throw bad('Please select a valid, approved sales staff member.');
  return u;
}

/** A value from a list, or (for "Other") the typed text. */
function listOrText(val, other, list, label, max = 80) {
  const s = String(val ?? '').trim();
  if (!s) throw bad(`${label} is required.`);
  if (s === 'Other' && other !== undefined) {
    const o = v.text(other, `${label} (write it)`, { required: true, min: 2, max });
    return o;
  }
  if (list.includes(s)) return s;
  return v.text(s, label, { required: true, min: 2, max });
}

function saleFields(b, cur) {
  const f = {
    revenue_category: b.revenue_category ? v.oneOf(b.revenue_category, CATEGORIES, 'Revenue category') : cur?.revenue_category || 'Operating Revenue',
    service: b.service !== undefined ? listOrText(b.service, b.service_other, SERVICES, 'Service', 120) : cur?.service || '',
    package: listOrText(b.package, b.package_other, PACKAGES, 'Package'),
    destination: listOrText(b.destination || 'Other', b.destination_other, COUNTRIES, 'Country (study destination)'),
    total_amount: v.amount(b.total_amount, 'Total package amount'),
    sale_date: v.date(b.sale_date, 'Sale date'),
    due_date: v.date(b.due_date, 'Due date', { required: false }),
    notes_type: b.notes_type !== undefined ? v.text(b.notes_type, 'Note type', { max: 80 }) : cur?.notes_type || '',
    notes: v.text(b.notes, 'Notes', { max: 1000 }),
    reminder_days: b.reminder_days !== undefined && b.reminder_days !== '' ? v.int(b.reminder_days, 'Reminder days', { min: 0, max: 30 }) : cur?.reminder_days ?? 3,
    reminder_channels: b.reminder_channels !== undefined ? channels(b.reminder_channels) : cur?.reminder_channels || ['app'],
  };
  if (f.due_date && f.due_date < f.sale_date) throw bad('Due date cannot be before the sale date.');
  if (f.sale_date > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw bad('Sale date cannot be in the future.');
  return f;
}
function channels(raw) {
  const list = Array.isArray(raw) ? raw : v.json(raw, []);
  if (!Array.isArray(list)) throw bad('Reminder channels are not valid.');
  const out = [...new Set(list.map(String))].filter(x => ['app', 'email', 'whatsapp'].includes(x));
  return out.length ? out : ['app'];
}

/** Validates the installment plan for the money still to be received. */
function planFor(raw, pending, saleDate) {
  const list = Array.isArray(raw) ? raw : v.json(raw, []);
  if (!Array.isArray(list)) throw bad('Installments are not valid.');
  if (!list.length) return [];
  if (list.length > 36) throw bad('At most 36 installments are allowed.');
  const plan = list.map((x, i) => {
    const due = v.date(x?.due_date, `Installment #${i + 1} due date`);
    if (due < saleDate) throw bad(`Installment #${i + 1} is due before the sale date.`);
    return { due_date: due, amount: v.amount(x?.amount, `Installment #${i + 1} amount`) };
  });
  const diffP = toPaisa(pending) - plan.reduce((a, x) => a + toPaisa(x.amount), 0);
  if (Math.abs(diffP) > 100) throw bad(`Installments add up to ${fromPaisa(toPaisa(pending) - diffP)} but the pending amount is ${pending}. Please make them equal.`);
  if (diffP !== 0) { const last = plan[plan.length - 1]; last.amount = fromPaisa(toPaisa(last.amount) + diffP); if (last.amount <= 0) throw bad('Last installment must be more than 0.'); }
  return plan;
}

async function writePlan(db, saleId, advance, plan) {
  await db.query('DELETE FROM sale_installments WHERE sale_id=$1', [saleId]);
  if (advance) await db.query('INSERT INTO sale_installments(sale_id,seq,due_date,amount) VALUES ($1,0,$2,$3)', [saleId, advance.date, advance.amount]);
  for (let i = 0; i < plan.length; i++) await db.query('INSERT INTO sale_installments(sale_id,seq,due_date,amount) VALUES ($1,$2,$3,$4)', [saleId, i + 1, plan[i].due_date, plan[i].amount]);
}

r.post('/sales', writeLimit, requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const b = req.body;
  const cust = b.client || {};
  const customer = {
    name: v.text(cust.name ?? b.customer_name, 'Student / client name', { required: true, max: 160, min: 2 }),
    phone: v.phone(cust.phone ?? b.customer_phone, 'Client phone', { required: false }),
    email: (cust.email ?? b.customer_email) ? v.email(cust.email ?? b.customer_email, 'Client email') : null,
    country: v.text(cust.country ?? b.customer_country ?? 'Pakistan', 'Client country', { max: 80 }) || 'Pakistan',
  };
  if (customer.name && !/^[\p{L} .'-]+$/u.test(customer.name)) throw bad('Client name can only contain letters, spaces, dots and hyphens.');
  const f = saleFields(b);
  const emp = await approvedEmployee(b.employee_id);
  let first = null;
  const adv = b.initial_amount ?? b.advance_amount;
  if (adv !== undefined && String(adv).trim() !== '' && Number(adv) !== 0) {
    first = {
      amount: v.amount(adv, 'Amount received'),
      method: v.oneOf(b.payment_method || 'Cash', METHODS, 'Payment method'),
      date: v.date(b.payment_date || f.sale_date, 'Payment date'),
      reference: v.text(b.reference ?? b.reference_no, 'Reference', { max: 120 }) || null,
    };
    if (first.amount > f.total_amount) throw bad('Amount received cannot be more than the total package amount.');
    if (first.date < f.sale_date) throw bad('Payment date cannot be before the sale date.');
    if (first.method !== 'Cash' && !first.reference && b.require_reference) throw bad('Reference / receipt no. is required for non-cash payments.');
  }
  const pending = sub(f.total_amount, first?.amount || 0);
  const plan = pending > 0 ? planFor(b.installments, pending, f.sale_date) : [];
  if (plan.length) f.due_date = plan[plan.length - 1].due_date;
  const custom = await readCustom('sales', req.body.custom_fields);
  const sale = await tx(async db => {
    let c = (await db.query('SELECT id FROM customers WHERE lower(name)=lower($1) AND phone IS NOT DISTINCT FROM $2 LIMIT 1', [customer.name, customer.phone])).rows[0];
    if (!c) c = (await db.query('INSERT INTO customers(name,phone,email,country,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [customer.name, customer.phone, customer.email, customer.country, req.user.id])).rows[0];
    else if (customer.email) await db.query('UPDATE customers SET email=COALESCE(email,$1) WHERE id=$2', [customer.email, c.id]);
    const inv = (await db.query(`SELECT 'INV-' || lpad(nextval('invoice_seq')::text, 4, '0') AS n`)).rows[0].n;
    const s = (await db.query(`INSERT INTO sales(invoice_no,customer_id,employee_id,package,destination,total_amount,sale_date,due_date,notes,created_by,
                                 revenue_category,service,reminder_days,reminder_channels,notes_type)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [inv, c.id, emp.id, f.package, f.destination, f.total_amount, f.sale_date, f.due_date, f.notes, req.user.id,
        f.revenue_category, f.service, f.reminder_days, f.reminder_channels, f.notes_type])).rows[0];
    if (first) await db.query('INSERT INTO sale_payments(sale_id,amount,method,payment_date,reference,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [s.id, first.amount, first.method, first.date, first.reference, req.user.id]);
    if (plan.length) await writePlan(db, s.id, first, plan);
    await saveCustom(db, 'sales', s.id, custom);
    await audit(db, req.user, 'sale.create', 'sale', s.id, { invoice: inv, total: f.total_amount, received: first?.amount || 0, installments: plan.length });
    if (emp.id !== req.user.id) await notify(db, [emp.id], { kind: 'sale', title: `New sale under your name: ${customer.name}`, body: `${inv} · PKR ${f.total_amount.toLocaleString('en-PK')} · entered by ${req.user.full_name}`, link: `/revenue/sales?open=${s.id}` });
    return s;
  });
  res.status(201).json(decorate(await one(`${ROWS} WHERE t.id=$1`, [sale.id])));
}));

/** After the total changes: keep fully-paid installments, spread the rest over the unpaid ones (same due dates). */
async function rebalance(db, saleId, total, paid) {
  const list = (await db.query('SELECT * FROM sale_installments WHERE sale_id=$1 ORDER BY seq', [saleId])).rows;
  if (!list.length) return;
  const alloc = allocate(list, paid);
  const keep = alloc.filter(i => i.paid);
  const open = alloc.filter(i => !i.paid);
  const kept = keep.reduce((a, i) => a + toPaisa(i.amount), 0);
  let rest = toPaisa(total) - kept;
  await db.query('DELETE FROM sale_installments WHERE sale_id=$1 AND seq = ANY($2::smallint[])', [saleId, open.map(i => i.seq)]);
  if (rest <= 0) return;
  const n = Math.max(1, open.length);
  const dates = open.length ? open.map(i => i.due_date) : [new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)];
  let seq = keep.length ? Math.max(...keep.map(i => i.seq)) + 1 : 1;
  const each = Math.floor(rest / n);
  for (let i = 0; i < n; i++) {
    const amt = i === n - 1 ? rest - each * (n - 1) : each;
    if (amt > 0) await db.query('INSERT INTO sale_installments(sale_id,seq,due_date,amount) VALUES ($1,$2,$3,$4)', [saleId, seq++, dates[i], fromPaisa(amt)]);
  }
}

r.put('/sales/:id', writeLimit, requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const cur = await one(`${ROWS} WHERE t.id=$1`, [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const f = saleFields(req.body, cur);
  const emp = await approvedEmployee(req.body.employee_id ?? cur.employee_id);
  if (f.total_amount < Number(cur.paid)) throw bad(`Total cannot be less than the amount already received (${cur.paid}).`);
  const custom = req.body.custom_fields !== undefined ? await readCustom('sales', req.body.custom_fields, { existing: cur.custom_fields }) : null;
  await tx(async db => {
    if (custom) await saveCustom(db, 'sales', cur.id, custom);
    await db.query(`UPDATE sales SET package=$1,destination=$2,total_amount=$3,sale_date=$4,due_date=COALESCE($5,due_date),notes=$6,employee_id=$7,
                      revenue_category=$8,service=$9,reminder_days=$10,reminder_channels=$11,notes_type=$12,updated_at=NOW() WHERE id=$13`,
      [f.package, f.destination, f.total_amount, f.sale_date, f.due_date, f.notes, emp.id, f.revenue_category, f.service, f.reminder_days, f.reminder_channels, f.notes_type, cur.id]);
    if (Number(cur.total_amount) !== f.total_amount) await rebalance(db, cur.id, f.total_amount, cur.paid);
    if (req.body.customer_name) {
      const name = v.text(req.body.customer_name, 'Client name', { required: true, max: 160, min: 2 });
      if (!/^[\p{L} .'-]+$/u.test(name)) throw bad('Client name can only contain letters, spaces, dots and hyphens.');
      await db.query('UPDATE customers SET name=$1 WHERE id=$2', [name, cur.customer_id]);
    }
    if (req.body.customer_phone !== undefined) await db.query('UPDATE customers SET phone=$1 WHERE id=$2', [v.phone(req.body.customer_phone, 'Client phone', { required: false }), cur.customer_id]);
    if (req.body.customer_email !== undefined) await db.query('UPDATE customers SET email=$1 WHERE id=$2', [req.body.customer_email ? v.email(req.body.customer_email, 'Client email') : null, cur.customer_id]);
    if (req.body.customer_country) await db.query('UPDATE customers SET country=$1 WHERE id=$2', [v.text(req.body.customer_country, 'Client country', { max: 80 }), cur.customer_id]);
    await audit(db, req.user, 'sale.update', 'sale', cur.id, { changes: diff(cur, { ...f, employee_id: emp.id }, ['package', 'destination', 'total_amount', 'sale_date', 'due_date', 'employee_id', 'revenue_category', 'service', 'reminder_days', 'notes']) });
  });
  res.json(decorate(await one(`${ROWS} WHERE t.id=$1`, [cur.id])));
}));

// Replace the whole installment plan (must add up to the total)
r.put('/sales/:id/schedule', writeLimit, requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const cur = await one(`${ROWS} WHERE t.id=$1`, [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const list = Array.isArray(req.body.installments) ? req.body.installments : [];
  if (!list.length) throw bad('Add at least one installment.');
  const plan = planFor(list, cur.total_amount, cur.sale_date);
  // Keep the "Advance" label (seq 0) when the plan already started with one.
  const base = (await one('SELECT 1 FROM sale_installments WHERE sale_id=$1 AND seq=0', [cur.id])) ? 0 : 1;
  await tx(async db => {
    await db.query('DELETE FROM sale_installments WHERE sale_id=$1', [cur.id]);
    for (let i = 0; i < plan.length; i++) await db.query('INSERT INTO sale_installments(sale_id,seq,due_date,amount) VALUES ($1,$2,$3,$4)', [cur.id, i + base, plan[i].due_date, plan[i].amount]);
    await db.query('UPDATE sales SET due_date=$1, reminder_days=COALESCE($2,reminder_days), reminder_channels=COALESCE($3,reminder_channels), updated_at=NOW() WHERE id=$4',
      [plan[plan.length - 1].due_date, req.body.reminder_days !== undefined ? v.int(req.body.reminder_days, 'Reminder days', { min: 0, max: 30 }) : null,
        req.body.reminder_channels !== undefined ? channels(req.body.reminder_channels) : null, cur.id]);
    await audit(db, req.user, 'sale.schedule', 'sale', cur.id, { installments: plan.length });
  });
  res.json(await saleDetail(cur.id, req.user));
}));

// "Mark paid" — receives the remaining amount of the next due installment
r.post('/sales/:id/installments/pay', writeLimit, requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const id = v.id(req.params.id);
  const method = v.oneOf(req.body.method || req.body.payment_method, METHODS, 'Payment method');
  const date = v.date(req.body.payment_date || today(), 'Payment date');
  const reference = v.text(req.body.reference, 'Reference', { max: 120 }) || null;
  await tx(async db => {
    const s = (await db.query(`${SALES_SQL} WHERE s.id=$1 FOR UPDATE OF s`, [id])).rows[0];
    if (!s) throw notFound('Sale not found.');
    if (!s.next_amount || Number(s.next_amount) <= 0) throw bad('There is no unpaid installment on this sale.');
    if (date < s.sale_date) throw bad('Payment date cannot be before the sale date.');
    const inst = allocate((await db.query('SELECT seq, due_date, amount FROM sale_installments WHERE sale_id=$1 ORDER BY seq', [id])).rows, s.paid).find(i => !i.paid);
    await db.query('INSERT INTO sale_payments(sale_id,amount,method,payment_date,reference,created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, s.next_amount, method, date, reference, req.user.id]);
    await audit(db, req.user, 'payment.create', 'sale', id, { amount: s.next_amount, date, installment: inst?.seq });
  });
  res.json(await saleDetail(id, req.user));
}));

// Documents (passport, transcripts, offer letter …) — one request per file keeps uploads under Vercel's 4.5 MB limit
const docFiles = upload.fields(DOC_TYPES.map(name => ({ name, maxCount: 3 })));
r.post('/sales/:id/documents', writeLimit, requirePerm('revenue', 'edit'), docFiles, ah(async (req, res) => {
  const id = v.id(req.params.id);
  if (!(await one('SELECT 1 FROM sales WHERE id=$1', [id]))) throw notFound('Sale not found.');
  const files = DOC_TYPES.flatMap(t => (req.files?.[t] || []).map(f => [t, f]));
  if (!files.length) throw bad('Choose a file to upload.');
  const count = (await one('SELECT COUNT(*)::int AS n FROM sale_documents WHERE sale_id=$1', [id])).n;
  if (count + files.length > 20) throw bad('A sale can have at most 20 documents.');
  await txWithFiles(async db => {
    for (const [type, file] of files) {
      const saved = await saveFile(db, file, 'sale_document', req.user.id);
      await db.query('INSERT INTO sale_documents(sale_id,file_id,doc_type,uploaded_by) VALUES ($1,$2,$3,$4)', [id, saved.id, type, req.user.id]);
    }
    await audit(db, req.user, 'sale.documents', 'sale', id, { added: files.map(([t, f]) => `${t}: ${f.originalname}`) });
  });
  res.status(201).json(await saleDetail(id, req.user));
}));
r.delete('/sales/:id/documents/:docId', requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const d = await one('SELECT d.*, f.original_name FROM sale_documents d JOIN files f ON f.id=d.file_id WHERE d.id=$1 AND d.sale_id=$2', [v.id(req.params.docId), v.id(req.params.id)]);
  if (!d) throw notFound('Document not found.');
  if (!isAdmin(req.user) && d.uploaded_by !== req.user.id) throw forbidden('Only admin or the person who uploaded it can delete this document.');
  await tx(async db => { await db.query('DELETE FROM files WHERE id=$1', [d.file_id]); await audit(db, req.user, 'sale.document_delete', 'sale', d.sale_id, { file: d.original_name }); });
  res.json({ ok: true });
}));

r.delete('/sales/:id', requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const s = await one('SELECT * FROM sales WHERE id=$1', [v.id(req.params.id)]);
  if (!s) throw notFound();
  await tx(async db => {
    const docs = (await db.query('SELECT file_id FROM sale_documents WHERE sale_id=$1', [s.id])).rows.map(x => x.file_id);
    await db.query('DELETE FROM sales WHERE id=$1', [s.id]);
    if (docs.length) await db.query('DELETE FROM files WHERE id = ANY($1::bigint[])', [docs]);
    await audit(db, req.user, 'sale.delete', 'sale', s.id, { invoice: s.invoice_no, total: s.total_amount });
  });
  res.json({ ok: true });
}));

// ── Customers ──
r.get('/customers', ah(async (req, res) => {
  const w = new Where();
  const text = qstr(req.query.q, 80);
  if (text) { const p = likeText(text); w.add(`(lower(c.name) LIKE ? OR COALESCE(c.phone,'') LIKE ? OR lower(COALESCE(c.email,'')) LIKE ?)`, p, p, p); }
  res.json(await many(`SELECT c.id, c.name, c.phone, c.email, c.country, COUNT(t.id)::int AS deals, COALESCE(SUM(t.total_amount),0)::numeric AS total, COALESCE(SUM(t.paid),0)::numeric AS paid,
      COALESCE(SUM(CASE WHEN t.status <> 'Refunded' THEN GREATEST(t.total_amount - t.paid,0) ELSE 0 END),0)::numeric AS outstanding, COALESCE(SUM(t.refunded),0)::numeric AS refunded,
      MAX(t.sale_date) AS last_sale, (array_agg(t.destination ORDER BY t.sale_date DESC))[1] AS destination
    FROM customers c JOIN (${SALES_SQL}) t ON t.customer_id=c.id ${w.sql} GROUP BY c.id ORDER BY total DESC LIMIT 5000`, w.params));
}));

// ── Payments ──
r.get('/payments', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  res.json(await many(`SELECT p.*, s.invoice_no, c.name AS customer_name, s.package, u.full_name AS employee_name, cb.full_name AS entered_by
     FROM sale_payments p JOIN sales s ON s.id=p.sale_id JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.employee_id
     LEFT JOIN users cb ON cb.id=p.created_by WHERE p.payment_date BETWEEN $1 AND $2 ORDER BY p.payment_date DESC, p.id DESC LIMIT 5000`, [from, to]));
}));

r.get('/upcoming', ah(async (_req, res) => {
  res.json((await many(`${ROWS} WHERE t.status NOT IN ('Paid','Refunded') ORDER BY COALESCE(t.next_due, t.due_date) NULLS LAST, t.sale_date LIMIT 5000`)).map(decorate));
}));

r.post('/payments', writeLimit, requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const saleId = v.id(req.body.sale_id, 'Invoice');
  const amount = v.amount(req.body.amount, 'Amount');
  const method = v.oneOf(req.body.method, METHODS, 'Payment method');
  const date = v.date(req.body.payment_date, 'Payment date');
  const reference = v.text(req.body.reference, 'Reference', { max: 120 }) || null;
  const row = await tx(async db => {
    const s = (await db.query(`${SALES_SQL} WHERE s.id=$1 FOR UPDATE OF s`, [saleId])).rows[0];
    if (!s) throw notFound('Invoice not found.');
    const outstanding = sub(s.total_amount, s.paid);
    if (toPaisa(amount) > toPaisa(outstanding)) throw bad(`Amount is more than the outstanding balance (${fromPaisa(toPaisa(outstanding))}).`);
    if (date < s.sale_date) throw bad('Payment date cannot be before the sale date.');
    const p = (await db.query('INSERT INTO sale_payments(sale_id,amount,method,payment_date,reference,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [saleId, amount, method, date, reference, req.user.id])).rows[0];
    await audit(db, req.user, 'payment.create', 'sale', saleId, { amount, date });
    return p;
  });
  res.status(201).json(row);
}));

r.delete('/payments/:id', requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const p = await one('SELECT * FROM sale_payments WHERE id=$1', [v.id(req.params.id)]);
  if (!p) throw notFound();
  await tx(async db => {
    const paidAfter = sub((await db.query('SELECT COALESCE(SUM(amount),0) AS n FROM sale_payments WHERE sale_id=$1', [p.sale_id])).rows[0].n, p.amount);
    const refunded = (await db.query('SELECT COALESCE(SUM(amount),0) AS n FROM sale_refunds WHERE sale_id=$1', [p.sale_id])).rows[0].n;
    if (toPaisa(refunded) > toPaisa(paidAfter)) throw bad('Delete the refund for this invoice first — refunds cannot be more than payments.');
    await db.query('DELETE FROM sale_payments WHERE id=$1', [p.id]);
    await audit(db, req.user, 'payment.delete', 'sale', p.sale_id, { amount: p.amount });
  });
  res.json({ ok: true });
}));

// ── Refunds ──
r.get('/refunds', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  res.json(await many(`SELECT r.*, s.invoice_no, c.name AS customer_name, s.package, u.full_name AS employee_name
     FROM sale_refunds r JOIN sales s ON s.id=r.sale_id JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.employee_id
     WHERE r.refund_date BETWEEN $1 AND $2 ORDER BY r.refund_date DESC, r.id DESC LIMIT 5000`, [from, to]));
}));

r.post('/refunds', writeLimit, requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const saleId = v.id(req.body.sale_id, 'Invoice');
  const amount = v.amount(req.body.amount, 'Refund amount');
  const date = v.date(req.body.refund_date, 'Refund date');
  const reason = v.text(req.body.reason, 'Reason', { required: true, max: 500 });
  const row = await tx(async db => {
    const s = (await db.query(`${SALES_SQL} WHERE s.id=$1 FOR UPDATE OF s`, [saleId])).rows[0];
    if (!s) throw notFound('Invoice not found.');
    const refundable = sub(s.paid, s.refunded);
    if (toPaisa(amount) > toPaisa(refundable)) throw bad(`Refund cannot be more than the amount received and not yet refunded (${refundable}).`);
    if (date < s.sale_date) throw bad('Refund date cannot be before the sale date.');
    const x = (await db.query('INSERT INTO sale_refunds(sale_id,amount,refund_date,reason,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [saleId, amount, date, reason, req.user.id])).rows[0];
    await audit(db, req.user, 'refund.create', 'sale', saleId, { amount, date });
    return x;
  });
  res.status(201).json(row);
}));

r.delete('/refunds/:id', requirePerm('revenue', 'edit'), ah(async (req, res) => {
  const x = await one('SELECT * FROM sale_refunds WHERE id=$1', [v.id(req.params.id)]);
  if (!x) throw notFound();
  await tx(async db => { await db.query('DELETE FROM sale_refunds WHERE id=$1', [x.id]); await audit(db, req.user, 'refund.delete', 'sale', x.sale_id, { amount: x.amount }); });
  res.json({ ok: true });
}));

// ── Forecast ──
r.get('/forecast', ah(async (_req, res) => {
  const rows = await collectionsHistory();
  const pipeline = Number((await one(`SELECT COALESCE(SUM(GREATEST(t.total_amount - t.paid,0)),0)::numeric AS n FROM (${SALES_SQL}) t WHERE t.status NOT IN ('Paid','Refunded')`)).n);
  const scheduled = await many(`WITH pay AS (SELECT sale_id, SUM(amount) AS paid FROM sale_payments GROUP BY sale_id),
      sch AS (SELECT i.*, SUM(i.amount) OVER (PARTITION BY i.sale_id ORDER BY i.seq) AS cum FROM sale_installments i)
    SELECT to_char(sch.due_date,'YYYY-MM') AS month, SUM(LEAST(sch.amount, sch.cum - COALESCE(pay.paid,0)))::numeric AS due
      FROM sch LEFT JOIN pay ON pay.sale_id=sch.sale_id WHERE sch.cum > COALESCE(pay.paid,0) + 0.004 GROUP BY 1 ORDER BY 1`);
  res.json({ history: rows, forecast: forecastFrom(rows), pipeline, scheduled });
}));

export default r;
