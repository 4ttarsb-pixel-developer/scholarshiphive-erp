'use strict';
const express = require('express');
const knex = require('./db');
const config = require('./src/config');
const sourceAuth = require('./src/middleware/auth');
const apiRoutes = require('./src/routes/api.routes');
const legacyRoutes = require('./src/routes/legacy-attendance.routes');
const ref = require('./db/migrations/20261026000002_reference_data');

const ALL_PERMISSIONS = Object.keys(ref.PERMISSIONS || {});
const READ_PERMISSIONS = [
  'employees.view', 'attendance.view_all', 'attendance.view_own', 'leave.apply_own',
  'revenue.view', 'commission.view', 'payroll.view', 'payroll.view_own',
  'advances.view', 'reports.view', 'audit.view',
];
const MANAGE_PERMISSIONS = [
  'employees.manage', 'attendance.manage', 'attendance.approve_corrections', 'leave.manage',
  'revenue.create', 'revenue.verify', 'commission.settings', 'payroll.calculate',
  'payroll.adjust', 'payroll.approve', 'payroll.pay', 'advances.manage', 'advances.approve',
  'policy.manage',
];

function isAdmin(u) { return !!u && ['admin', 'super_admin'].includes(String(u.role || '').toLowerCase()); }
function level(u, key) { return isAdmin(u) ? 'edit' : (u?.perms?.[key] || ''); }
function has(u, key, needed = 'view') { const v = level(u, key); return needed === 'view' ? ['view', 'edit'].includes(v) : v === 'edit'; }
function mappedPermissions(erpUser) {
  if (isAdmin(erpUser)) return new Set(ALL_PERMISSIONS);
  const result = new Set(['attendance.view_own', 'leave.apply_own', 'payroll.view_own']);
  if (has(erpUser, 'salary')) READ_PERMISSIONS.forEach(p => result.add(p));
  if (has(erpUser, 'salary', 'edit')) MANAGE_PERMISSIONS.forEach(p => result.add(p));
  return result;
}

async function ensureMappedUser(erpUser) {
  const existing = await knex('erp_user_links').where({ erp_user_id: erpUser.id }).first();
  if (existing) {
    const user = await knex('users').where({ id: existing.workforce_user_id }).first();
    if (user) return user;
    await knex('erp_user_links').where({ erp_user_id: erpUser.id }).del();
  }

  const username = `erp_${Number(erpUser.id)}`;
  return knex.transaction(async trx => {
    await trx.raw('SELECT pg_advisory_xact_lock(7670000, ?)', [Number(erpUser.id)]);
    const linked = await trx('erp_user_links').where({ erp_user_id: erpUser.id }).first();
    if (linked) return trx('users').where({ id: linked.workforce_user_id }).first();

    // Link by the stable ERP employee code. When no Workforce profile exists,
    // create a minimal employee profile from the approved ERP account so HR does
    // not have to enter every existing staff member twice. Existing Workforce
    // profiles and their salary/commission settings are never overwritten.
    let employeeId = null;
    const employeeCode = String(erpUser.employee_code || '').trim().toUpperCase();
    if (employeeCode) {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [employeeCode]);
      let employee = await trx('employees').whereRaw('upper(employee_code)=upper(?)', [employeeCode]).first();
      if (!employee) {
        const erpDetails = await trx.withSchema('public').table('users').where({ id: erpUser.id })
          .first('employee_code', 'full_name', 'designation', 'created_at', 'approved_at');
        const oldTerms = await trx.withSchema('public').table('salary_terms').where({ user_id: erpUser.id })
          .orderBy('effective_month', 'desc').first('base_salary', 'commission_pct', 'effective_month');
        const joined = erpDetails?.approved_at || erpDetails?.created_at || new Date();
        const [createdEmployee] = await trx('employees').insert({
          employee_code: employeeCode,
          full_name: String(erpUser.full_name || erpDetails?.full_name || username).slice(0, 120),
          designation: String(erpUser.designation || erpDetails?.designation || '').slice(0, 120) || null,
          employment_status: 'Active',
          joining_date: new Date(joined).toISOString().slice(0, 10),
          base_salary: Number(oldTerms?.base_salary || 0).toFixed(2),
        }).returning('*');
        employee = createdEmployee;
        if (oldTerms) {
          const rate = String(oldTerms.commission_pct ?? '0');
          await trx('commission_settings').insert({ employee_id: employee.id, fixed_rate_percent: rate })
            .onConflict('employee_id').ignore();
          await trx('commission_rate_history').insert({
            employee_id: employee.id, old_rate: null, new_rate: rate,
            reason: `Imported from ERP salary terms (${oldTerms.effective_month})`, changed_by: null,
          });
        }
      }
      employeeId = employee.id;
    }

    // Reuse an existing attendance login for this employee when it is not linked
    // to another ERP account. This preserves mobile credentials and attendance history.
    let user = null;
    let createdByBridge = false;
    if (employeeId) {
      const employeeLogin = await trx('users').where({ employee_id: employeeId }).first();
      if (employeeLogin) {
        const alreadyLinked = await trx('erp_user_links').where({ workforce_user_id: employeeLogin.id }).first();
        if (!alreadyLinked || Number(alreadyLinked.erp_user_id) === Number(erpUser.id)) user = employeeLogin;
        else employeeId = null; // one Workforce employee login can map to only one ERP account
      }
    }
    if (!user) {
      const [created] = await trx('users').insert({
        username,
        password_hash: null,
        full_name: String(erpUser.full_name || username).slice(0, 120),
        email: String(erpUser.email || '').slice(0, 160),
        attendance_role: isAdmin(erpUser) ? 'Owner' : 'Staff',
        team: String(erpUser.designation || '').slice(0, 80),
        allow_mobile: false,
        allow_web: true,
        is_protected: isAdmin(erpUser),
        is_active: true,
        employee_id: employeeId,
      }).returning('*');
      user = created;
      createdByBridge = true;
    }
    await trx('erp_user_links').insert({ erp_user_id: erpUser.id, workforce_user_id: user.id });
    // Only assign a role to a newly provisioned SSO user. Reused mobile logins
    // keep their original least-privilege role; ERP permissions are injected per request.
    if (createdByBridge) {
      const roleCode = isAdmin(erpUser) ? 'ADMIN' : (has(erpUser, 'salary', 'edit') ? 'HR' : 'EMPLOYEE');
      const role = await trx('roles').where({ code: roleCode }).first();
      if (role) await trx('user_roles').insert({ user_id: user.id, role_id: role.id }).onConflict(['user_id', 'role_id']).ignore();
    }
    return user;
  });
}


