'use strict';
/**
 * Reference data the system needs to run (not demo data):
 * roles, permissions, role-permission matrix, default shifts,
 * company default weekly schedule and the initial policy (late penalties OFF).
 */

const PERMISSIONS = {
  'employees.view': 'View employee directory',
  'employees.manage': 'Create, edit, deactivate employees and set base salary',
  'attendance.view_all': 'View all attendance records',
  'attendance.manage': 'Manage attendance details, request corrections, review exceptions',
  'attendance.approve_corrections': 'Approve or reject attendance corrections',
  'attendance.security': 'Manage office networks, device bindings and attendance users',
  'attendance.view_own': 'View own attendance',
  'leave.manage': 'Approve or reject leave requests',
  'leave.apply_own': 'Apply for own leave',
  'revenue.view': 'View revenue records and reports',
  'revenue.create': 'Record sales',
  'revenue.verify': 'Verify, reject or cancel sales',
  'commission.view': 'View commissions',
  'commission.settings': 'Change employee fixed commission percentages',
  'payroll.view': 'View payroll of all employees',
  'payroll.calculate': 'Recalculate draft payroll and submit for review',
  'payroll.adjust': 'Add bonuses, authorised deductions and payroll corrections',
  'payroll.approve': 'Approve or reject payroll',
  'payroll.pay': 'Record payroll payments',
  'payroll.view_own': 'View own salary and payslips',
  'advances.view': 'View salary advances',
  'advances.manage': 'Create advance requests',
  'advances.approve': 'Approve, disburse or reject advances',
  'policy.manage': 'Change attendance and payroll policies, holidays and schedules',
  'audit.view': 'View audit log',
  'users.manage': 'Manage user accounts, roles and permissions',
  'reports.view': 'View management reports and dashboards',
};

const ROLES = {
  ADMIN: { name: 'Admin', description: 'Full access', perms: Object.keys(PERMISSIONS) },
  HR: {
    name: 'HR / Attendance Manager',
    description: 'Attendance, leave and corrections',
    perms: ['employees.view', 'attendance.view_all', 'attendance.manage', 'leave.manage',
      'attendance.view_own', 'leave.apply_own', 'payroll.view_own', 'reports.view'],
  },
  REVENUE_MANAGER: {
    name: 'Revenue Manager',
    description: 'Records and verifies sales; cannot approve payroll',
    perms: ['employees.view', 'revenue.view', 'revenue.create', 'revenue.verify', 'commission.view',
      'attendance.view_own', 'leave.apply_own', 'payroll.view_own', 'reports.view'],
  },
  EMPLOYEE: {
    name: 'Employee',
    description: 'Own attendance, leave and payslips only',
    perms: ['attendance.view_own', 'leave.apply_own', 'payroll.view_own'],
  },
};

exports.up = async function up(knex) {
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await knex('permissions').insert({ code, description }).onConflict('code').ignore();
  }
  for (const [code, r] of Object.entries(ROLES)) {
    await knex('roles').insert({ code, name: r.name, description: r.description }).onConflict('code').ignore();
    const role = await knex('roles').where({ code }).first();
    const perms = await knex('permissions').whereIn('code', r.perms);
    for (const p of perms) {
      await knex('role_permissions').insert({ role_id: role.id, permission_id: p.id }).onConflict(['role_id', 'permission_id']).ignore();
    }
  }

  // Shifts used by the Flutter shift-request dialog ("Morning", "Night").
  const shifts = [
    { name: 'Morning', start_time: '09:00', end_time: '18:00', break_minutes: 60 },
    { name: 'Evening', start_time: '18:00', end_time: '02:00', break_minutes: 30 },
    { name: 'Night', start_time: '21:00', end_time: '06:00', break_minutes: 60 },
  ];
  for (const s of shifts) {
    const exists = await knex('shifts').whereRaw('lower(name)=lower(?)', [s.name]).first();
    if (!exists) await knex('shifts').insert(s);
  }
  const morning = await knex('shifts').whereRaw("lower(name)='morning'").first();

  // Company default: Monday–Saturday working, Sunday weekly off.
  const existing = await knex('work_schedules').whereNull('employee_id').first();
  if (!existing) {
    for (let wd = 0; wd <= 6; wd += 1) {
      await knex('work_schedules').insert({ employee_id: null, weekday: wd, is_working_day: wd !== 0, shift_id: morning.id });
    }
  }

  const policy = await knex('attendance_policies').first();
  if (!policy) {
    await knex('attendance_policies').insert({
      effective_from: '2000-01-01',
      timezone: 'Asia/Karachi',
      working_days_basis: 'schedule',
      grace_minutes: 10,
      late_deduction_enabled: false,            // illustrative penalties are NOT active until an admin enables them
      late_rule_type: 'tiered',
      late_rate_percent: 5,
      late_basis: 'daily',
      late_rounding: 'started_hour',
      late_tiers: JSON.stringify([{ minMinutes: 60, percent: 5 }, { minMinutes: 120, percent: 10 }]),
      late_cap_percent: 10,
      severe_late_minutes: 60,
      severe_late_requires_review: true,
      early_departure_deduction_enabled: false,
      absence_deduction_enabled: true,
      paid_leave_days_per_month: 2,
      reason: 'Initial system policy (late/early penalties disabled until approved by management)',
    });
  }
};

exports.down = async function down() {
  throw new Error('Reference data rollback is not supported; restore from backup.');
};

module.exports.PERMISSIONS = PERMISSIONS;
module.exports.ROLES = ROLES;
