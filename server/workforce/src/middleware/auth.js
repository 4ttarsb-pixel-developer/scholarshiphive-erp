'use strict';
const { resolveSession } = require('../services/auth.service');
const { unauthorized, forbidden } = require('../utils/errors');

const COOKIE = 'wp_session';

function extractToken(req) {
  const header = req.get('authorization') || '';
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m) return { token: m[1].trim(), via: 'header' };
  if (req.cookies && req.cookies[COOKIE]) return { token: req.cookies[COOKIE], via: 'cookie' };
  return { token: null, via: null };
}

/** Populates req.user when a valid session exists (never throws). */
async function loadUser(req, _res, next) {
  try {
    const { token, via } = extractToken(req);
    req.authToken = token;
    req.authVia = via;
    req.user = token ? await resolveSession(token) : null;
    next();
  } catch (e) { next(e); }
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  // CSRF defence for cookie-based sessions: state-changing requests must come from our JS client.
  if (req.authVia === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
      && req.get('x-requested-with') !== 'XMLHttpRequest') {
    return next(forbidden('Missing X-Requested-With header.'));
  }
  return next();
}

const can = (user, perm) => !!user && user.permissions.has(perm);

/** Require at least one of the given permissions. */
function requirePermission(...perms) {
  return (req, res, next) => requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (perms.some((p) => can(req.user, p))) return next();
    return next(forbidden());
  });
}

/** Legacy Flutter/admin-site management endpoints: management role OR attendance security permission. */
function requireLegacyAdmin(req, res, next) {
  return requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user.legacyManagement || can(req.user, 'attendance.security')) return next();
    const e = forbidden('Management authorization required.');
    return next(e);
  });
}

module.exports = { COOKIE, loadUser, requireAuth, requirePermission, requireLegacyAdmin, can, extractToken };
