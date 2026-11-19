import express from 'express';
import { one, many, query, tx } from '../db.js';
import { ah, bad, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requirePerm, requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { sum, sub, add, toPaisa, fromPaisa } from '../lib/money.js';
import { METHODS } from './revenue.js';
import { checkOption, readCustom } from '../lib/forms.js';
import { liabilityAt } from '../lib/position.js';

const round2 = n => Math.round(n * 100) / 100;
const PERIODS = { monthly: 12, quarterly: 4, yearly: 1 };

/** Repayment plan: total payable, total interest, monthly installment. */
export function plan(l) {
  const P = Number(l.principal), n = Number(l.term_months), r = Number(l.annual_rate) / 100;
  if (l.interest_type === 'none' || r === 0) {
    return { total_payable: round2(P), total_interest: 0, installment: round2(P / n) };
  }
  if (l.interest_type === 'simple') {
    const interest = round2(P * r * (n / 12));
    return { total_payable: round2(P + interest), total_interest: interest, installment: round2((P + interest) / n) };
  }
  // compound: equal monthly installments (EMI); effective monthly rate from the compounding frequency
  const k = PERIODS[l.compounding] || 12;
  const i = Math.pow(1 + r / k, k / 12) - 1;
  const emi = (P * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
  const total = round2(emi * n);
  return { total_payable: total, total_interest: round2(total - P), installment: round2(emi) };
}

function addMonthsDate(d, m) {
  const [y, mo, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}

export function decorateLiability(l, payments) {
  const p = plan(l);
  const paid = sum(payments, 'amount');
  const outstanding = Math.max(0, sub(p.total_payable, paid));
  const installmentsPaid = p.installment > 0 ? Math.floor(toPaisa(paid) / toPaisa(p.installment)) : 0;
  const next_due = outstanding > 0 ? addMonthsDate(l.start_date, Math.min(installmentsPaid + 1, l.term_months)) : null;
  const end_date = addMonthsDate(l.start_date, l.term_months);
  // share of every payment that is interest (used by the cash-flow profit/loss)
  const interestShare = p.total_payable > 0 ? p.total_interest / p.total_payable : 0;
  return { ...l, ...p, paid, outstanding, progress: p.total_payable > 0 ? Math.min(100, Math.round((paid / p.total_payable) * 1000) / 10) : 0, next_due, end_date, interest_share: interestShare, payments };
}

export function schedule(l) {
  const p = plan(l);
  const rows = [];
  let remaining = toPaisa(p.total_payable);
  for (let k = 1; k <= l.term_months; k++) {
    const amt = k === l.term_months ? remaining : Math.min(remaining, toPaisa(p.installment));
    remaining -= amt;
    rows.push({ no: k, due_date: addMonthsDate(l.start_date, k), amount: fromPaisa(amt), balance_after: fromPaisa(remaining) });
  }
  return rows;
}

/** All liabilities with payments, plus totals; paidInRange = repayments made between from and to. */
/** Loads every loan + repayment once (re-used when many periods are calculated together). */
export async function liabilityData() {
  const [ls, pays] = await Promise.all([
    many('SELECT * FROM liabilities ORDER BY status, start_date DESC, id DESC'),
    many('SELECT * FROM liability_payments ORDER BY payment_date, id'),
  ]);
  const byLoan = new Map();
  for (const p of pays) { if (!byLoan.has(p.liability_id)) byLoan.set(p.liability_id, []); byLoan.get(p.liability_id).push(p); }
  const rows = ls.map(l => decorateLiability(l, byLoan.get(l.id) || []));
  return { rows, pays, byId: new Map(rows.map(r => [r.id, r])) };
}

export async function liabilitySummary(from, to, pre) {
  const { rows, pays, byId } = pre || await liabilityData();
  const inRange = pays.filter(p => (!from || p.payment_date >= from) && (!to || p.payment_date <= to));
  const interestInRange = fromPaisa(inRange.reduce((a, p) => a + Math.round(toPaisa(p.amount) * (byId.get(p.liability_id)?.interest_share || 0)), 0));
  return {
    rows,
    payments: inRange.map(p => ({ ...p, title: byId.get(p.liability_id)?.title, lender: byId.get(p.liability_id)?.lender })),
    totals: {
      principal: sum(rows, 'principal'), total_payable: sum(rows, 'total_payable'), interest: sum(rows, 'total_interest'),
      paid: sum(rows, 'paid'), outstanding: sum(rows, 'outstanding'), active: rows.filter(r => r.status === 'active').length,
    },
    paidInRange: sum(inRange, 'amount'),
    interestInRange,
    receivedInRange: sum(rows.filter(l => (!from || l.start_date >= from) && (!to || l.start_date <= to)), 'principal'),
  };
}

const r = express.Router();
r.use(requireAuth, requirePerm('liabilities', 'view'));

r.get('/', ah(async (req, res) => {
  const { from, to } = v.range(req.query);
  const out = await liabilitySummary(from, to);
  const today = new Date().toISOString().slice(0, 10);
  out.rows = out.rows.map(l => { const x = liabilityAt(l, l.payments, today); return { ...l, current_portion: x.current, non_current_portion: x.nonCurrent }; });
  const all = out.rows;
  let rows = all;
  const q = req.query;
  if (q.category) rows = rows.filter(l => l.category === q.category);
  if (['active', 'closed'].includes(q.status)) rows = rows.filter(l => l.status === q.status);
  if (q.term === 'current') rows = rows.filter(l => l.current_portion > 0);
  if (q.term === 'non_current') rows = rows.filter(l => l.non_current_portion > 0);
  if (['loan', 'payable', 'other'].includes(q.type)) rows = rows.filter(l => l.type === q.type);
  if (q.q) { const t = String(q.q).toLowerCase().slice(0, 80); rows = rows.filter(l => `${l.title} ${l.lender} ${l.category} ${l.sub_category} ${l.reference_no}`.toLowerCase().includes(t)); }
  const cats = new Map();
  for (const l of rows.filter(x => x.outstanding > 0)) cats.set(l.category || 'Other Liabilities', add(cats.get(l.category || 'Other Liabilities') || 0, l.outstanding));
  res.json({
    ...out, rows,
    totals: { ...out.totals, current: sum(all, 'current_portion'), nonCurrent: sum(all, 'non_current_portion') },
    filtered: { count: rows.length, outstanding: sum(rows, 'outstanding'), current: sum(rows, 'current_portion'), nonCurrent: sum(rows, 'non_current_portion') },
    byCategory: [...cats.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
  });
}));

r.get('/:id', ah(async (req, res) => {
  const l = await one('SELECT * FROM liabilities WHERE id=$1', [v.id(req.params.id)]);
  if (!l) throw notFound();
  const pays = await many('SELECT p.*, u.full_name AS entered_by FROM liability_payments p LEFT JOIN users u ON u.id=p.created_by WHERE liability_id=$1 ORDER BY payment_date, id', [l.id]);
  res.json({ ...decorateLiability(l, pays), schedule: schedule(l) });
}));

async function fields(b, cur) {
  const interest_type = v.oneOf(b.interest_type || 'none', ['none', 'simple', 'compound'], 'Interest type');
  const fallback = { loan: 'Bank Loan', payable: 'Trade Payables', other: 'Other Liabilities' }[b.type] || cur?.category; // older API clients send only "type"
  const cat = await checkOption('liabilities', 'category', b.category || fallback, 'Liability category', { keep: cur?.category });
  const subRaw = String(b.sub_category ?? '').trim();
  const f = {
    title: v.text(b.title, 'Title', { required: true, max: 160, min: 3 }),
    category: cat.value,
    sub_category: subRaw ? v.text(subRaw, 'Sub-category', { max: 120 }) : '',
    type: v.oneOf(b.type || cat.option?.meta?.type || cur?.type || 'other', ['loan', 'payable', 'other'], 'Liability type'),
    lender: v.text(b.lender, 'Lender / creditor', { required: true, max: 160, min: 2 }),
    contact_phone: b.contact_phone && String(b.contact_phone).replace(/[^\d]/g, '').length > 4 ? (v.phone(b.contact_phone, 'Lender phone', { required: false }) || '') : '',
    reference_no: v.text(b.reference_no, 'Account / reference no.', { max: 120 }),
    principal: v.amount(b.principal, 'Principal amount'),
    interest_type,
    annual_rate: interest_type === 'none' ? 0 : v.percent(b.annual_rate, 'Annual interest rate'),
    compounding: v.oneOf(b.compounding || 'monthly', ['monthly', 'quarterly', 'yearly'], 'Compounding'),
    start_date: v.date(b.start_date, 'Start date'),
    term_months: v.int(b.term_months, 'Term (months)', { min: 1, max: 600 }),
    purpose: v.text(b.purpose, 'Purpose', { max: 300 }),
    collateral: v.text(b.collateral, 'Collateral / security', { max: 200 }),
    notes: v.text(b.notes, 'Notes', { max: 1000 }),
  };
  if (interest_type !== 'none' && f.annual_rate <= 0) throw bad('Enter the interest rate, or choose "No interest".');
  f.custom_fields = await readCustom('liabilities', b.custom_fields, { existing: cur?.custom_fields });
  return f;
}
const COLS = ['title', 'category', 'sub_category', 'type', 'lender', 'contact_phone', 'reference_no', 'principal', 'interest_type', 'annual_rate', 'compounding', 'start_date', 'term_months', 'purpose', 'collateral', 'notes', 'custom_fields'];
const colVal = (f, c) => (c === 'custom_fields' ? JSON.stringify(f[c] || {}) : f[c]);

r.post('/', requirePerm('liabilities', 'edit'), ah(async (req, res) => {
  const f = await fields(req.body);
  const l = await tx(async db => {
    const x = (await db.query(`INSERT INTO liabilities(${COLS.join(',')},created_by) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(',')},$${COLS.length + 1}) RETURNING *`,
      [...COLS.map(c => colVal(f, c)), req.user.id])).rows[0];
    await audit(db, req.user, 'liability.create', 'liability', x.id, { ...f, custom_fields: undefined });
    return x;
  });
  res.status(201).json(decorateLiability(l, []));
}));

r.put('/:id', requirePerm('liabilities', 'edit'), ah(async (req, res) => {
  const cur = await one('SELECT * FROM liabilities WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const f = await fields(req.body, cur);
  const pays = await many('SELECT amount, payment_date FROM liability_payments WHERE liability_id=$1 ORDER BY payment_date', [cur.id]);
  const paid = sum(pays, 'amount');
  if (plan(f).total_payable < paid) throw bad(`Total payable cannot be less than what is already paid (${paid}).`);
  if (pays.length && pays[0].payment_date < f.start_date) throw bad('Start date cannot be after the first repayment date.');
  const n = COLS.length;
  await query(`UPDATE liabilities SET ${COLS.map((c, i) => `${c}=$${i + 1}`).join(',')}, status=CASE WHEN $${n + 1}::boolean THEN 'closed' ELSE 'active' END, updated_at=NOW() WHERE id=$${n + 2}`,
    [...COLS.map(c => colVal(f, c)), plan(f).total_payable <= paid, cur.id]);
  await audit(null, req.user, 'liability.update', 'liability', cur.id, { ...f, custom_fields: undefined });
  res.json({ ok: true });
}));

r.delete('/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM liabilities WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  await query('DELETE FROM liabilities WHERE id=$1', [cur.id]);
  await audit(null, req.user, 'liability.delete', 'liability', cur.id, { title: cur.title });
  res.json({ ok: true });
}));

r.post('/:id/payments', requirePerm('liabilities', 'edit'), ah(async (req, res) => {
  const amount = v.amount(req.body.amount, 'Payment amount');
  const date = v.date(req.body.payment_date, 'Payment date');
  const method = v.oneOf(req.body.method || 'Bank Transfer', METHODS, 'Payment method');
  const note = v.text(req.body.note, 'Note', { max: 500 });
  const out = await tx(async db => {
    const l = (await db.query('SELECT * FROM liabilities WHERE id=$1 FOR UPDATE', [v.id(req.params.id)])).rows[0];
    if (!l) throw notFound();
    if (date < l.start_date) throw bad('Payment date cannot be before the start date.');
    const pays = (await db.query('SELECT amount FROM liability_payments WHERE liability_id=$1', [l.id])).rows;
    const d = decorateLiability(l, pays);
    if (toPaisa(amount) > toPaisa(d.outstanding)) throw bad(`Payment is more than the outstanding amount (${d.outstanding}).`);
    const p = (await db.query('INSERT INTO liability_payments(liability_id,amount,payment_date,method,note,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [l.id, amount, date, method, note, req.user.id])).rows[0];
    if (toPaisa(add(d.paid, amount)) >= toPaisa(d.total_payable)) await db.query(`UPDATE liabilities SET status='closed' WHERE id=$1`, [l.id]);
    await audit(db, req.user, 'liability.payment', 'liability', l.id, { amount, date });
    return p;
  });
  res.status(201).json(out);
}));

r.delete('/payments/:pid', requireAdmin, ah(async (req, res) => {
  const p = await one('SELECT * FROM liability_payments WHERE id=$1', [v.id(req.params.pid)]);
  if (!p) throw notFound();
  await tx(async db => {
    await db.query('DELETE FROM liability_payments WHERE id=$1', [p.id]);
    await db.query(`UPDATE liabilities SET status='active' WHERE id=$1`, [p.liability_id]);
    await audit(db, req.user, 'liability.payment_delete', 'liability', p.liability_id, { amount: p.amount });
  });
  res.json({ ok: true });
}));

export default r;
