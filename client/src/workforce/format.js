// Consistent PKR formatting (the API sends exact decimal strings).
export const money = (n) => {
  const v = Number(n || 0);
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${neg ? '− ' : ''}PKR ${s}`;
};
export const money2 = (n) => `PKR ${Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const pct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toString()}%`);
export const monthLabel = (m) => {
  if (!m) return '';
  const [y, mo] = String(m).split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
export const shortDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—');
export const fullDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const readableTime = (t) => {
  if (!t) return 'No punch';
  const [h, m] = String(t).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
export const initials = (name) => String(name || '?').split(' ').filter(Boolean).map((x) => x[0]).join('').slice(0, 3).toUpperCase();
export const STATUS_LABEL = {
  UnderReview: 'Under Review', PaidLeave: 'Paid leave', UnpaidLeave: 'Unpaid leave', PendingLeave: 'Leave pending',
  MissingCheckIn: 'Missing check-in', MissingCheckOut: 'Missing check-out', WeeklyOff: 'Weekly off', NotEmployed: 'Not employed',
  FIXED_EMPLOYEE: 'Fixed Employee Commission', MANUAL_PERCENT: 'Manual Percentage',
};
export const label = (s) => STATUS_LABEL[s] || s;
export const todayMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }).slice(0, 7);
export const todayDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });
