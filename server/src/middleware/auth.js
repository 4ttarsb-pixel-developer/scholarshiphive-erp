import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, many, query } from '../db.js';
import { HttpError, forbidden } from '../lib/http.js';
import { can, canApprove, isAdmin, isSuper } from '../lib/permissions.js';
import { today as todayStr } from '../lib/money.js';

export const SESSION_COOKIE = 'sh_sid';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

export function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd || config.appUrl.startsWith('https://'),
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

export async function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query('INSERT INTO sessions(token_hash,user_id,ip,user_agent) VALUES ($1,$2,$3,$4)', [sha(token), userId, (req.ip || '').slice(0, 64), (req.get('user-agent') || '').slice(0, 300)]);
  await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [userId]);
  // Cookie lives in the browser for the session; the server enforces 30-minute inactivity.
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export async function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [sha(token)]);
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export async function loadPerms(userId) {
  const rows = await many('SELECT module, level FROM permissions WHERE user_id=$1', [userId]);
  return Object.fromEntries(rows.map(r => [r.module, r.level]));
}

/** Budget wallet state for the "My Budget" page (null = never allotted). */
export async function loadBudget(userId) {
  const w = await one('SELECT state, valid_until FROM budget_wallets WHERE user_id=$1', [userId]).catch(() => null);
  if (!w) return null;
  const until = w.valid_until ? (w.valid_until instanceof Date ? w.valid_until.toISOString() : String(w.valid_until)).slice(0, 10) : null;
  return { state: w.state, valid_until: until, active: w.state === 'active' && (!until || until >= todayStr()) };
}

/** Attaches req.user when a valid, non-idle session exists. Never throws. */
export async function sessionLoader(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return next();
    const row = await one(
      `SELECT s.token_hash, s.last_activity, EXTRACT(EPOCH FROM (NOW()-s.last_activity)) AS idle_sec,
              u.id, u.employee_code, u.role, u.status, u.full_name, u.email, u.theme, u.font_size, u.language, u.photo_file_id, u.designation,
              bw.state AS budget_state, bw.valid_until AS budget_until
         FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN budget_wallets bw ON bw.user_id=u.id WHERE s.token_hash=$1`, [sha(token)]);
    if (!row) { res.clearCookie(SESSION_COOKIE, cookieOptions()); return next(); }
    if (Number(row.idle_sec) > config.sessionIdleMinutes * 60) {
      await query('DELETE FROM sessions WHERE token_hash=$1', [row.token_hash]);
      res.clearCookie(SESSION_COOKIE, cookieOptions());
      req.sessionExpired = true;
      return next();
    }
    if (row.status !== 'approved') {
      await query('DELETE FROM sessions WHERE user_id=$1', [row.id]);
      res.clearCookie(SESSION_COOKIE, cookieOptions());
      req.sessionBlocked = row.status;
      return next();
    }
    // "Activity" = any request except the passive status check.
    if (!req.path.endsWith('/auth/session-status') && Number(row.idle_sec) > 20) {
      await query('UPDATE sessions SET last_activity=NOW() WHERE token_hash=$1', [row.token_hash]);
    }
    const { token_hash: _t, last_activity: _l, idle_sec: _i, budget_state: bState, budget_until: bUntil, ...user } = row;
    // Expense budget (cash allotted from Cash Flow Manager): limited "My Budget" access while active.
    const until = bUntil ? (bUntil instanceof Date ? bUntil.toISOString() : String(bUntil)).slice(0, 10) : null;
    user.budget = bState ? { state: bState, valid_until: until, active: bState === 'active' && (!until || until >= todayStr()) } : null;
    user.perms = isAdmin(user) ? {} : await loadPerms(user.id);
    user.ip = (req.ip || '').slice(0, 64); // recorded in the audit log
    req.user = user;
    req.sessionIdleSec = Number(row.idle_sec);
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req, _res, next) {
  if (req.user) return next();
  if (req.sessionExpired) return next(new HttpError(401, 'Your session expired after 30 minutes of inactivity. Please log in again.', { code: 'SESSION_EXPIRED' }));
  if (req.sessionBlocked) return next(new HttpError(401, 'Your account is not active. Please contact admin.', { code: 'ACCOUNT_INACTIVE' }));
  next(new HttpError(401, 'Please log in first.', { code: 'NOT_LOGGED_IN' }));
}

export const requirePerm = (module, level = 'view') => (req, _res, next) => {
  if (!req.user) return requireAuth(req, _res, next);
  if (can(req.user, module, level)) return next();
  next(forbidden(level === 'edit' ? 'Not approved by admin — you can only view this page.' : 'Not approved by admin.'));
};

export const requireAnyPerm = (modules, level = 'view') => (req, _res, next) => {
  if (!req.user) return requireAuth(req, _res, next);
  if (modules.some(m => can(req.user, m, level))) return next();
  next(forbidden());
};

export function requireAdmin(req, _res, next) {
  if (!req.user) return requireAuth(req, _res, next);
  if (isAdmin(req.user)) return next();
  next(forbidden('Only admin can do this.'));
}

/** Admin, or a manager with "Expense Approvals: edit". */
export function requireApprover(req, _res, next) {
  if (!req.user) return requireAuth(req, _res, next);
  if (canApprove(req.user)) return next();
  next(forbidden('Only admin or an approved manager (Expense Approvals) can approve or reject.'));
}

export function requireSuper(req, _res, next) {
  if (!req.user) return requireAuth(req, _res, next);
  if (isSuper(req.user)) return next();
  next(forbidden('Only the Super Admin can do this.'));
}

/** Simple CSRF guard: state-changing requests must come from our own JS (custom header). */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') === 'ScholarshipHive') return next();
  // Explicit, rate-limited login/bootstrap endpoints from the original attendance clients.
  const workforcePublicAuth = new Set([
    '/workforce/attendance/login',
    '/workforce/attendance/register-biometric',
    '/workforce/attendance/check-network',
    '/workforce/admin/web-login',
    '/workforce/reception/cctv/login',
  ]);
  if (workforcePublicAuth.has(req.path)) return next();
  // Workforce web uses the same ERP cookie and legacy mobile clients use explicit bearer / attendance tokens.
  if (req.path.startsWith('/workforce/') && (
    req.get('x-requested-with') === 'XMLHttpRequest' ||
    req.get('authorization')?.startsWith('Bearer ') ||
    Boolean(req.get('x-attendance-session'))
  )) return next();
  res.status(403).json({ error: 'Request blocked (missing security header). Refresh the page and try again.' });
}

/** Tiny in-memory rate limiter (per IP + key). */
const buckets = new Map();
export const rateLimit = (key, max, windowMs) => (req, res, next) => {
  const k = key + ':' + req.ip;
  const now = Date.now();
  const b = buckets.get(k) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n += 1;
  buckets.set(k, b);
  if (b.n > max) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  next();
};
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now > b.reset) buckets.delete(k); }, 60000).unref();
