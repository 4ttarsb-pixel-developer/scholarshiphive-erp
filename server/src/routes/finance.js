import express from 'express';
import { one, many, query } from '../db.js';
import { ah, bad, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requirePerm, requireAnyPerm, requireAdmin } from '../middleware/auth.js';
import { checkOption, findOption, readCustom } from '../lib/forms.js';
import { periods, positionAt, flowsIn, pctChange } from '../lib/position.js';
import { audit } from '../lib/audit.js';
import { sum, sub, add, addMonths, monthBounds } from '../lib/money.js';
import { liabilitySummary, liabilityData } from './liabilities.js';
import { METHODS } from './revenue.js';

export const ASSET_CATEGORIES = ['Building / Office', 'Land', 'Vehicle', 'Furniture & Fixtures', 'Computers & IT', 'Office Equipment', 'Bank Account', 'Cash in Hand', 'Receivable', 'Security Deposit', 'Software / License', 'Website / Domain', 'Brand / Trademark', 'Investment', 'Other'];
export const LIQUIDITY = ['high', 'medium', 'low'];
const LIQ_LABEL = { high: 'High liquid', medium: 'Medium liquid', low: 'Low / illiquid' };

// ═════════════ Assets ═════════════
export const assets = express.Router();
assets.use(requireAuth, requirePerm('assets', 'view'));

const groupBy = (list, key, val = 'current_value') => {
  const m = new Map();
  for (const a of list) m.set(a[key] || '—', add(m.get(a[key] || '—') || 0, a[val]));
  return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
};

/** Assets register with filters: liquidity, status, category, date range (purchase date), search. */
assets.get('/', ah(async (req, res) => {
  const q = req.query;
  const where = []; const params = [];
  const add$ = (sql, val) => { params.push(val); where.push(sql.replace('$?', `$${params.length}`)); };
  if (LIQUIDITY.includes(q.liquidity)) add$('a.liquidity = $?', q.liquidity);
  if (['active', 'disposed'].includes(q.status)) add$('a.status = $?', q.status);
  if (['fixed', 'current', 'intangible'].includes(q.asset_type)) add$('a.asset_type = $?', q.asset_type);
  if (q.category) add$('a.category = $?', String(q.category).slice(0, 120));
  if (q.from) add$('a.purchase_date >= $?', v.date(q.from, 'From date'));
  if (q.to) add$('a.purchase_date <= $?', v.date(q.to, 'To date'));
  if (q.q) add$(`(a.name ILIKE $? OR a.category ILIKE $? OR a.sub_category ILIKE $? OR a.serial_no ILIKE $? OR a.location ILIKE $?)`.replace(/\$\?/g, `$${params.length + 1}`), `%${String(q.q).slice(0, 80)}%`);
  const rows = await many(`SELECT a.*, u.full_name AS entered_by FROM assets a LEFT JOIN users u ON u.id=a.created_by
                           ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.status, a.purchase_date DESC, a.id DESC LIMIT 5000`, params);
  const active = rows.filter(a => a.status === 'active');
  res.json({
    rows, categories: ASSET_CATEGORIES,
    totals: { count: active.length, cost: sum(active, 'cost'), value: sum(active, 'current_value'), depreciation: sub(sum(active, 'cost'), sum(active, 'current_value')), disposed: rows.length - active.length },
    byLiquidity: LIQUIDITY.map(l => ({ id: l, name: LIQ_LABEL[l], value: sum(active.filter(a => a.liquidity === l), 'current_value'), count: active.filter(a => a.liquidity === l).length })),
    byCategory: groupBy(active, 'category'), byType: groupBy(active, 'asset_type'), bySub: groupBy(active, 'sub_category').filter(x => x.name !== '—' && x.name !== ''),
  });
}));

assets.get('/:id', ah(async (req, res) => {
  const a = await one('SELECT a.*, u.full_name AS entered_by FROM assets a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1', [v.id(req.params.id)]);
  if (!a) throw notFound();
  res.json(a);
}));

