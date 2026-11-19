// Consistent PKR-first display. Never relabel foreign-currency amounts as PKR.
export const isNativePKR = currency => String(currency || '').trim().toUpperCase() === 'PKR';
export const currencyCode = currency => String(currency || '').trim().toUpperCase();
export const formatAmount = (amount, currency = 'PKR') => {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  const curr = currencyCode(currency);
  const number = Number(amount).toLocaleString('en-PK', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  return curr === 'PKR' ? `Rs. ${number}` : curr ? `${curr} ${number}` : `Currency unavailable · ${number}`;
};
export const displaySpendPKR = (metrics, fallbackCurrency) => {
  if (!metrics) return '—';
  if (metrics.spendPKR != null) return formatAmount(metrics.spendPKR, 'PKR');
  const curr = metrics.currency || fallbackCurrency;
  if (isNativePKR(curr) && metrics.spend != null) return formatAmount(metrics.spend, 'PKR');
  return metrics.spend != null ? 'PKR conversion pending' : '—';
};
export const sourceCurrencyNote = (amount, currency) =>
  amount == null || isNativePKR(currency) || !currencyCode(currency) ? '' : `Original: ${formatAmount(amount, currency)}`;
export const fxStatusDescription = metrics => {
  if (!metrics) return 'No verified reporting data';
  if (metrics.fxStatus === 'native_pkr' || isNativePKR(metrics.currency)) return 'PKR account · conversion not required';
  if (metrics.fxStatus === 'rate_missing') return `Approved FX rate missing for ${metrics.missingRateMonths?.join(', ') || 'selected period'}`;
  if (metrics.fxStatus === 'currency_unknown') return 'Ad account currency not verified';
  if (metrics.spendPKR != null) return 'PKR equivalent uses the approved monthly rate';
  return 'PKR equivalent unavailable';
};
