'use strict';
/**
 * Timezone helpers (no external dependency). Business dates are evaluated in the
 * configured IANA timezone (default Asia/Karachi). Works for zones with DST too.
 */

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return fmtCache.get(tz);
}

/** Parts of an instant as seen in tz. */
function zonedParts(instant, tz) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const parts = {};
  for (const p of formatter(tz).formatToParts(d)) parts[p.type] = p.value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: wd,
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second),
  };
}

/** Offset (ms) of tz from UTC at the given instant. */
function tzOffsetMs(instant, tz) {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const t = (instant instanceof Date ? instant : new Date(instant)).getTime();
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Convert a wall-clock date + time in tz to a UTC Date. */
function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss] = String(timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  let off = tzOffsetMs(new Date(guess), tz);
  let result = guess - off;
  const off2 = tzOffsetMs(new Date(result), tz);
  if (off2 !== off) result = guess - off2;
  return new Date(result);
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 'YYYY-MM' or 'YYYY-MM-DD' -> first day of month 'YYYY-MM-01'. */
function monthStart(value) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}/.test(s)) throw new Error(`Invalid month: ${value}`);
  const [y, m] = s.split('-').map(Number);
  if (m < 1 || m > 12) throw new Error(`Invalid month: ${value}`);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`;
}

function monthEnd(monthFirst) {
  const [y, m] = monthFirst.split('-').map(Number);
  return `${monthFirst.slice(0, 8)}${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

function eachDate(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

function todayInTz(tz) { return zonedParts(new Date(), tz).date; }
function currentMonthInTz(tz) { return monthStart(todayInTz(tz)); }

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function isValidTime(s) { return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(s)); }

function minutesOfTime(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

module.exports = {
  zonedParts, zonedToUtc, tzOffsetMs, addDays, weekdayOf, daysInMonth, monthStart, monthEnd,
  eachDate, todayInTz, currentMonthInTz, isValidDate, isValidTime, minutesOfTime,
};
