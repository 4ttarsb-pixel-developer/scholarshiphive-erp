// Money helpers — all arithmetic is done in paisa (integers) to avoid floating point errors.
export const toPaisa = n => Math.round(Number(n || 0) * 100);
export const fromPaisa = p => Math.round(p) / 100;
export const sum = (rows, key) => fromPaisa(rows.reduce((a, r) => a + toPaisa(typeof key === 'function' ? key(r) : r[key]), 0));
export const add = (...nums) => fromPaisa(nums.reduce((a, n) => a + toPaisa(n), 0));
export const sub = (a, b) => fromPaisa(toPaisa(a) - toPaisa(b));

/** commission = sales × pct%, rounded once to the nearest paisa (half up). */
export function commission(sales, pct) {
  const bp = Math.round(Number(pct || 0) * 100); // basis points
  return fromPaisa(Math.round((toPaisa(sales) * bp) / 10000));
}

export const pkr = n => 'PKR ' + Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, next };
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export const monthLabel = month => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
};