async function assetFields(b, cur) {
  // older screens / API clients send only a category → work out its liquidity from the list
  let liq = b.liquidity;
  if (!liq && b.category) {
    const o = await one(`SELECT p.value FROM form_field_options o JOIN form_fields f ON f.id=o.field_id JOIN form_field_options p ON p.id=o.parent_option_id
                         WHERE f.form_key='assets' AND f.field_key='category' AND o.value=$1 LIMIT 1`, [String(b.category)]);
    liq = o?.value || cur?.liquidity || 'low';
  }
  const liquidity = v.oneOf(liq, LIQUIDITY, 'Liquidity');
  const cat = await checkOption('assets', 'category', b.category, 'Category', { parent: liquidity, keep: cur?.liquidity === liquidity ? cur?.category : undefined });
  const subRaw = String(b.sub_category ?? '').trim();
  let sub_category = '';
  if (subRaw) {
    const known = await findOption('assets', 'sub_category', subRaw, cat.value);
    if (!known && subRaw !== cur?.sub_category) sub_category = v.text(subRaw, 'Sub-category', { max: 120 }); // "Other → write it" is allowed
    else sub_category = subRaw;
  }
  const status = v.oneOf(b.status || 'active', ['active', 'disposed'], 'Status');
  const cost = v.amount(b.cost, 'Cost', { allowZero: true });
  const current_value = b.current_value === '' || b.current_value === undefined || b.current_value === null ? cost : v.amount(b.current_value, 'Current value', { allowZero: true });
  const purchase_date = v.date(b.purchase_date, 'Purchase / acquired date');
  const today = new Date().toISOString().slice(0, 10);
  if (purchase_date > today) throw bad('Purchase date cannot be in the future.');
  const f = {
    name: v.text(b.name, 'Asset name', { required: true, max: 160, min: 2 }),
    liquidity, category: cat.value, sub_category,
    asset_type: v.oneOf(b.asset_type || cat.option?.meta?.asset_type || (liquidity === 'low' ? 'fixed' : 'current'), ['fixed', 'current', 'intangible'], 'Asset type'),
    purchase_date, cost, current_value,
    quantity: b.quantity === '' || b.quantity === undefined ? 1 : v.int(b.quantity, 'Quantity', { min: 1, max: 100000 }),
    depreciation_rate: b.depreciation_rate === '' || b.depreciation_rate === undefined || b.depreciation_rate === null ? 0 : v.percent(b.depreciation_rate, 'Depreciation %'),
    location: v.text(b.location, 'Location', { max: 120 }),
    custodian: v.text(b.custodian, 'Custodian', { max: 120 }),
    serial_no: v.text(b.serial_no, 'Serial / reference no.', { max: 120 }),
    vendor: v.text(b.vendor, 'Vendor', { max: 160 }),
    payment_method: b.payment_method ? v.oneOf(b.payment_method, METHODS, 'Payment method') : '',
    reference_no: v.text(b.reference_no, 'Payment reference', { max: 120 }),
    warranty_until: v.date(b.warranty_until, 'Warranty until', { required: false }),
    notes: v.text(b.notes, 'Notes', { max: 1000 }),
    status,
    disposed_date: status === 'disposed' ? v.date(b.disposed_date || today, 'Disposed / sold date') : null,
    disposal_value: status === 'disposed' && b.disposal_value !== '' && b.disposal_value !== undefined && b.disposal_value !== null ? v.amount(b.disposal_value, 'Sold for', { allowZero: true }) : null,
  };
  if (f.warranty_until && f.warranty_until < f.purchase_date) throw bad('Warranty date cannot be before the purchase date.');
  if (f.disposed_date && f.disposed_date < f.purchase_date) throw bad('Disposed date cannot be before the purchase date.');
  if (f.payment_method && f.payment_method !== 'Cash' && b.require_reference && !f.reference_no) throw bad('Payment reference is required for non-cash payments.');
  f.custom_fields = await readCustom('assets', b.custom_fields, { existing: cur?.custom_fields });
  return f;
}
const ASSET_COLS = ['name', 'liquidity', 'category', 'sub_category', 'asset_type', 'purchase_date', 'cost', 'current_value', 'quantity', 'depreciation_rate', 'location', 'custodian', 'serial_no', 'vendor', 'payment_method', 'reference_no', 'warranty_until', 'notes', 'status', 'disposed_date', 'disposal_value', 'custom_fields'];
const colVal = (f, c) => (c === 'custom_fields' ? JSON.stringify(f[c] || {}) : f[c]);

