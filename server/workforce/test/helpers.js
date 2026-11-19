'use strict';
process.env.NODE_ENV = 'test';
const request = require('supertest');
const knex = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/utils/crypto');
const { zonedToUtc, addDays, eachDate, weekdayOf, monthStart, todayInTz, monthEnd } = require('../src/utils/time');
const crypto = require('crypto');

// Close the pool when each test file finishes so the runner does not wait for idle timeouts.
require('node:test').after(async () => { await knex.destroy(); });

const TZ = 'Asia/Karachi';
const app = createApp();
const today = () => todayInTz(TZ);
const currentMonth = () => monthStart(today());
const prevMonth = (n = 1) => { let m = currentMonth(); for (let i = 0; i < n; i += 1) m = monthStart(addDays(m, -1)); return m; };
const ym = (m) => m.slice(0, 7);

let counter = 0;
const uniq = (p = 'T') => `${p}${Date.now().toString(36).slice(-4)}${(counter += 1)}`.toUpperCase();

async function ensureUser(username, password, roleCodes, extra = {}) {
  let u = await knex('users').whereRaw('lower(username)=lower(?)', [username]).first();
  if (!u) [u] = await knex('users').insert({ username, password_hash: hashPassword(password), full_name: extra.fullName || username, attendance_role: extra.attendanceRole || 'Staff', employee_id: extra.employeeId || null }).returning('*');
  for (const code of roleCodes) {
    const r = await knex('roles').where({ code }).first();
    await knex('user_roles').insert({ user_id: u.id, role_id: r.id }).onConflict(['user_id', 'role_id']).ignore();
  }
  return u;
}

/** Login through the public API and return a Bearer-token agent helper. */
async function login(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password, client: 'mobile' });
  if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token = res.body.token;
  const wrap = (m) => (url) => request(app)[m](url).set('Authorization', `Bearer ${token}`);
  return { token, user: res.body.user, get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), del: wrap('delete') };
}

let adminCache = null;
async function admin() {
  if (adminCache) return adminCache;
  await ensureUser('test.admin', 'Admin#12345', ['ADMIN'], { fullName: 'Test Admin', attendanceRole: 'Owner' });
  adminCache = await login('test.admin', 'Admin#12345');
  return adminCache;
}

/** Create an employee via the API (optionally with a login). */
async function createEmployee({ code = uniq('E'), name, base = '60000', rate, username, password = 'Emp#12345', joiningDate, shiftName } = {}) {
  const a = await admin();
  let shiftId = null;
  if (shiftName) shiftId = (await knex('shifts').whereRaw('lower(name)=lower(?)', [shiftName]).first()).id;
  const body = { employeeCode: code, fullName: name || `Test ${code}`, department: 'Testing', designation: 'Tester', joiningDate: joiningDate || monthStart(addDays(prevMonth(2), -1)), baseSalary: base, shiftId };
  if (rate !== undefined) body.fixedCommissionPercent = rate;
  if (username) { body.username = username; body.password = password; }
  const res = await a.post('/api/employees').send(body);
  if (res.status !== 201) throw new Error(`createEmployee failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (username) await knex('users').where({ username }).update({ must_change_password: false });
  return res.body;
}

/** Insert historic app check-ins (as the Attendance app would have recorded them). */
async function insertSessions(employeeId, month, { skip = [], times = {}, defaultIn = '09:00', defaultOut = '18:00', noCheckout = [] } = {}) {
  const user = await knex('users').where({ employee_id: employeeId }).first()
    || await ensureUser(`att_${employeeId}_${uniq('u').toLowerCase()}`, 'x'.repeat(10), ['EMPLOYEE'], { employeeId });
  const end = monthEnd(month) < today() ? monthEnd(month) : addDays(today(), -1);
  const rows = [];
  for (const d of eachDate(month, end)) {
    if (weekdayOf(d) === 0 || skip.includes(d)) continue;
    const t = times[d] || defaultIn;
    const missing = noCheckout.includes(d);
    rows.push({
      session_id: crypto.randomUUID(), user_id: user.id, employee_id: employeeId, business_date: d, check_in_at: zonedToUtc(d, t, TZ),
      check_out_at: missing ? null : zonedToUtc(d, defaultOut, TZ), is_active: false, closed_reason: missing ? 'superseded_missing_checkout' : 'checkout', source: 'test',
    });
  }
  if (rows.length) await knex('attendance_sessions').insert(rows);
  return rows;
}

/** Working (Mon–Sat) dates of a month that are already in the past. */
function workingDates(month) {
  const end = monthEnd(month) < today() ? monthEnd(month) : addDays(today(), -1);
  return eachDate(month, end).filter((d) => weekdayOf(d) !== 0);
}

/** Replace the active policy (new version effective from 2000-01-02 so it applies to every month). */
async function setPolicy(overrides = {}) {
  const a = await admin();
  const cur = (await a.get('/api/policies/current?date=2000-01-02')).body;
  const body = { ...cur, effectiveFrom: '2000-01-02', reason: 'Automated test policy', payrollCutoffDay: null, ...overrides };
  const res = await a.post('/api/policies').send(body);
  if (res.status !== 201) throw new Error(`setPolicy failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function payrollFor(employeeId, month) {
  const a = await admin();
  const res = await a.get(`/api/payroll/${employeeId}?month=${ym(month)}`);
  if (res.status !== 200) throw new Error(`payrollFor ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function addLocalNetworks() {
  const a = await admin();
  await a.post('/api/admin/networks').send({ name: 'Test loopback v4', publicIp: '127.0.0.1/32' });
  await a.post('/api/admin/networks').send({ name: 'Test loopback v6', publicIp: '::1/128' });
}

module.exports = { app, request, knex, admin, login, ensureUser, createEmployee, insertSessions, workingDates, setPolicy, payrollFor, addLocalNetworks, today, currentMonth, prevMonth, ym, uniq, TZ, zonedToUtc, addDays, monthEnd };
