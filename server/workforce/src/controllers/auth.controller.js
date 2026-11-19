'use strict';
const knex = require('../db');
const config = require('../config');
const auth = require('../services/auth.service');
const { audit, activity } = require('../services/audit.service');
const { COOKIE } = require('../middleware/auth');
const { clientIp } = require('../utils/request');
const { hashPassword } = require('../utils/crypto');
const { badRequest, unauthorized } = require('../utils/errors');

async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) throw badRequest('Username and password are required.');
  const ip = clientIp(req);
  const { user, error } = await auth.checkPassword(username, password);
  if (!user) {
    await activity(null, { username, action: 'WEB_LOGIN_FAILED', allowed: false, ip });
    throw unauthorized(error);
  }
  if (!user.allow_web) throw unauthorized('Web access is disabled for this account.');
  const principal = await auth.loadPrincipal(user.id);
  if (!principal.roles.length) throw unauthorized('This account has no role assigned. Ask an administrator.');
  const kind = req.body.client === 'mobile' ? 'mobile' : 'web';
  const token = await auth.createSession(user.id, kind, { ip, userAgent: req.get('user-agent') });
  if (kind === 'web') {
    res.cookie(COOKIE, token, {
      httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: config.webSessionHours * 3600 * 1000, path: '/',
    });
  }
  await activity(null, { username: user.username, userId: user.id, action: 'WEB_LOGIN', ip });
  await audit(null, { actor: principal, action: 'Signed in', entityType: 'user', entityId: user.id, ip });
  res.json({ success: true, user: auth.principalJson(principal), ...(kind === 'mobile' ? { token } : {}) });
}

async function logout(req, res) {
  await auth.revokeSession(req.authToken);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ success: true });
}

async function me(req, res) {
  res.json({ success: true, user: auth.principalJson(req.user), timezone: config.businessTimezone });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) throw badRequest('New password must be at least 8 characters.');
  const { user } = await auth.checkPassword(req.user.username, currentPassword);
  if (!user) throw badRequest('Current password is incorrect.');
  await knex('users').where({ id: user.id }).update({ password_hash: hashPassword(newPassword), must_change_password: false, updated_at: new Date() });
  // Revoke other sessions.
  await knex('auth_sessions').where({ user_id: user.id }).whereNot({ id: req.user.sessionRowId }).whereNull('revoked_at').update({ revoked_at: new Date() });
  await audit(null, { actor: req.user, action: 'Password changed', entityType: 'user', entityId: user.id, ip: clientIp(req) });
  res.json({ success: true });
}

module.exports = { login, logout, me, changePassword };
