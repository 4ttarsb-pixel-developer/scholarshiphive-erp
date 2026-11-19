// Balance-sheet maths: Assets = Liabilities + Owner's equity, at any date and per period.
import { schedule } from '../routes/liabilities.js';
import { toPaisa, fromPaisa } from './money.js';

export const GROUPS = ['day', 'week', 'month', 'quarter', 'year'];
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = s => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const r2 = n => Math.round(n * 100) / 100;
const sumP = (list, fn) => fromPaisa(list.reduce((a, x) => a + toPaisa(fn(x)), 0));

/** Periods between from and to. Too many small periods → the group grows automatically (max 120 bars). */
export function periods(from, to, group = 'month') {
  let g = GROUPS.includes(group) ? group : 'month';
  const days = (parse(to) - parse(from)) / 86400000 + 1;
  const approx = { day: days, week: days / 7, month: days / 30.4, quarter: days / 91, year: days / 365 };
  while (approx[g] > 120 && g !== 'year') g = GROUPS[GROUPS.indexOf(g) + 1];
  const out = [];
  let start = from;
  // align the first bucket to its natural start (Monday / 1st of month / quarter / year)
  const d0 = parse(from);
  if (g === 'week') { const wd = (d0.getUTCDay() + 6) % 7; start = addDays(from, -wd); }
  if (g === 'month') start = `${from.slice(0, 7)}-01`;
  if (g === 'quarter') { const q = Math.floor(d0.getUTCMonth() / 3) * 3; start = `${d0.getUTCFullYear()}-${pad(q + 1)}-01`; }
  if (g === 'year') start = `${from.slice(0, 4)}-01-01`;
  let guard = 0;
  while (start <= to && guard++ < 400) {
    const d = parse(start);
    let end; let label;
    if (g === 'day') { end = start; label = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
    if (g === 'week') { end = addDays(start, 6); label = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
    if (g === 'month') { end = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); label = `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; }
    if (g === 'quarter') { end = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 0))); label = `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`; }
    if (g === 'year') { end = `${d.getUTCFullYear()}-12-31`; label = String(d.getUTCFullYear()); }
    out.push({ key: start, label, start: start < from ? from : start, end: end > to ? to : end });
    start = addDays(end, 1);
  }
  return { group: g, list: out };
}

const assetOn = (a, date) => a.purchase_date <= date && (a.status === 'active' || (a.disposed_date && a.disposed_date > date));

/** Assets held on a date, split by liquidity. */
export function assetsAt(assets, date) {
  const held = assets.filter(a => assetOn(a, date));
  const by = l => sumP(held.filter(a => a.liquidity === l), a => a.current_value);
  const high = by('high'), medium = by('medium'), low = by('low');
  return {
    high, medium, low, total: r2(high + medium + low), count: held.length,
    current: r2(high + medium),
    fixed: sumP(held.filter(a => a.liquidity === 'low' && a.asset_type !== 'intangible'), a => a.current_value),
    intangible: sumP(held.filter(a => a.asset_type === 'intangible'), a => a.current_value),
    cost: sumP(held, a => a.cost),
  };
}

/** One liability on a date: outstanding, and the part due within 12 months (current). */
export function liabilityAt(l, payments, date) {
  if (l.start_date > date) return { outstanding: 0, current: 0, nonCurrent: 0, paid: 0 };
  const paidP = payments.filter(p => p.payment_date <= date).reduce((a, p) => a + toPaisa(p.amount), 0);
  const totalP = toPaisa(l.total_payable);
  const outP = Math.max(0, totalP - paidP);
  const horizon = addDays(date, 365);
  if (!l._sched) Object.defineProperty(l, '_sched', { value: schedule(l), enumerable: false });
  const dueP = l._sched.filter(s => s.due_date <= horizon).reduce((a, s) => a + toPaisa(s.amount), 0);
  const curP = Math.min(outP, Math.max(0, dueP - paidP));
  return { outstanding: fromPaisa(outP), current: fromPaisa(curP), nonCurrent: fromPaisa(outP - curP), paid: fromPaisa(paidP) };
}

export function liabilitiesAt(rows, date) {
  let out = 0, cur = 0, loans = 0;
  const byCategory = new Map();
  for (const l of rows) {
    const x = liabilityAt(l, l.payments || [], date);
    out += toPaisa(x.outstanding); cur += toPaisa(x.current);
    if (l.type === 'loan') loans += toPaisa(x.outstanding);
    const k = l.category || 'Other Liabilities';
    if (x.outstanding > 0) byCategory.set(k, (byCategory.get(k) || 0) + toPaisa(x.outstanding));
  }
  return {
    total: fromPaisa(out), current: fromPaisa(cur), nonCurrent: fromPaisa(out - cur), loans: fromPaisa(loans),
    byCategory: [...byCategory.entries()].map(([name, p]) => ({ name, value: fromPaisa(p) })).sort((a, b) => b.value - a.value),
  };
}

/** Recorded capital entries up to a date, per class (investment adds, drawing subtracts). */
export function capitalAt(entries, date, from) {
  const net = { equity: 0, debt: 0, fixed: 0, working: 0 };
  let inP = 0, outP = 0;
  for (const e of entries) {
    if (e.entry_date > date || (from && e.entry_date < from)) continue;
    const p = toPaisa(e.amount);
    const cls = net[e.capital_class] !== undefined ? e.capital_class : 'equity';
    if (e.type === 'investment') { net[cls] += p; inP += p; } else { net[cls] -= p; outP += p; }
  }
  return { equity: fromPaisa(net.equity), debt: fromPaisa(net.debt), fixed: fromPaisa(net.fixed), working: fromPaisa(net.working), in: fromPaisa(inP), out: fromPaisa(outP), net: fromPaisa(inP - outP) };
}

/** Full position on a date: the accounting equation and the four kinds of capital. */
export function positionAt({ assets, liabilities, capital }, date) {
  const A = assetsAt(assets, date);
  const L = liabilitiesAt(liabilities, date);
  const C = capitalAt(capital, date);
  const equity = r2(A.total - L.total); // owner's equity / net worth
  const contributed = r2(C.equity + C.fixed + C.working); // money owners put in (net), any class except debt
  return {
    date, assets: A, liabilities: L, recorded: C,
    equity: { total: equity, contributed, retained: r2(equity - contributed) },
    capital: {
      fixed: A.fixed + A.intangible > 0 ? r2(A.fixed + A.intangible) : 0, // money locked in long-term assets
      working: r2(A.current - L.current), // current assets − current liabilities
      debt: r2(L.loans + Math.max(0, C.debt)), // borrowed money
      equity: C.equity, // owners' paid-in capital (investment − drawings)
    },
    equation: { assets: A.total, liabilities: L.total, equity, balanced: Math.abs(A.total - (L.total + equity)) < 0.01 },
    ratios: {
      current: L.current > 0 ? r2(A.current / L.current) : null,
      quick: L.current > 0 ? r2(A.high / L.current) : null,
      debtToEquity: equity > 0 ? r2(L.total / equity) : null,
      debtRatio: A.total > 0 ? r2((L.total / A.total) * 100) : null,
    },
  };
}

/** Movements inside a period (what was added / paid / invested between start and end). */
export function flowsIn({ assets, liabilities, capital }, start, end) {
  const inRange = d => d && d >= start && d <= end;
  const bought = assets.filter(a => inRange(a.purchase_date));
  const disposed = assets.filter(a => a.status === 'disposed' && inRange(a.disposed_date));
  const taken = liabilities.filter(l => inRange(l.start_date));
  const repaid = liabilities.flatMap(l => (l.payments || []).filter(p => inRange(p.payment_date)));
  const cap = capitalAt(capital, end, start);
  return {
    assetsBought: sumP(bought, a => a.cost), assetsBoughtCount: bought.length,
    assetsDisposed: sumP(disposed, a => a.disposal_value ?? a.current_value), assetsDisposedCount: disposed.length,
    byLiquidity: Object.fromEntries(['high', 'medium', 'low'].map(l => [l, sumP(bought.filter(a => a.liquidity === l), a => a.cost)])),
    liabilitiesTaken: sumP(taken, l => l.principal), liabilitiesTakenCount: taken.length,
    repayments: sumP(repaid, p => p.amount),
    capitalIn: cap.in, capitalOut: cap.out, capitalNet: cap.net,
  };
}

export const pctChange = (now, prev) => (prev ? r2(((now - prev) / Math.abs(prev)) * 100) : (now ? 100 : 0));
