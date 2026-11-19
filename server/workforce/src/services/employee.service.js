'use strict';
const knex = require('../db');
const payroll = require('./payroll.service');
const { audit } = require('./audit.service');
const { hashPassword } = require('../utils/crypto');
const { D, isValidMoneyInput } = require('../utils/money');
const { isValidDate, todayInTz, monthStart } = require('../utils/time');
const { badRequest, conflict, notFound } = require('../utils/errors');
const config = require('../config');

const STATUSES = ['Active', 'Inactive', 'Terminated'];

async function departmentId(name, db) {
  const n = String(name || '').trim();
  if (!n) return null;
  const found = await db('departments').whereRaw('lower(name)=lower(?)', [n]).first();
  if (found) return found.id;
  const [d] = await db('departments').insert({ name: n }).returning('*');
  return d.id;
}

function employeeQuery(db = knex) {
  return db('employees as e')
    .leftJoin('departments as d', 'd.id', 'e.department_id')
    .leftJoin('shifts as s', 's.id', 'e.shift_id')
    .leftJoin('commission_settings as cs', 'cs.employee_id', 'e.id')
    .leftJoin('users as u', 'u.employee_id', 'e.id')
    .select('e.*', 'd.name as department', 's.name as shift_name', 's.start_time as shift_start', 's.end_time as shift_end',
      'cs.fixed_rate_percent', 'u.id as user_id', 'u.username', 'u.is_active as user_active', 'u.attendance_role');
}

