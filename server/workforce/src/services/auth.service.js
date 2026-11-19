'use strict';
const knex = require('../db');
const config = require('../config');
const { verifyPassword, hashPassword, sha256Hex, randomToken } = require('../utils/crypto');

const MANAGEMENT_ROLES = ['owner', 'country actor', 'head of marketing', 'head of processing'];
const isManagementRole = (role) => MANAGEMENT_ROLES.includes(String(role || '').toLowerCase());
const isReceptionRole = (role) => String(role || '').toLowerCase() === 'receptionist';

const MAX_FAILED = 10;
const LOCK_MINUTES = 15;

async function findUserByUsername(username, db = knex) {
  if (!username) return null;
  return db('users').whereRaw('lower(username) = lower(?)', [String(username).trim()]).first();
}

/**
 * Verify a username/password. Upgrades legacy hashes. Applies lockout.
 * @returns {Promise<{user:object|null, error?:string}>}
 */
async function checkPassword(username, password, db = knex) {
  const user = await findUserByUsername(username, db);
  if (!user || !user.is_active) return { user: null, error: 'Invalid username or password.' };
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return { user: null, error: 'Account temporarily locked after repeated failed sign-ins. Try again later.' };
  }
  const { ok, needsRehash } = verifyPassword(password, user.password_hash);
  if (!ok) {
    const failed = (user.failed_logins || 0) + 1;
    await db('users').where({ id: user.id }).update({
      failed_logins: failed,
      locked_until: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
    });
    return { user: null, error: 'Invalid username or password.' };
  }
  const patch = { failed_logins: 0, locked_until: null, last_login_at: new Date() };
  if (needsRehash) patch.password_hash = hashPassword(password);
  await db('users').where({ id: user.id }).update(patch);
  return { user: { ...user, ...patch } };
}

async function createSession(userId, kind, { ip, userAgent } = {}, db = knex) {
  const token = randomToken(32);
  const hours = kind === 'web' ? config.webSessionHours : config.mobileSessionDays * 24;
  await db('auth_sessions').insert({
    token_hash: sha256Hex(token), user_id: userId, kind, ip: ip || null,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
    expires_at: new Date(Date.now() + hours * 3600 * 1000),
  });
  return token;
}

async function revokeSession(token, db = knex) {
  if (!token) return;
  await db('auth_sessions').where({ token_hash: sha256Hex(token) }).update({ revoked_at: new Date() });
}

/** Load user + roles + permissions for a session token. */
async function resolveSession(token) {
  if (!token || token.length < 20) return null;
  const row = await knex('auth_sessions as s')
    .join('users as u', 'u.id', 's.user_id')
    .where('s.token_hash', sha256Hex(token))
    .whereNull('s.revoked_at')
    .where('s.expires_at', '>', knex.fn.now())
    .where('u.is_active', true)
    .select('s.id as session_row_id', 's.kind', 's.last_seen_at', 'u.*')
    .first();
  if (!row) return null;
  const user = await loadPrincipal(row.id);
  user.sessionKind = row.kind;
  user.sessionRowId = row.session_row_id;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60000) {
    knex('auth_sessions').where({ id: row.session_row_id }).update({ last_seen_at: new Date() }).catch(() => {});
  }
  return user;
}

async function loadPrincipal(userId, db = knex) {
  const u = await db('users').where({ id: userId }).first();
  if (!u) return null;
  const roles = await db('user_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where('ur.user_id', userId).pluck('r.code');
  const perms = await db('user_roles as ur')
    .join('role_permissions as rp', 'rp.role_id', 'ur.role_id')
    .join('permissions as p', 'p.id', 'rp.permission_id')
    .where('ur.user_id', userId).distinct('p.code').pluck('p.code');
  // Legacy management roles from the attendance app keep their attendance-admin abilities.
  const legacyManagement = isManagementRole(u.attendance_role);
  return {
    id: u.id,
    username: u.username,
    fullName: u.full_name || u.username,
    email: u.email,
    employeeId: u.employee_id,
    attendanceRole: u.attendance_role,
    team: u.team,
    mustChangePassword: u.must_change_password,
    roles,
    permissions: new Set(perms),
    legacyManagement,
  };
}

function principalJson(p) {
  return {
    id: p.id, username: p.username, fullName: p.fullName, employeeId: p.employeeId,
    attendanceRole: p.attendanceRole, roles: p.roles, permissions: [...p.permissions].sort(),
    mustChangePassword: p.mustChangePassword,
  };
}

module.exports = {
  MANAGEMENT_ROLES, isManagementRole, isReceptionRole, findUserByUsername, checkPassword,
  createSession, revokeSession, resolveSession, loadPrincipal, principalJson,
};