// Assets are permanent records: only admin (or "assets: edit") can add; only admin can change or delete.
assets.post('/', requirePerm('assets', 'edit'), ah(async (req, res) => {
  const f = await assetFields(req.body);
  const a = await one(`INSERT INTO assets(${ASSET_COLS.join(',')},created_by) VALUES (${ASSET_COLS.map((_, i) => `$${i + 1}`).join(',')},$${ASSET_COLS.length + 1}) RETURNING *`,
    [...ASSET_COLS.map(c => colVal(f, c)), req.user.id]);
  await audit(null, req.user, 'asset.create', 'asset', a.id, { name: f.name, liquidity: f.liquidity, category: f.category, cost: f.cost });
  res.status(201).json(a);
}));

assets.put('/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM assets WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const f = await assetFields(req.body, cur);
  await query(`UPDATE assets SET ${ASSET_COLS.map((c, i) => `${c}=$${i + 1}`).join(',')}, updated_at=NOW() WHERE id=$${ASSET_COLS.length + 1}`, [...ASSET_COLS.map(c => colVal(f, c)), cur.id]);
  await audit(null, req.user, 'asset.update', 'asset', cur.id, { name: f.name, liquidity: f.liquidity, category: f.category, cost: f.cost, status: f.status });
  res.json({ ok: true });
}));

assets.delete('/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM assets WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  await query('DELETE FROM assets WHERE id=$1', [cur.id]);
  await audit(null, req.user, 'asset.delete', 'asset', cur.id, { name: cur.name });
  res.json({ ok: true });
}));

// ═════════════ Capital (fixed / working / debt / equity entries) ═════════════
export const capital = express.Router();
capital.use(requireAuth, requireAnyPerm(['cashflow', 'assets'], 'view'));
capital.get('/', ah(async (req, res) => {
  const where = []; const params = [];
  if (['equity', 'debt', 'fixed', 'working'].includes(req.query.class)) { params.push(req.query.class); where.push(`c.capital_class=$${params.length}`); }
  if (req.query.from) { params.push(v.date(req.query.from, 'From date')); where.push(`c.entry_date >= $${params.length}`); }
  if (req.query.to) { params.push(v.date(req.query.to, 'To date')); where.push(`c.entry_date <= $${params.length}`); }
  const rows = await many(`SELECT c.*, u.full_name AS entered_by FROM capital_entries c LEFT JOIN users u ON u.id=c.created_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY entry_date DESC, id DESC`, params);
  const inv = sum(rows.filter(r => r.type === 'investment'), 'amount');
  const dr = sum(rows.filter(r => r.type === 'drawing'), 'amount');
  const byClass = ['equity', 'debt', 'fixed', 'working'].map(k => {
    const list = rows.filter(r => r.capital_class === k);
    return { id: k, in: sum(list.filter(r => r.type === 'investment'), 'amount'), out: sum(list.filter(r => r.type === 'drawing'), 'amount'), count: list.length };
  }).map(x => ({ ...x, net: sub(x.in, x.out) }));
  const parties = new Map();
  for (const r0 of rows) { const k = r0.party || '—'; parties.set(k, add(parties.get(k) || 0, r0.type === 'investment' ? r0.amount : -r0.amount)); }
  res.json({ rows, totals: { investment: inv, drawing: dr, net: sub(inv, dr) }, byClass, byParty: [...parties.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value) });
}));