function dto(r, payment) {
  return {
    id: r.id,
    employeeCode: r.employee_code,
    fullName: r.full_name,
    username: r.username || null,
    userId: r.user_id || null,
    loginActive: r.user_id ? !!r.user_active : false,
    department: r.department || '',
    departmentId: r.department_id,
    designation: r.designation || '',
    employmentStatus: r.employment_status,
    joiningDate: r.joining_date,
    leavingDate: r.leaving_date,
    baseSalary: r.base_salary,
    shiftId: r.shift_id,
    shiftName: r.shift_name || null,
    shiftTiming: r.shift_start ? `${String(r.shift_start).slice(0, 5)}–${String(r.shift_end).slice(0, 5)}` : null,
    fixedCommissionPercent: r.fixed_rate_percent === null || r.fixed_rate_percent === undefined ? null : D(r.fixed_rate_percent).toString(),
    paymentStatus: payment || null,
    isDemo: r.is_demo,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function list({ search, status, department, includeInactive } = {}) {
  const q = employeeQuery().orderBy('e.employee_code');
  if (status) q.where('e.employment_status', status);
  else if (!includeInactive) q.where('e.employment_status', 'Active');
  if (department) q.whereRaw('lower(d.name)=lower(?)', [department]);
  if (search) {
    const like = `%${String(search).toLowerCase()}%`;
    q.where((w) => w.whereRaw('lower(e.full_name) like ?', [like]).orWhereRaw('lower(e.employee_code) like ?', [like])
      .orWhereRaw('lower(u.username) like ?', [like]).orWhereRaw('lower(d.name) like ?', [like]));
  }
  const rows = await q;
  // Payment status for the current month.
  const month = monthStart(todayInTz(config.businessTimezone));
  const pr = await knex('payroll_records as r').join('payroll_periods as p', 'p.id', 'r.period_id')
    .where('p.period_month', month).select('r.employee_id', 'r.status');
  const map = new Map(pr.map((x) => [x.employee_id, x.status]));
  return rows.map((r) => dto(r, map.get(r.id) || 'Not calculated'));
}

async function get(id) {
  const r = await employeeQuery().where('e.id', id).first();
  if (!r) throw notFound('Employee not found.');
  return dto(r);
}

function validate(input, { partial = false } = {}) {
  const errors = [];
  const has = (k) => input[k] !== undefined;
  if (!partial || has('employeeCode')) {
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(String(input.employeeCode || ''))) errors.push('Employee code must be 2–30 letters/numbers (e.g. EMP011).');
  }
  if (!partial || has('fullName')) {
    if (String(input.fullName || '').trim().length < 2) errors.push('Full name is required.');
  }
  if (!partial || has('joiningDate')) {
    if (!isValidDate(input.joiningDate)) errors.push('Joining date is required (YYYY-MM-DD).');
  }
  if (!partial || has('baseSalary')) {
    if (!isValidMoneyInput(input.baseSalary)) errors.push('Base salary must be a PKR amount ≥ 0 with up to 2 decimals.');
  }
  if (has('employmentStatus') && !STATUSES.includes(input.employmentStatus)) errors.push('Invalid employment status.');
  if (has('leavingDate') && input.leavingDate && !isValidDate(input.leavingDate)) errors.push('Invalid leaving date.');
  if (has('fixedCommissionPercent') && input.fixedCommissionPercent !== null && input.fixedCommissionPercent !== '') {
    if (!/^\d{1,3}(\.\d{1,3})?$/.test(String(input.fixedCommissionPercent)) || D(input.fixedCommissionPercent).gt(100)) errors.push('Fixed commission must be 0–100%.');
  }
  if (input.username !== undefined && input.username !== '' && !/^[A-Za-z0-9._-]{3,60}$/.test(String(input.username))) errors.push('Username must be 3–60 letters, numbers, dot, dash or underscore.');
  if (input.password !== undefined && input.password !== '' && String(input.password).length < 8) errors.push('Password must be at least 8 characters.');
  if (errors.length) throw badRequest(errors.join(' '), errors);
}

async function create(input, actor, { ip, events }) {
  validate(input);
  try {
    return await knex.transaction(async (trx) => {
      const [emp] = await trx('employees').insert({
        employee_code: String(input.employeeCode).trim().toUpperCase(),
        full_name: String(input.fullName).trim(),
        department_id: await departmentId(input.department, trx),
        designation: input.designation ? String(input.designation).trim() : null,
        employment_status: input.employmentStatus || 'Active',
        joining_date: input.joiningDate,
        base_salary: D(input.baseSalary).toFixed(2),
        shift_id: input.shiftId ? Number(input.shiftId) : null,
        is_demo: !!input.isDemo,
        notes: input.notes || null,
      }).returning('*');
      if (input.fixedCommissionPercent !== undefined && input.fixedCommissionPercent !== null && input.fixedCommissionPercent !== '') {
        await trx('commission_settings').insert({ employee_id: emp.id, fixed_rate_percent: D(input.fixedCommissionPercent).toString(), updated_by: actor.id });
        await trx('commission_rate_history').insert({ employee_id: emp.id, old_rate: null, new_rate: D(input.fixedCommissionPercent).toString(), reason: 'Initial rate at employee creation', changed_by: actor.id });
      }
      if (input.username) {
        if (!input.password) throw badRequest('A password is required to create a login.');
        const exists = await trx('users').whereRaw('lower(username)=lower(?)', [input.username]).first();
        if (exists) throw conflict(`Username "${input.username}" already exists. Use "Link existing login" instead.`);
        const [u] = await trx('users').insert({
          username: String(input.username).trim(), password_hash: hashPassword(input.password), full_name: emp.full_name,
          attendance_role: 'Staff', team: input.department || '', employee_id: emp.id, must_change_password: true,
        }).returning('*');
        const role = await trx('roles').where({ code: 'EMPLOYEE' }).first();
        await trx('user_roles').insert({ user_id: u.id, role_id: role.id, granted_by: actor.id });
      }
      await audit(trx, { actor, action: 'Employee created', entityType: 'employee', entityId: emp.id, ip, detail: `${emp.full_name} (${emp.employee_code}) base PKR ${emp.base_salary}` });
      events.add('employees.changed', { employeeId: emp.id });
      return dto(await employeeQuery(trx).where('e.id', emp.id).first());
    });
  } catch (e) {
    if (e.code === '23505' && /ux_employees_code/.test(e.constraint || e.message)) throw conflict('Employee code already exists.');
    throw e;
  }
}

async function update(id, input, actor, { ip, events }) {
  validate(input, { partial: true });
  return knex.transaction(async (trx) => {
    const before = await trx('employees').where({ id }).forUpdate().first();
    if (!before) throw notFound('Employee not found.');
    const patch = { updated_at: new Date() };
    if (input.fullName !== undefined) patch.full_name = String(input.fullName).trim();
    if (input.department !== undefined) patch.department_id = await departmentId(input.department, trx);
    if (input.designation !== undefined) patch.designation = input.designation || null;
    if (input.joiningDate !== undefined) patch.joining_date = input.joiningDate;
    if (input.baseSalary !== undefined) patch.base_salary = D(input.baseSalary).toFixed(2);
    if (input.shiftId !== undefined) patch.shift_id = input.shiftId ? Number(input.shiftId) : null;
    if (input.employmentStatus !== undefined) patch.employment_status = input.employmentStatus;
    if (input.leavingDate !== undefined) patch.leaving_date = input.leavingDate || null;
    if (input.notes !== undefined) patch.notes = input.notes || null;
    if (input.employeeCode !== undefined && String(input.employeeCode).toUpperCase() !== before.employee_code) {
      throw badRequest('Employee code cannot be changed once created (it is the payroll identity).');
    }
    const [after] = await trx('employees').where({ id }).update(patch).returning('*');
    if (patch.employment_status && patch.employment_status !== 'Active') {
      const u = await trx('users').where({ employee_id: id }).first();
      if (u && input.disableLogin !== false) {
        await trx('users').where({ id: u.id }).update({ is_active: false, updated_at: new Date() });
        await trx('auth_sessions').where({ user_id: u.id }).whereNull('revoked_at').update({ revoked_at: new Date() });
      }
    }
    if (patch.employment_status === 'Active' && before.employment_status !== 'Active') {
      await trx('users').where({ employee_id: id }).update({ is_active: true, updated_at: new Date() });
    }
    const changed = Object.keys(patch).filter((k) => k !== 'updated_at' && String(before[k] ?? '') !== String(after[k] ?? ''));
    await audit(trx, {
      actor, action: 'Employee updated', entityType: 'employee', entityId: id, ip,
      before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])),
      detail: `${after.full_name} (${after.employee_code}): ${changed.map((k) => `${k} ${before[k] ?? '—'} → ${after[k] ?? '—'}`).join('; ') || 'no change'}`,
    });
    // Base salary / shift / dates affect Draft payroll of the current month.
    if (changed.some((k) => ['base_salary', 'shift_id', 'joining_date', 'leaving_date', 'employment_status'].includes(k))) {
      const month = monthStart(todayInTz(config.businessTimezone));
      await payroll.recalc(id, month, trx);
      events.add('payroll.changed', { employeeId: id, month });
    }
    events.add('employees.changed', { employeeId: id });
    return dto(await employeeQuery(trx).where('e.id', id).first());
  });
}

