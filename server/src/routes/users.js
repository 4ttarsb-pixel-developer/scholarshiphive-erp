import express from 'express';
import bcrypt from 'bcryptjs';
import { config, smtpConfigured } from '../config.js';
import { createResetLink } from './auth.js';
import { one, many, query, tx } from '../db.js';
import { ah, bad, forbidden, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { MODULE_KEYS, MODULES, can, isAdmin, isSuper } from '../lib/permissions.js';
import { requireAuth, requirePerm, requireAdmin, requireSuper, destroySession } from '../middleware/auth.js';
import { sendMail, template, link, adminEmails, verifySmtp } from '../lib/email.js';
import { audit } from '../lib/audit.js';
import { paging, Where, qstr, likeText } from '../lib/paging.js';
import { walletBalance } from '../lib/budget.js';

const r = express.Router();
r.use(requireAuth);

const LIST_COLS = `u.id, u.employee_code, u.role, u.status, u.full_name, u.father_name, u.email, u.cnic, u.phone1, u.designation, u.photo_file_id, u.created_at, u.approved_at, u.last_login_at, u.google_verified`;

function cleanPerms(raw) {
  const p = v.json(raw, {});
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad('Permissions are not valid.');
  const out = {};
  for (const [k, lvl] of Object.entries(p)) {
    if (!MODULE_KEYS.includes(k)) throw bad(`Unknown page "${k}".`);
    if (lvl === 'none' || lvl === '' || lvl == null) continue;
    if (!['view', 'edit'].includes(lvl)) throw bad(`Access for ${k} must be view or edit.`);
    out[k] = lvl;
  }
  return out;
}

async function setPerms(db, userId, perms, by) {
  await db.query('DELETE FROM permissions WHERE user_id=$1', [userId]);
  for (const [m, l] of Object.entries(perms)) await db.query('INSERT INTO permissions(user_id,module,level,granted_by) VALUES ($1,$2,$3,$4)', [userId, m, l, by]);
}

const permText = perms => {
  const names = Object.entries(perms).map(([k, l]) => `${MODULES.find(m => m.key === k)?.label || k} (${l === 'edit' ? 'view + edit' : 'view only'})`);
  return names.length ? names.join(', ') : 'No pages yet — only your own salary, announcements and settings.';
};

async function target(id) {
  const u = await one('SELECT * FROM users WHERE id=$1', [v.id(id)]);
  if (!u) throw notFound('User not found.');
  return u;
}

function guardTarget(actor, t, { allowSelf = false } = {}) {
  if (!allowSelf && actor.id === t.id) throw bad('You cannot do this to your own account here.');
  if (t.role === 'super_admin') throw forbidden('The Super Admin account cannot be changed by others.');
  if (t.role === 'admin' && !isSuper(actor)) throw forbidden('Only the Super Admin can manage other admins.');
}

// ── Small directory used by forms (salesperson pickers, etc.) ──
r.get('/directory', ah(async (_req, res) => {
  res.json(await many(`SELECT id, employee_code, full_name, designation, photo_file_id, role FROM users WHERE status='approved' ORDER BY full_name`));
}));

// Server-side paged / sorted / filtered list — the table never has to load every user at once.
const USER_SORTS = {
  smart: `CASE u.status WHEN 'pending' THEN 0 ELSE 1 END, u.created_at`, code: 'u.employee_code', name: 'lower(u.full_name)', email: 'lower(u.email)',
  designation: 'lower(u.designation)', role: 'u.role', status: 'u.status', created: 'u.created_at', last_login: 'u.last_login_at',
};
r.get('/', requirePerm('users', 'view'), ah(async (req, res) => {
  const w = new Where();
  const status = qstr(req.query.status);
  if (['pending', 'approved', 'rejected', 'blocked'].includes(status)) w.add('u.status = ?', status);
  const role = qstr(req.query.role);
  if (role === 'admins') w.raw(`u.role IN ('super_admin','admin')`);
  else if (['super_admin', 'admin', 'employee'].includes(role)) w.add('u.role = ?', role);
  // Search: everywhere, or in one field (name, Emp ID, CNIC, email, phone, designation, father name)
  const text = qstr(req.query.q, 80);
  const field = qstr(req.query.field, 20);
  if (text) {
    const p = likeText(text);
    const digits = text.replace(/\D/g, '');
    const d = digits ? `%${digits}%` : null;
    const DIG = col => `regexp_replace(COALESCE(${col},''), '[^0-9]', '', 'g')`;
    const F = {
      name: () => w.add('lower(u.full_name) LIKE ?', p),
      code: () => w.add('lower(u.employee_code) LIKE ?', p),
      cnic: () => (d ? w.add(`${DIG('u.cnic')} LIKE ?`, d) : w.raw('FALSE')),
      email: () => w.add('lower(u.email) LIKE ?', p),
      phone: () => (d ? w.add(`(${DIG('u.phone1')} LIKE ? OR ${DIG('u.phone2')} LIKE ?)`, d, d) : w.raw('FALSE')),
      designation: () => w.add(`lower(COALESCE(u.designation,'')) LIKE ?`, p),
      father: () => w.add(`lower(COALESCE(u.father_name,'')) LIKE ?`, p),
    };
    if (F[field]) F[field]();
    else if (d && digits.length >= 4) w.add(`(lower(u.full_name) LIKE ? OR lower(u.email) LIKE ? OR lower(u.employee_code) LIKE ? OR lower(COALESCE(u.designation,'')) LIKE ? OR ${DIG('u.cnic')} LIKE ? OR ${DIG('u.phone1')} LIKE ?)`, p, p, p, p, d, d);
    else w.add(`(lower(u.full_name) LIKE ? OR lower(u.email) LIKE ? OR lower(u.employee_code) LIKE ? OR lower(COALESCE(u.designation,'')) LIKE ? OR lower(COALESCE(u.father_name,'')) LIKE ?)`, p, p, p, p, p);
  }
  const mod = qstr(req.query.module, 40);
  if (MODULE_KEYS.includes(mod)) w.add(`(u.role IN ('super_admin','admin') OR EXISTS (SELECT 1 FROM permissions p WHERE p.user_id=u.id AND p.module=?))`, mod);
  else if (mod === 'none') w.raw(`(u.role = 'employee' AND NOT EXISTS (SELECT 1 FROM permissions p WHERE p.user_id=u.id))`);
  const budget = qstr(req.query.budget, 10);
  if (budget === 'active' || budget === 'closed') w.add('EXISTS (SELECT 1 FROM budget_wallets bw WHERE bw.user_id=u.id AND bw.state=?)', budget);
  else if (budget === 'none') w.raw('NOT EXISTS (SELECT 1 FROM budget_wallets bw WHERE bw.user_id=u.id)');
  const desig = qstr(req.query.designation, 120); if (desig) w.add(`lower(COALESCE(u.designation,'')) = lower(?)`, desig);
  const pg = paging(req.query, { sorts: USER_SORTS, defaultSort: 'smart', defaultLimit: 25, maxLimit: 100, tieBreaker: 'u.id DESC' });
  const order = pg.sort === 'smart' ? `CASE u.status WHEN 'pending' THEN 0 ELSE 1 END, u.created_at ${pg.dir.toUpperCase()}, u.id DESC` : pg.order;
  const total = (await one(`SELECT COUNT(*)::int AS n FROM users u ${w.sql}`, w.params)).n;
  const pages = Math.max(1, Math.ceil(total / pg.limit));
  const page = Math.min(pg.page, pages);
  const params = [...w.params, pg.limit, (page - 1) * pg.limit];
  const rows = await many(`SELECT ${LIST_COLS},
      COALESCE((SELECT json_object_agg(p.module,p.level) FROM permissions p WHERE p.user_id=u.id), '{}'::json) AS perms,
      (SELECT bw.state FROM budget_wallets bw WHERE bw.user_id=u.id) AS budget_state
    FROM users u ${w.sql} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const c = await one(`SELECT COUNT(*)::int AS all, COUNT(*) FILTER (WHERE status='pending')::int AS pending, COUNT(*) FILTER (WHERE status='approved')::int AS approved,
                              COUNT(*) FILTER (WHERE status='blocked')::int AS blocked, COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
                              COUNT(*) FILTER (WHERE role IN ('super_admin','admin'))::int AS admins FROM users`);
  const designations = (await many(`SELECT DISTINCT designation AS d FROM users WHERE COALESCE(designation,'') <> '' ORDER BY 1 LIMIT 100`)).map(x => x.d);
  res.json({ rows, total, page, pages, limit: pg.limit, sort: pg.sort, dir: pg.dir, counts: c, adminCount: c.admins, maxAdmins: config.maxAdmins, designations });
}));

r.get('/:id', ah(async (req, res) => {
  const t = await target(req.params.id);
  if (t.id !== req.user.id && !can(req.user, 'users', 'view')) throw forbidden();
  const { password_hash: _p, google_sub: _g, ...u } = t;
  const docs = await many(`SELECT d.id, d.label, f.id AS file_id, f.original_name, f.mime, f.size_bytes, f.verify_status, f.verify_note, f.duplicate_of
                             FROM user_documents d JOIN files f ON f.id=d.file_id WHERE d.user_id=$1 ORDER BY d.id`, [t.id]);
  const files = await many(`SELECT id, kind, original_name, mime, size_bytes, verify_status, verify_note, duplicate_of FROM files WHERE id = ANY($1::bigint[])`, [[t.photo_file_id, t.cv_file_id].filter(Boolean)]);
  const perms = Object.fromEntries((await many('SELECT module, level FROM permissions WHERE user_id=$1', [t.id])).map(p => [p.module, p.level]));
  const bw = await one('SELECT state, valid_until, purpose, max_entry FROM budget_wallets WHERE user_id=$1', [t.id]);
  res.json({ user: u, documents: docs, files, perms, budget: bw ? { ...bw, ...(await walletBalance(null, t.id)) } : null });
}));

r.post('/:id/approve', requirePerm('users', 'edit'), ah(async (req, res) => {
  const t = await target(req.params.id);
  guardTarget(req.user, t);
  if (t.status === 'approved') throw bad('This user is already approved.');
  const perms = isAdmin(req.user) ? cleanPerms(req.body.perms) : {};
  const designation = v.text(req.body.designation, 'Designation', { max: 120 }) || t.designation;
  await tx(async db => {
    await db.query(`UPDATE users SET status='approved', reject_reason=NULL, designation=$1, approved_by=$2, approved_at=NOW(), updated_at=NOW() WHERE id=$3`, [designation, req.user.id, t.id]);
    await setPerms(db, t.id, perms, req.user.id);
    await audit(db, req.user, 'user.approve', 'user', t.id, { perms });
  });
  sendMail(t.email, 'Your account is approved — ScholarshipHive ERP', template({
    title: 'Welcome! Your account is approved', greeting: `Hi ${t.full_name},`,
    lines: [`Employee ID: ${t.employee_code}`, `Your access: ${permText(perms)}`, 'You can now log in with your email and password or with Google.'],
    action: { label: 'Log in', url: link('/login') },
  }));
  res.json({ ok: true });
}));

r.post('/:id/reject', requirePerm('users', 'edit'), ah(async (req, res) => {
  const t = await target(req.params.id);
  guardTarget(req.user, t);
  const reason = v.text(req.body.reason, 'Reason', { max: 500 });
  await query(`UPDATE users SET status='rejected', reject_reason=$1, updated_at=NOW() WHERE id=$2`, [reason || null, t.id]);
  await query('DELETE FROM sessions WHERE user_id=$1', [t.id]);
  await audit(null, req.user, 'user.reject', 'user', t.id, { reason });
  sendMail(t.email, 'Registration update — ScholarshipHive ERP', template({ title: 'Registration not approved', greeting: `Hi ${t.full_name},`, lines: ['Unfortunately your registration was not approved.', reason ? `Reason: ${reason}` : ''].filter(Boolean) }));
  res.json({ ok: true });
}));

r.put('/:id/permissions', requireAdmin, ah(async (req, res) => {
  const t = await target(req.params.id);
  if (isAdmin(t)) throw bad('Admins already have full access.');
  if (t.status !== 'approved') throw bad('Approve the user first.');
  const perms = cleanPerms(req.body.perms);
  await tx(async db => { await setPerms(db, t.id, perms, req.user.id); await audit(db, req.user, 'user.permissions', 'user', t.id, { perms }); });
  sendMail(t.email, 'Your access was updated — ScholarshipHive ERP', template({ title: 'Your page access changed', greeting: `Hi ${t.full_name},`, lines: [`Your access is now: ${permText(perms)}`], action: { label: 'Open ERP', url: link('/') } }));
  res.json({ ok: true, perms });
}));

r.put('/:id/profile', requireAdmin, ah(async (req, res) => {
  const t = await target(req.params.id);
  if (t.role === 'super_admin' && !isSuper(req.user)) throw forbidden();
  const designation = v.text(req.body.designation, 'Designation', { max: 120 }) || null;
  await query('UPDATE users SET designation=$1, updated_at=NOW() WHERE id=$2', [designation, t.id]);
  await audit(null, req.user, 'user.profile', 'user', t.id, { designation });
  res.json({ ok: true });
}));

r.post('/:id/block', requirePerm('users', 'edit'), ah(async (req, res) => {
  const t = await target(req.params.id);
  guardTarget(req.user, t);
  // One PostgreSQL transaction revokes both the ERP browser session and every
  // linked Workforce/mobile credential before the account is considered blocked.
  await tx(async db => {
    await db.query(`UPDATE users SET status='blocked', updated_at=NOW() WHERE id=$1`, [t.id]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [t.id]);
    await db.query(`UPDATE workforce.users wu
      SET is_active=false, erp_managed_disabled=true, updated_at=NOW()
      FROM workforce.erp_user_links l
      WHERE l.erp_user_id=$1 AND wu.id=l.workforce_user_id`, [t.id]);
    await db.query(`UPDATE workforce.auth_sessions s SET revoked_at=NOW()
      FROM workforce.erp_user_links l
      WHERE l.erp_user_id=$1 AND s.user_id=l.workforce_user_id AND s.revoked_at IS NULL`, [t.id]);
    // Invalidate any active Flutter attendance-session token as well. Keep the
    // row for audit/exception review rather than fabricating a checkout time.
    await db.query(`UPDATE workforce.attendance_sessions a
      SET is_active=false, closed_reason='admin_correction', updated_at=NOW()
      FROM workforce.erp_user_links l
      WHERE l.erp_user_id=$1 AND a.user_id=l.workforce_user_id AND a.is_active=true`, [t.id]);
  });
  await audit(null, req.user, 'user.block', 'user', t.id);
  sendMail(t.email, 'Account blocked — ScholarshipHive ERP', template({ title: 'Your account has been blocked', greeting: `Hi ${t.full_name},`, lines: ['Your access to ScholarshipHive ERP has been blocked by admin. Please contact admin for details.'] }));
  res.json({ ok: true });
}));

r.post('/:id/unblock', requirePerm('users', 'edit'), ah(async (req, res) => {
  const t = await target(req.params.id);
  guardTarget(req.user, t);
  if (t.status !== 'blocked') throw bad('This user is not blocked.');
  await tx(async db => {
    await db.query(`UPDATE users SET status='approved', updated_at=NOW() WHERE id=$1`, [t.id]);
    // Restore only profiles disabled by the ERP block operation; do not override
    // an independent HR/Attendance suspension.
    await db.query(`UPDATE workforce.users wu
      SET is_active=true, erp_managed_disabled=false, updated_at=NOW()
      FROM workforce.erp_user_links l
      WHERE l.erp_user_id=$1 AND wu.id=l.workforce_user_id AND wu.erp_managed_disabled=true`, [t.id]);
  });
  await audit(null, req.user, 'user.unblock', 'user', t.id);
  sendMail(t.email, 'Account unblocked — ScholarshipHive ERP', template({ title: 'Your account is active again', greeting: `Hi ${t.full_name},`, lines: ['You can log in again.'], action: { label: 'Log in', url: link('/login') } }));
  res.json({ ok: true });
}));

r.delete('/:id', requirePerm('users', 'edit'), ah(async (req, res) => {
  const t = await target(req.params.id);
  guardTarget(req.user, t);
  const paid = await one(`SELECT 1 FROM payroll_months WHERE user_id=$1 AND status IN ('approved','paid') LIMIT 1`, [t.id]);
  if (paid) throw bad('This user has approved/paid salary records (needed for expenses and reports), so they cannot be deleted. Block the account instead.');
  try {
    await tx(async db => { await db.query('DELETE FROM users WHERE id=$1', [t.id]); await audit(db, req.user, 'user.delete', 'user', t.id, { email: t.email, name: t.full_name }); });
  } catch (e) {
    if (e.code === '23503') throw bad('This user has sales records linked to them, so they cannot be deleted. Block the account instead.');
    throw e;
  }
  res.json({ ok: true });
}));

// ── Admin sends a password reset link (valid 24 h) — also returned so it can be shared on WhatsApp ──
r.post('/:id/reset-link', requireAdmin, ah(async (req, res) => {
  const t = await target(req.params.id);
  guardTarget(req.user, t);
  if (t.status !== 'approved') throw bad('Only approved accounts can reset their password.');
  const url = await createResetLink(t.id, { minutes: 24 * 60, by: req.user.id, ip: (req.ip || '').slice(0, 64) });
  await audit(null, req.user, 'user.reset_link', 'user', t.id);
  sendMail(t.email, 'Set a new password — ScholarshipHive ERP', template({ title: 'Set a new password', greeting: `Hi ${t.full_name},`, lines: [`${req.user.full_name} (admin) sent you a link to set a new password.`, 'The link works once and expires in 24 hours.'], action: { label: 'Choose a new password', url } }));
  res.json({ ok: true, url, emailed: smtpConfigured() });
}));

// ── Admin management (Super Admin only) ──
r.post('/:id/make-admin', requireSuper, ah(async (req, res) => {
  const t = await target(req.params.id);
  if (t.status !== 'approved') throw bad('Only approved users can become admin.');
  if (isAdmin(t)) throw bad('This user is already an admin.');
  const count = Number((await one(`SELECT COUNT(*) AS n FROM users WHERE role IN ('super_admin','admin')`)).n);
  if (count >= config.maxAdmins) throw bad(`Maximum ${config.maxAdmins} admins are allowed (including Super Admin). Remove an admin first.`);
  await tx(async db => {
    await db.query(`UPDATE users SET role='admin', updated_at=NOW() WHERE id=$1`, [t.id]);
    await db.query('DELETE FROM permissions WHERE user_id=$1', [t.id]);
    await audit(db, req.user, 'user.make_admin', 'user', t.id);
  });
  sendMail(t.email, 'You are now an admin — ScholarshipHive ERP', template({ title: 'Admin access granted', greeting: `Hi ${t.full_name},`, lines: ['The Super Admin has given you full admin access.'], action: { label: 'Open ERP', url: link('/') } }));
  res.json({ ok: true });
}));

r.post('/:id/remove-admin', requireSuper, ah(async (req, res) => {
  const t = await target(req.params.id);
  if (t.role !== 'admin') throw bad('This user is not an admin.');
  await query(`UPDATE users SET role='employee', updated_at=NOW() WHERE id=$1`, [t.id]);
  await audit(null, req.user, 'user.remove_admin', 'user', t.id);
  sendMail(t.email, 'Admin access removed — ScholarshipHive ERP', template({ title: 'Admin access removed', greeting: `Hi ${t.full_name},`, lines: ['Your admin access was removed. Admin will assign your page access.'] }));
  res.json({ ok: true });
}));

/** An admin deletes their own account. The Super Admin must hand over to a successor. */
r.post('/me/delete-account', requireAdmin, ah(async (req, res) => {
  const me = await one('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.password || ''), me.password_hash))) throw bad('Password is incorrect.');
  let successor = null;
  if (isSuper(me)) {
    successor = await target(req.body.successor_id);
    if (successor.id === me.id) throw bad('Choose another person as the new Super Admin.');
    if (successor.status !== 'approved') throw bad('The new Super Admin must be an approved user.');
  }
  const paidMe = await one(`SELECT 1 FROM payroll_months WHERE user_id=$1 AND status IN ('approved','paid') LIMIT 1`, [me.id]);
  if (paidMe) throw bad('Your account has approved/paid salary records, so it cannot be deleted. Ask the Super Admin to remove your admin role instead.');
  try {
    await tx(async db => {
      if (successor) {
        await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [me.id]); // frees the single super_admin slot
        await db.query(`UPDATE users SET role='super_admin', updated_at=NOW() WHERE id=$1`, [successor.id]);
        await db.query('DELETE FROM permissions WHERE user_id=$1', [successor.id]);
      }
      await audit(db, req.user, 'user.self_delete', 'user', me.id, { successor: successor?.id || null });
      await db.query('DELETE FROM users WHERE id=$1', [me.id]);
    });
  } catch (e) {
    if (e.code === '23503') throw bad('Your account is linked to sales records as a salesperson, so it cannot be deleted. Transfer is not completed.');
    throw e;
  }
  if (successor) sendMail(successor.email, 'You are now the Super Admin — ScholarshipHive ERP', template({ title: 'Super Admin handed over to you', greeting: `Hi ${successor.full_name},`, lines: [`${me.full_name} deleted their account and made you the Super Admin with full access.`], action: { label: 'Open ERP', url: link('/') } }));
  await destroySession(req, res);
  res.json({ ok: true });
}));

export default r;

// ───────────────── Files ─────────────────
export const files = express.Router();
files.use(requireAuth);

function canSeeFile(user, f) {
  if (isAdmin(user) || f.owner_id === user.id) return true;
  if (f.kind === 'photo' || f.kind === 'owner_image' || f.kind === 'owner_cv') return true;
  if (['cv', 'document'].includes(f.kind)) return can(user, 'users', 'view');
  if (f.kind === 'expense_receipt') return can(user, 'expenses', 'view');
  if (f.kind === 'petty_receipt') return can(user, 'petty_cash', 'view');
  if (f.kind === 'sale_document') return can(user, 'revenue', 'view');
  return false;
}

files.get('/:id', ah(async (req, res) => {
  const f = await one('SELECT * FROM files WHERE id=$1', [v.id(req.params.id)]);
  if (!f) throw notFound('File not found.');
  if (!canSeeFile(req.user, f)) throw forbidden();
  if (!f.data) throw notFound('The file content is missing (it was uploaded before files moved to the database).');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=600');
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${f.original_name.replace(/"/g, '')}"`);
  res.setHeader('Content-Length', f.data.length);
  res.end(f.data);
}));

files.post('/:id/verify', ah(async (req, res) => {
  const f = await one('SELECT * FROM files WHERE id=$1', [v.id(req.params.id)]);
  if (!f) throw notFound('File not found.');
  const mod = f.kind === 'expense_receipt' ? 'expenses' : f.kind === 'petty_receipt' ? 'petty_cash' : f.kind === 'sale_document' ? 'revenue' : 'users';
  if (!can(req.user, mod, 'edit')) throw forbidden();
  const status = v.oneOf(req.body.status, ['verified', 'rejected', 'unverified'], 'Status');
  const note = v.text(req.body.note, 'Note', { max: 300 }) || null;
  await query('UPDATE files SET verify_status=$1, verify_note=$2, verified_by=$3, verified_at=NOW() WHERE id=$4', [status, note, req.user.id, f.id]);
  await audit(null, req.user, 'file.verify', 'file', f.id, { status, note });
  res.json({ ok: true });
}));

// ───────────────── Requests to admin ─────────────────
export const requests = express.Router();
requests.use(requireAuth);

requests.post('/', ah(async (req, res) => {
  const type = v.oneOf(req.body.type || 'access', ['access', 'profile', 'other'], 'Request type');
  let module = null, level = null;
  if (type === 'access') {
    module = v.oneOf(req.body.module, MODULE_KEYS, 'Page');
    level = v.oneOf(req.body.level || 'view', ['view', 'edit'], 'Access level');
  }
  const message = v.text(req.body.message, 'Message', { required: type !== 'access', max: 1000 });
  const open = await one(`SELECT 1 FROM user_requests WHERE user_id=$1 AND status='open' AND type=$2 AND module IS NOT DISTINCT FROM $3`, [req.user.id, type, module]);
  if (open) throw bad('You already have an open request for this. Please wait for admin.');
  const row = await one('INSERT INTO user_requests(user_id,type,module,level,message) VALUES ($1,$2,$3,$4,$5) RETURNING *', [req.user.id, type, module, level, message]);
  sendMail(await adminEmails(), `New request from ${req.user.full_name}`, template({
    title: 'New request', lines: [`${req.user.full_name} (${req.user.employee_code}) sent a ${type} request.`, module ? `Page: ${MODULES.find(m => m.key === module)?.label} — ${level}` : '', message].filter(Boolean),
    action: { label: 'Review', url: link('/settings/admin?tab=requests') },
  }));
  res.status(201).json(row);
}));

requests.get('/mine', ah(async (req, res) => {
  res.json(await many('SELECT * FROM user_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]));
}));

requests.get('/', requireAdmin, ah(async (req, res) => {
  res.json(await many(`SELECT q.*, u.full_name, u.employee_code, u.email, u.photo_file_id FROM user_requests q JOIN users u ON u.id=q.user_id
                       ORDER BY CASE q.status WHEN 'open' THEN 0 ELSE 1 END, q.created_at DESC LIMIT 200`));
}));

requests.post('/:id/handle', requireAdmin, ah(async (req, res) => {
  const q = await one('SELECT q.*, u.email, u.full_name, u.role FROM user_requests q JOIN users u ON u.id=q.user_id WHERE q.id=$1', [v.id(req.params.id)]);
  if (!q) throw notFound();
  if (q.status !== 'open') throw bad('This request was already handled.');
  const decision = v.oneOf(req.body.decision, ['approved', 'declined'], 'Decision');
  const response = v.text(req.body.response, 'Response', { max: 1000 }) || null;
  await tx(async db => {
    await db.query('UPDATE user_requests SET status=$1, response=$2, handled_by=$3, handled_at=NOW() WHERE id=$4', [decision, response, req.user.id, q.id]);
    if (decision === 'approved' && q.type === 'access' && q.module && q.role === 'employee') {
      await db.query(`INSERT INTO permissions(user_id,module,level,granted_by) VALUES ($1,$2,$3,$4)
                      ON CONFLICT (user_id,module) DO UPDATE SET level=EXCLUDED.level, granted_by=EXCLUDED.granted_by, granted_at=NOW()`, [q.user_id, q.module, q.level, req.user.id]);
    }
    await audit(db, req.user, 'request.' + decision, 'request', q.id);
  });
  sendMail(q.email, `Your request was ${decision}`, template({ title: `Request ${decision}`, greeting: `Hi ${q.full_name},`, lines: [q.module ? `Page: ${MODULES.find(m => m.key === q.module)?.label} (${q.level})` : `Request: ${q.message}`, response ? `Admin note: ${response}` : ''].filter(Boolean), action: { label: 'Open ERP', url: link('/') } }));
  res.json({ ok: true });
}));

// ───────────────── Admin system tools ─────────────────
export const admin = express.Router();
admin.use(requireAuth, requireAdmin);
admin.get('/email-log', ah(async (_req, res) => res.json(await many('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 200'))));
admin.get('/audit', ah(async (_req, res) => res.json(await many('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 300'))));
admin.post('/test-email', ah(async (req, res) => {
  const check = await verifySmtp();
  if (!check.ok) throw bad('SMTP problem: ' + check.error);
  await sendMail(req.user.email, 'Test email — ScholarshipHive ERP', template({ title: 'Email is working ✔', lines: ['Gmail SMTP is configured correctly.'] }));
  const last = await one('SELECT status, error FROM email_log WHERE to_email=$1 ORDER BY id DESC LIMIT 1', [req.user.email]);
  if (last?.status !== 'sent') throw bad('Sending failed: ' + (last?.error || 'unknown error'));
  res.json({ ok: true, to: req.user.email });
}));

// Owner information moved to routes/owner.js (portfolio profile).
