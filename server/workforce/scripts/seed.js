'use strict';
/**
 * Seeds: an Admin account, optional HR + Revenue Manager demo accounts and up to
 * 10 clearly-labelled DEMO employees (the Salary Analyzer cast) with demo
 * attendance, revenue, advances and payroll for the previous + current month.
 *
 *   npm run db:seed                 # admin + demo data
 *   npm run db:seed -- --admin-only # only the admin account (production)
 *
 * Passwords come from SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD; if unset, random
 * passwords are generated, printed once and written to backend/.seed-credentials.txt.
 * Real (non-demo) data is never touched. Re-running is safe (skips existing demo data).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const knex = require('../src/db');
const config = require('../src/config');
const { hashPassword } = require('../src/utils/crypto');
const { zonedToUtc, addDays, eachDate, weekdayOf, todayInTz, monthStart, monthEnd } = require('../src/utils/time');
const revenue = require('../src/services/revenue.service');
const advances = require('../src/services/advance.service');
const leaves = require('../src/services/leave.service');
const payroll = require('../src/services/payroll.service');
const events = require('../src/services/events.service');

const args = new Set(process.argv.slice(2));
const credentials = [];
const randomPassword = () => crypto.randomBytes(9).toString('base64url');

const DEMO = [
  { code: 'EMP001', name: 'Usman Tariq', dept: 'Processing', job: 'Operations Associate', username: 'usman', base: 60000, rate: '3' },
  { code: 'EMP002', name: 'Maryam Noor', dept: 'Calling', job: 'Calling Executive', username: 'maryam', base: 50000, rate: '2.5' },
  { code: 'EMP003', name: 'Hira Saeed', dept: 'Intern', job: 'Operations Intern', username: 'hira', base: 25000, rate: '0' },
  { code: 'EMP004', name: 'Faisal Iqbal', dept: 'Administration', job: 'Office Administrator', username: 'faisal', base: 90000, rate: '0' },
  { code: 'EMP005', name: 'Bilal Ahmed', dept: 'Sales', job: 'Sales Executive', username: 'bilal', base: 70000, rate: '4' },
  { code: 'EMP006', name: 'Ayesha Khan', dept: 'Support', job: 'Customer Support', username: 'ayesha', base: 55000, rate: '0' },
  { code: 'EMP007', name: 'Hamza Malik', dept: 'Sales', job: 'Sales Associate', username: 'hamza', base: 65000, rate: '3.5' },
  { code: 'EMP008', name: 'Sana Ali', dept: 'HR', job: 'HR Executive', username: 'sana', base: 78000, rate: '0' },
  { code: 'EMP009', name: 'Zain Raza', dept: 'Processing', job: 'Processing Executive', username: 'zain', base: 48000, rate: '2' },
  { code: 'EMP010', name: 'Noor Fatima', dept: 'Calling', job: 'Calling Associate', username: 'noor', base: 52000, rate: '2.5' },
];
// Check-in patterns from the original Salary Analyzer (Evening shift starts 18:00).
const LATE = [['18:00', '18:17', '19:20', '18:05', '18:40'], ['18:00', '18:24', '18:00', '18:35', '18:00'], ['18:00', '18:00', '18:30', '18:00', '18:14'],
  ['18:00', '18:00', '18:00', '18:00', '18:06'], ['18:14', '18:00', '18:31', '18:00', '18:45'], ['18:00', '18:10', '18:00', '18:22', '18:00'],
  ['18:45', '18:00', '19:15', '18:17', '18:00'], ['18:00', '18:00', '18:10', '18:00', '18:00'], ['18:00', '18:35', '18:00', '18:15', '18:00'], ['18:15', '18:00', '18:50', '18:00', '18:00']];

async function ensureUser({ username, fullName, attendanceRole, roleCodes, password, isProtected = false, employeeId = null, team = '' }) {
  let u = await knex('users').whereRaw('lower(username)=lower(?)', [username]).first();
  if (!u) {
    [u] = await knex('users').insert({
      username, full_name: fullName, password_hash: hashPassword(password), attendance_role: attendanceRole, team,
      is_protected: isProtected, employee_id: employeeId, must_change_password: false,
    }).returning('*');
    credentials.push({ username, password, roles: roleCodes.join(',') });
  }
  for (const code of roleCodes) {
    const role = await knex('roles').where({ code }).first();
    await knex('user_roles').insert({ user_id: u.id, role_id: role.id }).onConflict(['user_id', 'role_id']).ignore();
  }
  return u;
}

async function seedAdmin() {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD || randomPassword();
  if (password.length < 8) throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters.');
  return ensureUser({ username, fullName: 'System Administrator', attendanceRole: 'Owner', roleCodes: ['ADMIN'], password, isProtected: true, team: 'Executive' });
}

async function seedDemo(admin) {
  if (await knex('employees').where({ is_demo: true }).first()) {
    console.log('[seed] Demo employees already exist — skipping demo data (run npm run db:reset-demo first to recreate).');
    return;
  }
  const tz = config.businessTimezone;
  const demoPassword = process.env.SEED_DEMO_PASSWORD || randomPassword();
  const actor = { id: admin.id, username: admin.username, fullName: admin.full_name || 'System Administrator' };
  const evening = await knex('shifts').whereRaw("lower(name)='evening'").first();

  await ensureUser({ username: 'hr.manager', fullName: 'Demo HR Manager', attendanceRole: 'Head of Processing', roleCodes: ['HR'], password: demoPassword, team: 'HR' });
  await ensureUser({ username: 'revenue.manager', fullName: 'Demo Revenue Manager', attendanceRole: 'Staff', roleCodes: ['REVENUE_MANAGER'], password: demoPassword, team: 'Sales' });

  const today = todayInTz(tz);
  const curMonth = monthStart(today);
  const prevMonth = monthStart(addDays(curMonth, -1));
  const joining = monthStart(addDays(prevMonth, -40));

  const emps = [];
  for (const d of DEMO) {
    let dep = await knex('departments').whereRaw('lower(name)=lower(?)', [d.dept]).first();
    if (!dep) [dep] = await knex('departments').insert({ name: d.dept }).returning('*');
    const [e] = await knex('employees').insert({
      employee_code: d.code, full_name: d.name, department_id: dep.id, designation: d.job, joining_date: joining,
      base_salary: d.base.toFixed(2), shift_id: evening.id, is_demo: true, notes: 'DEMO employee (Salary Analyzer sample cast)',
    }).returning('*');
    await knex('commission_settings').insert({ employee_id: e.id, fixed_rate_percent: d.rate, updated_by: admin.id });
    await knex('commission_rate_history').insert({ employee_id: e.id, old_rate: null, new_rate: d.rate, reason: 'Demo seed initial rate', changed_by: admin.id });
    const u = await ensureUser({ username: d.username, fullName: d.name, attendanceRole: 'Staff', roleCodes: ['EMPLOYEE'], password: demoPassword, employeeId: e.id, team: d.dept });
    emps.push({ ...d, id: e.id, userId: u.id });
  }

  // ---- demo attendance sessions (previous month + current month up to yesterday)
  const dates = eachDate(prevMonth, addDays(today, -1)).filter((d) => weekdayOf(d) !== 0);
  const skip = new Map(); // `${code}|${date}` -> reason
  const prevDates = dates.filter((d) => d < curMonth);
  const curDates = dates.filter((d) => d >= curMonth);
  const pickDate = (arr, i) => arr[Math.min(arr.length - 1, i)];
  // previous month: decided leave + absences (all resolved so payroll can be approved)
  const plans = [
    ['EMP001', pickDate(prevDates, 6), 'leave-paid'], ['EMP001', pickDate(prevDates, 7), 'leave-paid'],
    ['EMP002', pickDate(prevDates, 13), 'leave-paid'], ['EMP003', pickDate(prevDates, 3), 'absent'],
    ['EMP003', pickDate(prevDates, 19), 'leave-unpaid'], ['EMP005', pickDate(prevDates, 9), 'absent'],
    ['EMP009', pickDate(prevDates, 18), 'absent'], ['EMP010', pickDate(prevDates, 20), 'leave-rejected'],
  ];
  if (curDates.length >= 3) {
    plans.push(['EMP002', pickDate(curDates, 1), 'leave-pending'], ['EMP007', pickDate(curDates, 2), 'leave-paid'],
      ['EMP006', pickDate(curDates, 0), 'missing-checkout'], ['EMP003', pickDate(curDates, 2), 'absent']);
  }
  for (const [code, date, kind] of plans) if (date) skip.set(`${code}|${date}`, kind);

  const sessions = [];
  emps.forEach((e, idx) => {
    dates.forEach((date, k) => {
      const kind = skip.get(`${e.code}|${date}`);
      if (kind && kind !== 'missing-checkout') return;
      const t = LATE[idx][k % 5];
      const inAt = zonedToUtc(date, t, tz);
      const outAt = zonedToUtc(addDays(date, 1), `02:${String((k % 3) * 5).padStart(2, '0')}`, tz);
      sessions.push({
        session_id: crypto.randomUUID(), user_id: e.userId, employee_id: e.id, business_date: date, check_in_at: inAt,
        check_out_at: kind === 'missing-checkout' ? null : outAt, check_in_ip: '127.0.0.1', check_out_ip: kind === 'missing-checkout' ? null : '127.0.0.1',
        device_id: `demo-device-${e.code}`, is_active: false, closed_reason: kind === 'missing-checkout' ? 'superseded_missing_checkout' : 'checkout',
        source: 'demo_seed', report: 'DEMO session',
      });
    });
  });
  for (let i = 0; i < sessions.length; i += 500) await knex('attendance_sessions').insert(sessions.slice(i, i + 500));

  // ---- demo leave (through the service so attendance + payroll stay consistent)
  const q = events.deferred();
  const ctx = { ip: '127.0.0.1', events: q };
  for (const [code, date, kind] of plans) {
    if (!date || !kind.startsWith('leave')) continue;
    const e = emps.find((x) => x.code === code);
    const l = await leaves.apply({ employeeId: e.id, userId: e.userId, username: e.username, leaveType: 'Full-Day Leave', startDate: date, endDate: date, reason: 'DEMO leave request', source: 'demo_seed' }, actor, ctx);
    if (kind === 'leave-paid') await leaves.decide(l.id, { decision: 'Approved', payType: 'Paid', note: 'DEMO approval' }, actor, ctx);
    if (kind === 'leave-unpaid') await leaves.decide(l.id, { decision: 'Approved', payType: 'Unpaid', note: 'DEMO approval (unpaid)' }, actor, ctx);
    if (kind === 'leave-rejected') await leaves.decide(l.id, { decision: 'Rejected', note: 'DEMO rejection' }, actor, ctx);
  }

  // ---- demo revenue (verified at entry, clearly marked DEMO)
  const salePlan = [
    ['EMP001', 'FIXED_EMPLOYEE', '100000.00', null], ['EMP001', 'MANUAL_PERCENT', '40000.00', '5'], ['EMP002', 'FIXED_EMPLOYEE', '150000.00', null],
    ['EMP005', 'FIXED_EMPLOYEE', '220000.00', null], ['EMP005', 'MANUAL_PERCENT', '60000.00', '6.5'], ['EMP007', 'FIXED_EMPLOYEE', '90000.00', null],
    ['EMP009', 'FIXED_EMPLOYEE', '70000.00', null], ['EMP010', 'MANUAL_PERCENT', '85000.00', '3'],
  ];
  let n = 0;
  for (const [month, monthDates] of [[prevMonth, prevDates], [curMonth, curDates.length ? curDates : [today]]]) {
    for (const [i, [code, method, amount, manual]] of salePlan.entries()) {
      n += 1;
      const e = emps.find((x) => x.code === code);
      await revenue.create({
        employeeId: e.id, saleReference: `DEMO-${month.slice(0, 7).replace('-', '')}-${String(i + 1).padStart(3, '0')}`,
        saleDate: monthDates[Math.min(monthDates.length - 1, i * 2)], saleAmount: amount, units: 1 + (i % 3), commissionMethod: method,
        manualRatePercent: manual, verifyNow: true, isDemo: true, notes: 'DEMO revenue record',
      }, actor, { canVerify: true, ...ctx });
    }
    // one pending + one rejected per month
    const e = emps.find((x) => x.code === 'EMP007');
    const pend = await revenue.create({ employeeId: e.id, saleReference: `DEMO-${month.slice(0, 7).replace('-', '')}-P01`, saleDate: monthDates[0], saleAmount: '30000.00', commissionMethod: 'FIXED_EMPLOYEE', isDemo: true, notes: 'DEMO pending sale' }, actor, { canVerify: true, ...ctx });
    if (month === prevMonth) await revenue.changeStatus(pend.id, actor, { ...ctx, to: 'Rejected', reason: 'DEMO: duplicate customer order' });
  }
  void n;

  // ---- demo advances
  const advPlan = [['EMP001', '12000.00', '4000.00', prevMonth], ['EMP002', '10000.00', '5000.00', prevMonth], ['EMP004', '20000.00', '10000.00', curMonth], ['EMP006', '6000.00', '2000.00', curMonth]];
  for (const [code, amount, rec, start] of advPlan) {
    const e = emps.find((x) => x.code === code);
    await advances.create({ employeeId: e.id, amount, monthlyRecovery: rec, advanceDate: start, recoveryStartMonth: start, reason: 'DEMO employee advance', approveNow: true, isDemo: true }, actor, { canApprove: true, ...ctx });
  }
  const e10 = emps.find((x) => x.code === 'EMP010');
  await advances.create({ employeeId: e10.id, amount: '8000.00', monthlyRecovery: '4000.00', advanceDate: curMonth, reason: 'DEMO advance request awaiting approval', isDemo: true }, actor, { canApprove: true, ...ctx });

  // ---- previous month payroll: review severe lateness, then approve 6 and pay 3
  await payroll.refreshMonth(prevMonth, { maxAgeMs: 0 });
  const period = await payroll.ensurePeriod(prevMonth);
  const severe = await knex('attendance_records').whereIn('employee_id', emps.map((e) => e.id))
    .whereBetween('attendance_date', [period.start_date, period.end_date]).where('late_minutes', '>=', 60);
  for (const r of severe) await knex('attendance_records').where({ id: r.id }).update({ reviewed: true, review_note: 'DEMO manager review', reviewed_by: admin.id, reviewed_at: new Date() });
  await payroll.refreshMonth(prevMonth, { maxAgeMs: 0 });
  const recs = await knex('payroll_records').where({ period_id: period.id }).whereIn('employee_id', emps.map((e) => e.id)).orderBy('employee_id');
  const approveIds = recs.slice(0, 6).map((r) => r.id);
  const results = await payroll.approveMany(approveIds, actor, 'DEMO approval of previous month', '127.0.0.1');
  const ok = results.filter((r) => r.ok);
  for (const [i, r] of ok.slice(0, 3).entries()) {
    await payroll.markPaid(r.id, actor, { paymentDate: monthEnd(prevMonth), paymentMethod: 'Bank Transfer', paymentReference: `DEMO-PAY-${prevMonth.slice(0, 7)}-${i + 1}`, remarks: 'DEMO payment record (no bank transfer)' }, '127.0.0.1');
  }
  await payroll.refreshMonth(curMonth, { maxAgeMs: 0 });
  console.log(`[seed] Demo data: ${emps.length} employees, ${sessions.length} attendance sessions, ${ok.length} approved / 3 paid payroll for ${prevMonth.slice(0, 7)}; drafts for ${curMonth.slice(0, 7)}.`);
  if (results.some((r) => !r.ok)) console.log('[seed] Not approved (expected blockers):', results.filter((r) => !r.ok).map((r) => r.reason).join(' | '));
}

async function main() {
  const [, pending] = await knex.migrate.list({ directory: path.join(__dirname, '..', 'db', 'migrations') });
  if (pending.length) throw new Error('Migrations pending. Run npm run db:migrate first.');
  const admin = await seedAdmin();
  if (!args.has('--admin-only')) await seedDemo(admin);
  if (credentials.length) {
    const lines = ['Workforce ERP seeded accounts (change these passwords after first sign-in):', ...credentials.map((c) => `  ${c.username.padEnd(16)} ${c.password.padEnd(16)} ${c.roles}`)];
    console.log(`\n${lines.join('\n')}\n`);
    const file = path.join(__dirname, '..', '.seed-credentials.txt');
    fs.writeFileSync(file, `${lines.join('\n')}\n\nDelete this file once you have stored the passwords safely.\n`, { mode: 0o600 });
    console.log(`[seed] Credentials also written to ${file} (git-ignored). Delete it after noting them.`);
  } else {
    console.log('[seed] No new accounts created.');
  }
}

main().then(() => knex.destroy()).catch((e) => { console.error('[seed] failed:', e.message); knex.destroy().then(() => process.exit(1)); });