async function provisionVisibleErpUsers() {
  const rows = await knex.withSchema('public').table('users')
    .select('id', 'employee_code', 'role', 'status', 'full_name', 'email', 'designation')
    .where('status', 'approved');
  for (const u of rows) await ensureMappedUser(u);
}

async function bridgeErpSession(req, res, next) {
  try {
    const erpUser = req.user;
    if (erpUser?.id) {
      // Provision all active ERP logins when HR opens the employee directory so they can be linked in one click.
      if (has(erpUser, 'salary', 'edit') && /^\/employees(?:\/|$)/.test(req.path)) {
        await provisionVisibleErpUsers();
      }
      const workforceUser = await ensureMappedUser(erpUser);
      const permissions = mappedPermissions(erpUser);
      const roles = isAdmin(erpUser) ? ['ADMIN'] : (has(erpUser, 'salary', 'edit') ? ['HR'] : ['EMPLOYEE']);
      req.workforceErpUser = erpUser;
      req.user = {
        id: workforceUser.id,
        username: workforceUser.username,
        fullName: workforceUser.full_name || erpUser.full_name,
        email: workforceUser.email || erpUser.email,
        employeeId: workforceUser.employee_id,
        attendanceRole: workforceUser.attendance_role,
        team: workforceUser.team,
        mustChangePassword: false,
        roles,
        permissions,
        legacyManagement: isAdmin(erpUser),
      };
      req.authVia = 'erp';
      req.authToken = null;
      return next();
    }
    // Mobile devices and legacy attendance clients continue using their own token/session mechanism.
    return sourceAuth.loadUser(req, res, next);
  } catch (err) { return next(err); }
}

function createWorkforceRouter() {
  const router = express.Router();
  router.use(bridgeErpSession);
  // Legacy Flutter endpoints are intentionally retained for mobile check-in, shifts, reception and CCTV.
  router.use(legacyRoutes);
  router.use(apiRoutes);
  return router;
}

async function migrateWorkforce() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is required for the Workforce module.');
  await knex.raw('CREATE SCHEMA IF NOT EXISTS workforce');
  const [batch, migrations] = await knex.migrate.latest({
    directory: require('path').join(__dirname, 'db', 'migrations'),
    tableName: 'knex_migrations',
    schemaName: 'workforce',
  });
  console.log(`[workforce] PostgreSQL schema ready (batch ${batch}, ${migrations.length} migration(s)).`);
  return { batch, migrations };
}

async function closeWorkforcePool() { await knex.destroy(); }
module.exports = { createWorkforceRouter, migrateWorkforce, closeWorkforcePool, provisionVisibleErpUsers };