/** Unmapped attendance logins (users that clock in but are not linked to an employee). */
async function unmappedUsers() {
  const rows = await knex('users as u')
    .whereNull('u.employee_id')
    .select('u.id', 'u.username', 'u.full_name', 'u.attendance_role', 'u.team', 'u.is_active', 'u.legacy_source')
    .select(knex.raw('(SELECT count(*) FROM attendance_sessions s WHERE s.user_id = u.id)::int AS session_count'))
    .orderBy('u.username');
  return rows;
}

/**
 * Explicit, verified mapping of an attendance login to an employee. The caller
 * must retype the username (confirmUsername) — names are never matched automatically.
 */
async function linkUser(employeeId, { userId, confirmUsername }, actor, { ip, events }) {
  return knex.transaction(async (trx) => {
    const emp = await trx('employees').where({ id: employeeId }).forUpdate().first();
    if (!emp) throw notFound('Employee not found.');
    const user = await trx('users').where({ id: Number(userId) }).forUpdate().first();
    if (!user) throw notFound('Login not found.');
    if (String(confirmUsername || '').toLowerCase() !== user.username.toLowerCase()) {
      throw badRequest('Verification failed: retype the exact username to confirm this mapping.');
    }
    if (user.employee_id && user.employee_id !== employeeId) throw conflict('That login is already linked to another employee.');
    const other = await trx('users').where({ employee_id: employeeId }).whereNot({ id: user.id }).first();
    if (other) throw conflict(`This employee is already linked to login "${other.username}".`);
    await trx('users').where({ id: user.id }).update({ employee_id: employeeId, updated_at: new Date() });
    const role = await trx('roles').where({ code: 'EMPLOYEE' }).first();
    await trx('user_roles').insert({ user_id: user.id, role_id: role.id, granted_by: actor.id }).onConflict(['user_id', 'role_id']).ignore();
    // Back-fill historical attendance of this login (only into months that are not locked).
    const sessions = await trx('attendance_sessions').where({ user_id: user.id }).whereNull('employee_id').select('id', 'business_date');
    let linked = 0; let skipped = 0;
    const months = new Set();
    for (const s of sessions) {
      const month = await payroll.monthForDate(s.business_date, trx);
      if (await payroll.isLocked(employeeId, month, trx)) { skipped += 1; continue; }
      await trx('attendance_sessions').where({ id: s.id }).update({ employee_id: employeeId });
      months.add(month); linked += 1;
    }
    await trx('leave_requests').where({ user_id: user.id }).whereNull('employee_id').update({ employee_id: employeeId });
    await trx('shift_requests').where({ user_id: user.id }).whereNull('employee_id').update({ employee_id: employeeId });
    for (const m of months) await payroll.recalc(employeeId, m, trx);
    await audit(trx, {
      actor, action: 'Attendance login mapped to employee', entityType: 'employee', entityId: employeeId, ip,
      detail: `Login "${user.username}" ↔ ${emp.full_name} (${emp.employee_code}); ${linked} session(s) linked, ${skipped} in locked months skipped.`,
    });
    events.add('employees.changed', { employeeId });
    events.add('attendance.changed', { employeeId });
    return { linkedSessions: linked, skippedLockedSessions: skipped };
  });
}

async function createLogin(employeeId, { username, password }, actor, { ip }) {
  validate({ username, password }, { partial: true });
  if (!username || !password) throw badRequest('Username and password are required.');
  return knex.transaction(async (trx) => {
    const emp = await trx('employees').where({ id: employeeId }).first();
    if (!emp) throw notFound('Employee not found.');
    if (await trx('users').where({ employee_id: employeeId }).first()) throw conflict('Employee already has a login.');
    if (await trx('users').whereRaw('lower(username)=lower(?)', [username]).first()) throw conflict('Username already exists.');
    const [u] = await trx('users').insert({
      username, password_hash: hashPassword(password), full_name: emp.full_name, attendance_role: 'Staff', employee_id: employeeId, must_change_password: true,
    }).returning('*');
    const role = await trx('roles').where({ code: 'EMPLOYEE' }).first();
    await trx('user_roles').insert({ user_id: u.id, role_id: role.id, granted_by: actor.id });
    await audit(trx, { actor, action: 'Login created', entityType: 'user', entityId: u.id, ip, detail: `${username} for ${emp.employee_code}` });
    return { userId: u.id, username: u.username };
  });
}

module.exports = { list, get, create, update, unmappedUsers, linkUser, createLogin, dto, employeeQuery, departmentId };
