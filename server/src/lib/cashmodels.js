// Cash management models (same formulas are used in the browser: client/src/lib/cashmodels.js).
//  • Baumol (EOQ for cash):   C* = √(2·T·F / i)
//  • Miller–Orr:              spread = 3·(¾·F·σ² / i_daily)^(1/3),  Z = L + spread/3,  H = L + spread
//  • Cash discount vs interest: cost of NOT taking a discount = d/(1−d) × 365/(N−D)
const r2 = n => Math.round(Number(n || 0) * 100) / 100;

/** T = cash needed per year, F = cost per transfer / sale of securities, rate = annual interest % (opportunity cost). */
export function baumol(T, F, rate) {
  const i = Number(rate) / 100;
  if (!(T > 0) || !(F > 0) || !(i > 0)) return null;
  const C = Math.sqrt((2 * T * F) / i);
  const transfers = T / C;
  const txCost = transfers * F;
  const holdCost = (C / 2) * i;
  return { optimal: r2(C), transfers: r2(transfers), daysBetween: r2(365 / transfers), averageCash: r2(C / 2), transactionCost: r2(txCost), holdingCost: r2(holdCost), totalCost: r2(txCost + holdCost) };
}

/** Total cost curve around the optimum (for the chart). */
export function baumolCurve(T, F, rate, points = 24) {
  const b = baumol(T, F, rate);
  if (!b) return [];
  const i = Number(rate) / 100;
  const out = [];
  for (let k = 1; k <= points; k++) {
    const C = (b.optimal * 2.5 * k) / points;
    out.push({ cash: r2(C), transaction: r2((T / C) * F), holding: r2((C / 2) * i), total: r2((T / C) * F + (C / 2) * i) });
  }
  return out;
}

/** L = lower limit (minimum cash), F = cost per transfer, variance = σ² of DAILY net cash flows, rate = annual %. */
export function millerOrr(L, F, variance, rate) {
  const iDay = Number(rate) / 100 / 365;
  if (!(F > 0) || !(variance > 0) || !(iDay > 0)) return null;
  const spread = 3 * Math.cbrt((0.75 * F * variance) / iDay);
  const low = Number(L) || 0;
  return { lower: r2(low), returnPoint: r2(low + spread / 3), upper: r2(low + spread), spread: r2(spread), dailyRate: iDay };
}

/** What Miller–Orr says to do with today's cash. */
export function millerOrrAction(cash, m) {
  if (!m) return { action: 'none', amount: 0 };
  if (cash > m.upper) return { action: 'invest', amount: r2(cash - m.returnPoint) };
  if (cash < m.lower) return { action: 'raise', amount: r2(m.returnPoint - cash) };
  return { action: 'hold', amount: 0 };
}

/** d% discount if paid within D days, otherwise full amount after N days. Returns annualised cost of skipping the discount. */
export function discountCost(discountPct, discountDays, netDays) {
  const d = Number(discountPct) / 100;
  const gap = Number(netDays) - Number(discountDays);
  if (!(d > 0) || d >= 1 || !(gap > 0)) return null;
  const simple = (d / (1 - d)) * (365 / gap) * 100;
  const effective = (Math.pow(1 + d / (1 - d), 365 / gap) - 1) * 100;
  return { simple: r2(simple), effective: r2(effective) };
}

/** Mean / variance / standard deviation of a list of numbers (population). */
export function stats(list) {
  const n = list.length;
  if (!n) return { n: 0, mean: 0, variance: 0, stdev: 0 };
  const mean = list.reduce((a, b) => a + b, 0) / n;
  const variance = list.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { n, mean: r2(mean), variance: r2(variance), stdev: r2(Math.sqrt(variance)) };
}
