export const money = (n, { short = false } = {}) => {
  const v = Number(n || 0);
  if (short && Math.abs(v) >= 1e6) return 'PKR ' + (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (short && Math.abs(v) >= 1e3) return 'PKR ' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return 'PKR ' + v.toLocaleString('en-PK', { maximumFractionDigits: 2 });
};
export const num = n => Number(n || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });
export const axisMoney = v => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : a >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : String(v); };

const pad = n => String(n).padStart(2, '0');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const monthStart = (m = thisMonth()) => `${m}-01`;
export const monthEnd = (m = thisMonth()) => { const [y, mo] = m.split('-').map(Number); return `${m}-${pad(new Date(y, mo, 0).getDate())}`; };
export const addMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + mo - 1 + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; };
export const monthName = (m, short) => { if (!m) return ''; const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleString('en-US', short ? { month: 'short' } : { month: 'long', year: 'numeric' }); };
// \u2066 … \u2069 keep a date in left-to-right order when the page is in Urdu (invisible otherwise)
const ltr = s => `\u2066${s}\u2069`;
export const date = d => { if (!d) return '—'; const s = String(d).slice(0, 10); const [y, m, day] = s.split('-').map(Number); if (!y) return s; return ltr(new Date(y, m - 1, day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '\u00a0')); };
export const dateTime = d => (d ? ltr(new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : '—');
export const ago = d => {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 604800) return Math.floor(s / 86400) + ' d ago';
  return date(d);
};
export const titleCase = s => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
export const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// ISO codes for flag images (flagcdn.com) — emoji flags do not show on Windows.
export const FLAG_CODES = { Pakistan: 'pk', UK: 'gb', Canada: 'ca', Italy: 'it', Germany: 'de', Australia: 'au', USA: 'us', Ireland: 'ie', France: 'fr', Hungary: 'hu', Cyprus: 'cy', Turkey: 'tr', Malaysia: 'my', China: 'cn', 'New Zealand': 'nz', UAE: 'ae' };

export const STATUS_TONE = {
  Paid: 'green', 'Partially Paid': 'orange', Pending: 'blue', Overdue: 'red', Refunded: 'purple',
  approved: 'green', pending: 'orange', rejected: 'red', verified: 'green', blocked: 'red', paid: 'green', draft: 'grey', in_process: 'orange', active: 'green', closed: 'grey', disposed: 'grey', open: 'orange', declined: 'red', unverified: 'grey',
};

export const monthInput = d => (d || thisMonth());
/** "Office & Utilities › Office Rent" */
export const catPath = (cat, sub) => (sub ? `${cat} › ${sub}` : cat || '—');
export const STATUS_LABEL = { pending: 'Not approved', approved: 'Approved', rejected: 'Rejected', verified: 'Verified', active: 'Active', paused: 'Paused', ended: 'Ended' };