async function capitalFields(b, cur) {
  const f = {
    capital_class: v.oneOf(b.capital_class || 'equity', ['equity', 'debt', 'fixed', 'working'], 'Capital type'),
    type: v.oneOf(b.type, ['investment', 'drawing'], 'Movement'),
    source_type: (await checkOption('capital', 'source_type', b.source_type || 'Owner', 'Source', { keep: cur?.source_type })).value,
    amount: v.amount(b.amount, 'Amount'),
    entry_date: v.date(b.entry_date, 'Date'),
    party: v.text(b.party, 'Owner / partner / investor name', { required: true, min: 2, max: 160 }),
    share_pct: b.share_pct === '' || b.share_pct === undefined || b.share_pct === null ? null : v.percent(b.share_pct, 'Ownership share %'),
    method: b.method ? v.oneOf(b.method, METHODS, 'Payment method') : '',
    reference_no: v.text(b.reference_no, 'Reference no.', { max: 120 }),
    note: v.text(b.note, 'Note', { max: 500 }),
  };
  if (f.entry_date > new Date().toISOString().slice(0, 10)) throw bad('Date cannot be in the future.');
  f.custom_fields = await readCustom('capital', b.custom_fields, { existing: cur?.custom_fields });
  return f;
}
const CAP_COLS = ['capital_class', 'type', 'source_type', 'amount', 'entry_date', 'party', 'share_pct', 'method', 'reference_no', 'note', 'custom_fields'];

capital.post('/', requireAdmin, ah(async (req, res) => {
  const f = await capitalFields(req.body);
  const row = await one(`INSERT INTO capital_entries(${CAP_COLS.join(',')},created_by) VALUES (${CAP_COLS.map((_, i) => `$${i + 1}`).join(',')},$${CAP_COLS.length + 1}) RETURNING *`, [...CAP_COLS.map(c => colVal(f, c)), req.user.id]);
  await audit(null, req.user, 'capital.create', 'capital', row.id, { ...f, custom_fields: undefined });
  res.status(201).json(row);
}));
capital.put('/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM capital_entries WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const f = await capitalFields(req.body, cur);
  await query(`UPDATE capital_entries SET ${CAP_COLS.map((c, i) => `${c}=$${i + 1}`).join(',')} WHERE id=$${CAP_COLS.length + 1}`, [...CAP_COLS.map(c => colVal(f, c)), cur.id]);
  await audit(null, req.user, 'capital.update', 'capital', cur.id, { ...f, custom_fields: undefined });
  res.json({ ok: true });
}));
capital.delete('/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM capital_entries WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  await query('DELETE FROM capital_entries WHERE id=$1', [cur.id]);
  await audit(null, req.user, 'capital.delete', 'capital', cur.id, { amount: cur.amount });
  res.json({ ok: true });
}));

// ═════════════ Balance sheet: Assets = Liabilities + Equity, trends & capital ═════════════
export const finance = express.Router();
finance.use(requireAuth, requireAnyPerm(['assets', 'liabilities', 'cashflow'], 'view'));

export async function books() {
  const [assetRows, pre, cap] = await Promise.all([
    many('SELECT id, name, liquidity, category, sub_category, asset_type, purchase_date, cost, current_value, status, disposed_date, disposal_value FROM assets'),
    liabilityData(),
    many('SELECT id, type, capital_class, amount, entry_date, party FROM capital_entries'),
  ]);
  return { assets: assetRows, liabilities: pre.rows, capital: cap };
}

