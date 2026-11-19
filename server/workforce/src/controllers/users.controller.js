'use strict';
const knex = require('../db');
const { audit } = require('../services/audit.service');
const { clientIp } = require('../utils/request');
const { hashPassword } = require('../utils/crypto');
const { badRequest, notFound, forbidden } = require('../utils/errors');
const { idParam } = require('./helpers');

async function list(_req, res) {
  const users = await knex('users as u').leftJoin('employees as e', 'e.id', 'u.employee_id').orderBy('u.username')
    .select('u.id', 'u.username', 'u.full_name', 'u.attendance_role', 'u.is_active', 'u.last_login_at', 'u.employee_id', 'e.employee_code', 'u.is_protected');
  const roles = await knex('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').select('ur.user_id', 'r.code');
  res.json(users.map((u) => ({ ...u, roles: roles.filter((r) => r.user_id === u.id).map((r) => r.code) })));
}

async function roles(_req, res) {
  const r = await knex('roles').orderBy('id');
  const rp = await knex('role_permissions as rp').join('permissions as p', 'p.id', 'rp.permission_id').select('rp.role_id', 'p.code');
  const perms = await knex('permissions').orderBy('code');
  res.json({ roles: r.map((x) => ({ ...x, permissions: rp.filter((p) => p.role_id === x.id).map((p) => p.code) })), permissions: perms });
}

async function setUserRoles(req, res) {
  const id = idParam(req.params.id);
  const codes = (req.body || {}).roles;
  if (!Array.isArray(codes)) throw badRequest('roles must be an array of role codes.');
  const user = await knex('users').where({ id }).first();
  if (!user) throw notFound('User not found.');
  if (user.id === req.user.id && !codes.includes('ADMIN') && req.user.roles.includes('ADMIN')) throw forbidden('You cannot remove your own Admin role.');
  const roleRows = await knex('roles').whereIn('code', codes);
  if (roleRows.length !== codes.length) throw badRequest('Unknown role code.');
  await knex.transaction(async (trx) => {
    const before = await trx('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', id).pluck('r.code');
    await trx('user_roles').where({ user_id: id }).del();
    for (const r of roleRows) await trx('user_roles').insert({ user_id: id, role_id: r.id, granted_by: req.user.id });
    await audit(trx, { actor: req.user, action: 'User roles changed', entityType: 'user', entityId: id, detail: `${user.username}: ${before.join(',') || 'none'} → ${codes.join(',') || 'none'}`, ip: clientIp(req) });
  });
  res.json({ success: true });
}

async function setRolePermissions(req, res) {
  const code = String(req.params.code || '');
  const perms = (req.body || {}).permissions;
  if (!Array.isArray(perms)) throw badRequest('permissions must be an array.');
  const role = await knex('roles').where({ code }).first();
  if (!role) throw notFound('Role not found.');
  if (code === 'ADMIN') throw forbidden('The Admin role always has every permission.');
  const rows = await knex('permissions').whereIn('code', perms);
  if (rows.length !== perms.length) throw badRequest('Unknown permission code.');
  await knex.transaction(async (trx) => {
    await trx('role_permissions').where({ role_id: role.id }).del();
    for (const p of rows) await trx('role_permissions').insert({ role_id: role.id, permission_id: p.id });
    await audit(trx, { actor: req.user, action: 'Role permissions changed', entityType: 'role', entityId: code, detail: perms.join(', '), ip: clientIp(req) });
  });
  res.json({ success: true });
}

async function resetPassword(req, res) {
  const id = idParam(req.params.id);
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) throw badRequest('Password must be at least 8 characters.');
  const user = await knex('users').where({ id }).first();
  if (!user) throw notFound('User not found.');
  await knex('users').where({ id }).update({ password_hash: hashPassword(newPassword), must_change_password: true, failed_logins: 0, locked_until: null, updated_at: new Date() });
  await knex('auth_sessions').where({ user_id: id }).whereNull('revoked_at').update({ revoked_at: new Date() });
  await audit(null, { actor: req.user, action: 'Password reset by admin', entityType: 'user', entityId: id, detail: user.username, ip: clientIp(req) });
  res.json({ success: true });
}

module.exports = { list, roles, setUserRoles, setRolePermissions, resetPassword };
