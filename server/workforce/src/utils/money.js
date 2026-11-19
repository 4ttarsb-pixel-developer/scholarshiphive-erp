'use strict';
/** Decimal-safe money helpers. All amounts travel as strings with 2 decimals. */
const Decimal = require('decimal.js');

Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

const D = (v) => new Decimal(v === null || v === undefined || v === '' ? 0 : v);
const round2 = (v) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const toMoney = (v) => round2(v).toFixed(2);
const sum = (arr) => arr.reduce((a, x) => a.plus(D(x)), D(0));

/** commission = amount × rate / 100, rounded half-up to 2dp (same rule as the DB CHECK constraint). */
function commissionFor(amount, ratePercent) {
  return round2(D(amount).times(D(ratePercent)).dividedBy(100));
}

function isValidMoneyInput(v, { min = 0, allowZero = true, max = '1000000000' } = {}) {
  if (v === null || v === undefined || v === '') return false;
  if (!/^-?\d+(\.\d{1,2})?$/.test(String(v).trim())) return false;
  const d = D(v);
  if (d.lt(min)) return false;
  if (!allowZero && d.isZero()) return false;
  return d.lte(max);
}

module.exports = { Decimal, D, round2, toMoney, sum, commissionFor, isValidMoneyInput };