/** ?from&to&group=day|week|month|quarter|year → position at each period end + movements + up/down vs previous period. */
finance.get('/overview', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  const b = await books();
  const { group, list } = periods(from, to, req.query.group);
  const series = list.map(p => {
    const pos = positionAt(b, p.end);
    const fl = flowsIn(b, p.start, p.end);
    return {
      key: p.key, label: p.label, start: p.start, end: p.end,
      high: pos.assets.high, medium: pos.assets.medium, low: pos.assets.low, assets: pos.assets.total,
      currentLiab: pos.liabilities.current, nonCurrentLiab: pos.liabilities.nonCurrent, liabilities: pos.liabilities.total,
      equity: pos.equity.total, working: pos.capital.working, fixedCap: pos.capital.fixed, debtCap: pos.capital.debt, equityCap: pos.capital.equity,
      ...fl,
    };
  });
  series.forEach((s, i) => {
    const prev = series[i - 1];
    s.assetsChange = prev ? pctChange(s.assets, prev.assets) : 0;
    s.liabilitiesChange = prev ? pctChange(s.liabilities, prev.liabilities) : 0;
    s.equityChange = prev ? pctChange(s.equity, prev.equity) : 0;
  });
  const start = positionAt(b, addDay(from, -1));
  const end = positionAt(b, to);
  const flows = flowsIn(b, from, to);
  const diff = (a, c) => ({ start: a, end: c, change: sub(c, a), pct: pctChange(c, a) });
  res.json({
    range: { from, to }, group, series, position: end, flows,
    change: {
      assets: diff(start.assets.total, end.assets.total), high: diff(start.assets.high, end.assets.high), medium: diff(start.assets.medium, end.assets.medium), low: diff(start.assets.low, end.assets.low),
      liabilities: diff(start.liabilities.total, end.liabilities.total), current: diff(start.liabilities.current, end.liabilities.current), nonCurrent: diff(start.liabilities.nonCurrent, end.liabilities.nonCurrent),
      equity: diff(start.equity.total, end.equity.total), working: diff(start.capital.working, end.capital.working), fixed: diff(start.capital.fixed, end.capital.fixed),
      debt: diff(start.capital.debt, end.capital.debt), equityCap: diff(start.capital.equity, end.capital.equity),
    },
    liquidityCategories: ['high', 'medium', 'low'].map(l => ({ id: l, name: LIQ_LABEL[l], items: groupBy(b.assets.filter(a => a.liquidity === l && a.status === 'active' && a.purchase_date <= to), 'category') })),
  });
}));

const addDay = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ═════════════ Cash flow manager ═════════════
/** Every accounting element for a date range. */
export async function periodFigures(from, to, pre) {
  // One round-trip for all the totals (fast even when the database is far away).
  const n = await one(`SELECT
      (SELECT COALESCE(SUM(amount),0) FROM sale_payments WHERE payment_date BETWEEN $1 AND $2)::numeric AS collected,
      (SELECT COALESCE(SUM(amount),0) FROM sale_refunds WHERE refund_date BETWEEN $1 AND $2)::numeric AS refunds,
      (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE sale_date BETWEEN $1 AND $2)::numeric AS sales_booked,
      ((SELECT COALESCE(SUM(amount),0) FROM expenses WHERE status='approved' AND NOT is_petty_topup AND expense_date BETWEEN $1 AND $2)
       + (SELECT COALESCE(SUM(amount_pkr),0) FROM marketing.expenses WHERE status='Approved' AND occurred_on BETWEEN $1 AND $2))::numeric AS operating,
      (SELECT COALESCE(SUM(amount),0) FROM petty_cash_entries WHERE status<>'rejected' AND entry_date BETWEEN $1 AND $2)::numeric AS petty,
      ((SELECT COALESCE(SUM(pm.snap_net),0) FROM payroll_months pm WHERE pm.status IN ('approved','paid') AND pm.month >= $3 AND pm.month <= $4)
       + (SELECT COALESCE(SUM(pr.net_salary),0) FROM workforce.payroll_records pr
            JOIN workforce.payroll_periods pp ON pp.id=pr.period_id JOIN workforce.employees e ON e.id=pr.employee_id
           WHERE pr.status IN ('Approved','Paid') AND pp.period_month >= ($3 || '-01')::date AND pp.period_month <= ($4 || '-01')::date
             AND NOT EXISTS (SELECT 1 FROM payroll_months old_pm JOIN users old_u ON old_u.id=old_pm.user_id
                              WHERE old_pm.month=to_char(pp.period_month,'YYYY-MM') AND old_pm.status IN ('approved','paid')
                                AND upper(old_u.employee_code)=upper(e.employee_code))))::numeric AS salaries_accrued,
      ((SELECT COALESCE(SUM(pm.snap_net),0) FROM payroll_months pm WHERE pm.status='paid' AND pm.paid_at::date BETWEEN $1 AND $2)
       + (SELECT COALESCE(SUM(pay.amount),0) FROM workforce.payment_records pay
            JOIN workforce.payroll_records pr ON pr.id=pay.payroll_record_id JOIN workforce.payroll_periods pp ON pp.id=pr.period_id
            JOIN workforce.employees e ON e.id=pr.employee_id
           WHERE pr.status='Paid' AND pay.payment_date BETWEEN $1 AND $2
             AND NOT EXISTS (SELECT 1 FROM payroll_months old_pm JOIN users old_u ON old_u.id=old_pm.user_id
                              WHERE old_pm.month=to_char(pp.period_month,'YYYY-MM') AND old_pm.status IN ('approved','paid')
                                AND upper(old_u.employee_code)=upper(e.employee_code))))::numeric AS salaries_paid,
      (SELECT COALESCE(SUM(cost),0) FROM assets WHERE purchase_date BETWEEN $1 AND $2)::numeric AS asset_purchases,
      (SELECT COALESCE(SUM(amount),0) FROM capital_entries WHERE type='investment' AND entry_date BETWEEN $1 AND $2)::numeric AS investment,
      (SELECT COALESCE(SUM(amount),0) FROM capital_entries WHERE type='drawing' AND entry_date BETWEEN $1 AND $2)::numeric AS drawing`,
  [from, to, from.slice(0, 7), to.slice(0, 7)]);
  const collected = Number(n.collected); const refunds = Number(n.refunds); const salesBooked = Number(n.sales_booked);
  const operating = Number(n.operating); const petty = Number(n.petty); const salariesAccrued = Number(n.salaries_accrued);
  const salariesPaid = Number(n.salaries_paid); const assetPurchases = Number(n.asset_purchases); const investment = Number(n.investment); const drawing = Number(n.drawing);
  const loans = await liabilitySummary(from, to, pre);

  const revenue = sub(collected, refunds);
  const expensesTotal = add(operating, petty, salariesAccrued, loans.interestInRange);
  const netProfit = sub(revenue, expensesTotal);
  const inflow = add(collected, investment, loans.receivedInRange);
  const outflow = add(refunds, operating, petty, salariesPaid, loans.paidInRange, assetPurchases, drawing);
  return {
    revenue: { salesBooked, collected, refunds, net: revenue },
    expenses: { operating, petty, salaries: salariesAccrued, loanInterest: loans.interestInRange, total: expensesTotal },
    profit: { net: netProfit, margin: revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0 },
    cash: {
      inflow, outflow, net: sub(inflow, outflow),
      in: { collected, investment, loansReceived: loans.receivedInRange },
      out: { refunds, operating, petty, salariesPaid, loanRepayments: loans.paidInRange, assetPurchases, drawing },
    },
  };
}

