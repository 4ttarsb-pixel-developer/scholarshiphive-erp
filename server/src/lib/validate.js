import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import { bad } from './http.js';

const clean = v => (v === undefined || v === null ? '' : String(v)).trim();

export function text(v, label, { required = false, max = 255, min = 0 } = {}) {
  const s = clean(v);
  if (!s) { if (required) throw bad(`${label} is required.`); return ''; }
  if (s.length < min) throw bad(`${label} must be at least ${min} characters.`);
  if (s.length > max) throw bad(`${label} must be at most ${max} characters.`);
  return s;
}

export function optText(v, label, max = 2000) { return text(v, label, { max }) || null; }

export function amount(v, label, { min = 0.01, allowZero = false } = {}) {
  const s = clean(v).replace(/,/g, '');
  if (!s) throw bad(`${label} is required.`);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw bad(`${label} must be a number like 500 or 1250.50 (no text).`);
  const n = Number(s);
  if (!Number.isFinite(n)) throw bad(`${label} is not valid.`);
  if (allowZero ? n < 0 : n < min) throw bad(`${label} must be ${allowZero ? '0 or more' : 'greater than 0'}.`);
  if (n > 999999999999) throw bad(`${label} is too large.`);
  return Math.round(n * 100) / 100;
}

export function percent(v, label) {
  const s = clean(v);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw bad(`${label} must be a number between 0 and 100.`);
  const n = Number(s);
  if (n < 0 || n > 100) throw bad(`${label} must be between 0 and 100.`);
  return n;
}

export function int(v, label, { min = 0, max = 1e9 } = {}) {
  const s = clean(v);
  if (!/^\d+$/.test(s)) throw bad(`${label} must be a whole number.`);
  const n = Number(s);
  if (n < min || n > max) throw bad(`${label} must be between ${min} and ${max}.`);
  return n;
}

export function date(v, label, { required = true } = {}) {
  const s = clean(v);
  if (!s) { if (required) throw bad(`${label} is required.`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw bad(`${label} must be a valid date.`);
  const d = new Date(s + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw bad(`${label} must be a valid date.`);
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) throw bad(`${label} year must be between 2000 and 2100.`);
  return s;
}

export function month(v, label = 'Month') {
  const s = clean(v);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw bad(`${label} must be in YYYY-MM format.`);
  return s;
}

export function oneOf(v, list, label) {
  const s = clean(v);
  if (!list.includes(s)) throw bad(`${label} must be one of: ${list.join(', ')}.`);
  return s;
}

export function email(v, label = 'Email') {
  const s = clean(v).toLowerCase();
  if (!s) throw bad(`${label} is required.`);
  if (s.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw bad(`${label} is not a valid email address.`);
  return s;
}

export const PASSWORD_RULE = 'Password must be at least 12 characters and include a capital letter, a small letter, a number and a special character.';
/** policy = { min, max } from Admin Settings → Security (defaults 12–12). */
export function passwordRule({ min = 12, max = 128 } = {}) {
  const len = min === max ? `exactly ${min} characters` : `${min} to ${max} characters`;
  return `Password must be ${len} and include a capital letter, a small letter, a number and a special character.`;
}
export function password(v, confirm, policy = { min: 12, max: 128 }) {
  const s = v === undefined || v === null ? '' : String(v);
  if (s.length < policy.min || s.length > policy.max || !/[A-Z]/.test(s) || !/[a-z]/.test(s) || !/\d/.test(s) || !/[^A-Za-z0-9]/.test(s) || /\s/.test(s)) throw bad(passwordRule(policy) + ' No spaces.');
  if (confirm !== undefined && s !== String(confirm ?? '')) throw bad('Password and Confirm Password do not match.');
  return s;
}

export function cnic(v, { required = true } = {}) {
  const s = clean(v);
  if (!s) { if (required) throw bad('CNIC number is required.'); return null; }
  if (!/^\d{5}-\d{7}-\d$/.test(s)) throw bad('CNIC must be in the format 12345-1234567-1.');
  return s;
}

export function phone(v, label, { required = true } = {}) {
  const s = clean(v).replace(/[\s()-]/g, '');
  if (!s) { if (required) throw bad(`${label} is required.`); return null; }
  if (!s.startsWith('+')) throw bad(`${label} must start with a country code, e.g. +92.`);
  if (!isValidPhoneNumber(s)) throw bad(`${label} is not a valid number for the selected country code.`);
  return parsePhoneNumberFromString(s).number; // E.164
}

export function url(v, label) {
  const s = clean(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    return u.toString();
  } catch { throw bad(`${label} must be a full link starting with https://`); }
}

export function id(v, label = 'ID') {
  const s = clean(v);
  if (!/^\d{1,15}$/.test(s)) throw bad(`${label} is not valid.`);
  return Number(s);
}

export function json(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { throw bad('Invalid form data.'); }
}

/** Validates "from"/"to" query range; defaults to the current month. */
export function range(q) {
  const today = new Date();
  const first = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1)).toISOString().slice(0, 10);
  const from = q.from ? date(q.from, 'From date') : first;
  const to = q.to ? date(q.to, 'To date') : new Date(Date.UTC(today.getFullYear(), today.getMonth() + 1, 0)).toISOString().slice(0, 10);
  if (from > to) throw bad('"From" date must be before "To" date.');
  return { from, to };
}