export const cashflow = express.Router();
cashflow.use(requireAuth, requirePerm('cashflow', 'view'));
cashflow.get('/', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  const pre = await liabilityData();
  const period = await periodFigures(from, to, pre);
  // 12 months ending at "to" (run side by side — the pool limits how many at once)
  const end = to.slice(0, 7);
  const monthly = await Promise.all(Array.from({ length: 12 }, (_, k) => addMonths(end, k - 11)).map(async m => {
    const { from: f, next } = monthBounds(m);
    const last = new Date(new Date(next + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    const p = await periodFigures(f, last, pre);
    return { month: m, inflow: p.cash.inflow, outflow: p.cash.outflow, net: p.cash.net, revenue: p.revenue.net, expenses: p.expenses.total, profit: p.profit.net };
  }));
  // position (all-time up to "to")
  const assetRows = await many(`SELECT current_value FROM assets WHERE status='active' AND purchase_date <= $1`, [to]);
  const loans = await liabilitySummary(null, to, pre);
  const cap = await one(`SELECT COALESCE(SUM(CASE WHEN type='investment' THEN amount ELSE -amount END),0)::numeric AS n FROM capital_entries WHERE entry_date <= $1`, [to]);
  const allTime = await periodFigures('2000-01-01', to, pre);
  const assetsTotal = sum(assetRows, 'current_value');
  res.json({
    range: { from, to }, period, monthly,
    position: {
      assets: assetsTotal, liabilities: loans.totals.outstanding, capital: Number(cap.n),
      retained: allTime.profit.net, netWorth: sub(assetsTotal, loans.totals.outstanding), cashFromOperations: allTime.cash.net,
    },
  });
}));
