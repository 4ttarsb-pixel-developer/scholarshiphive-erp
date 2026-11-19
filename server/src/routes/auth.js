import crypto from 'node:crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import { config, googleConfigured, smtpConfigured } from '../config.js';
import { one, query, tx } from '../db.js';
import { ah, bad, HttpError } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { passwordPolicy } from '../lib/forms.js';
import { upload, saveFile, checkFile, txWithFiles } from '../lib/files.js';
import { sendMail, template, adminEmails, link } from '../lib/email.js';
import { audit } from '../lib/audit.js';
import { authUrl, verifyCode, seal, unseal, GV_COOKIE, STATE_COOKIE } from '../lib/google.js';
import { createSession, destroySession, requireAuth, cookieOptions, rateLimit, loadPerms, loadBudget } from '../middleware/auth.js';
import { isAdmin, MODULES } from '../lib/permissions.js';

const r = express.Router();
const DUMMY_HASH = bcrypt.hashSync('timing-safe-dummy-password', 10);

const superExists = async () => Boolean(await one(`SELECT 1 FROM users WHERE role='super_admin'`));

export function publicUser(u, perms) {
  return {
    id: u.id, employee_code: u.employee_code, role: u.role, status: u.status, full_name: u.full_name, email: u.email,
    theme: u.theme, font_size: u.font_size, language: u.language || 'en', photo_file_id: u.photo_file_id, designation: u.designation,
    perms: isAdmin(u) ? Object.fromEntries(MODULES.map(m => [m.key, 'edit'])) : (perms || u.perms || {}),
    budget: u.budget || null,
  };
}

// ── Bootstrap: everything the front-end needs on first load ──
r.get('/bootstrap', ah(async (req, res) => {
  const gv = unseal(req.cookies?.[GV_COOKIE]);
  res.json({
    setupDone: await superExists(),
    google: { configured: googleConfigured(), devBypass: config.google.devBypass },
    smtpConfigured: smtpConfigured(),
    verified: gv ? { email: gv.email, name: gv.name, picture: gv.picture, mode: gv.mode } : null,
    user: req.user ? publicUser(req.user) : null,
    sessionExpired: Boolean(req.sessionExpired),
    idleMinutes: config.sessionIdleMinutes,
    modules: MODULES,
    company: config.companyName,
    passwordPolicy: await passwordPolicy(),
  });
}));

r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

r.post('/ping', requireAuth, (req, res) => res.json({ ok: true, idleMinutes: config.sessionIdleMinutes }));
r.get('/session-status', (req, res) => {
  if (!req.user) return res.json({ active: false, expired: Boolean(req.sessionExpired) });
  res.json({ active: true, remainingSec: Math.max(0, config.sessionIdleMinutes * 60 - Math.round(req.sessionIdleSec || 0)) });
});

// ── Google OAuth ──
r.get('/google/start', ah(async (req, res) => {
  const mode = ['setup', 'register', 'login', 'reset'].includes(req.query.mode) ? req.query.mode : 'login';
  const back = mode === 'setup' ? '/setup' : mode === 'register' ? '/register' : mode === 'reset' ? '/forgot-password' : '/login';
  if (!googleConfigured()) return res.redirect(`${back}?error=${encodeURIComponent('Google sign-in is not configured yet. Admin must add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env (see SETUP_GUIDE.md).')}`);
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(STATE_COOKIE, seal({ state, mode }, 600), cookieOptions(600 * 1000));
  res.redirect(authUrl(state));
}));

r.get('/google/callback', ah(async (req, res) => {
  const saved = unseal(req.cookies?.[STATE_COOKIE]);
  res.clearCookie(STATE_COOKIE, cookieOptions());
  const mode = saved?.mode || 'login';
  const back = mode === 'setup' ? '/setup' : mode === 'register' ? '/register' : mode === 'reset' ? '/forgot-password' : '/login';
  const fail = msg => res.redirect(`${back}?error=${encodeURIComponent(msg)}`);
  if (req.query.error) return fail('Google sign-in was cancelled.');
  if (!saved || !req.query.state || req.query.state !== saved.state) return fail('Google sign-in expired. Please try again.');
  let g;
  try { g = await verifyCode(String(req.query.code || '')); } catch (e) { console.error('[google]', e.message); return fail('Google verification failed. Please try again.'); }

  if (mode === 'login') {
    const u = await one('SELECT * FROM users WHERE google_sub=$1 OR (lower(email)=$2 AND google_verified)', [g.sub, g.email]);
    if (!u) return fail('No account is registered with this Google email. Please register first.');
    const problem = statusProblem(u);
    if (problem) return fail(problem);
    if (!u.google_sub) await query('UPDATE users SET google_sub=$1 WHERE id=$2', [g.sub, u.id]);
    await createSession(res, req, u.id);
    await audit(null, u, 'login.google', 'user', u.id);
    return res.redirect('/');
  }
  if (mode === 'reset') {
    const u = await one('SELECT * FROM users WHERE google_sub=$1 OR lower(email)=$2', [g.sub, g.email]);
    if (!u) return fail('No account uses this Google email. Ask admin, or register first.');
    if (u.status !== 'approved') return fail(statusProblem(u) || 'This account is not active.');
    res.cookie(GV_COOKIE, seal({ sub: g.sub, email: g.email, name: g.name, mode: 'reset', uid: u.id }, 15 * 60), cookieOptions(15 * 60 * 1000));
    return res.redirect('/reset-password?google=verified');
  }
  if (mode === 'setup' && await superExists()) return res.redirect('/login?error=' + encodeURIComponent('Setup is already complete. Please log in.'));
  const exists = await one('SELECT 1 FROM users WHERE lower(email)=$1 OR google_sub=$2', [g.email, g.sub]);
  if (exists) return fail('This Google email is already registered. Please log in instead.');
  res.cookie(GV_COOKIE, seal({ ...g, mode }, 30 * 60), cookieOptions(30 * 60 * 1000));
  res.redirect(`${back}?google=verified`);
}));

// Development only: lets you test registration before Google credentials exist.
r.post('/google/dev-verify', ah(async (req, res) => {
  if (!config.google.devBypass) throw bad('Development bypass is disabled. Use real Google verification.');
  const email = v.email(req.body.email);
  const name = v.text(req.body.name, 'Name', { max: 120 });
  const mode = req.body.mode === 'setup' ? 'setup' : 'register';
  if (await one('SELECT 1 FROM users WHERE lower(email)=$1', [email])) throw bad('This email is already registered.');
  res.cookie(GV_COOKIE, seal({ sub: 'dev-' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 20), email, name, picture: '', mode, dev: true }, 30 * 60), cookieOptions(30 * 60 * 1000));
  res.json({ ok: true, email });
}));

r.post('/google/clear', (req, res) => { res.clearCookie(GV_COOKIE, cookieOptions()); res.json({ ok: true }); });

function requireGoogle(req) {
  const gv = unseal(req.cookies?.[GV_COOKIE]);
  if (!gv) throw bad('Please verify your email with Google first (Google verification expires after 30 minutes).');
  return gv;
}

function statusProblem(u) {
  if (u.status === 'pending') return 'Your registration is waiting for admin approval. You will receive an email once approved.';
  if (u.status === 'rejected') return 'Your registration was not approved' + (u.reject_reason ? `: ${u.reject_reason}` : '.');
  if (u.status === 'blocked') return 'Your account has been blocked by admin.';
  return null;
}

const registerFiles = upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'cv', maxCount: 1 }, { name: 'documents', maxCount: 5 }]);

function parseEducation(raw, required) {
  const list = v.json(raw, []);
  if (!Array.isArray(list)) throw bad('Education details are not valid.');
  const rows = list.slice(0, 10).map((e, i) => ({
    degree: v.text(e?.degree, `Education #${i + 1} degree`, { required: true, max: 120 }),
    institute: v.text(e?.institute, `Education #${i + 1} institute`, { required: true, max: 160 }),
    year: v.text(e?.year, `Education #${i + 1} passing year`, { required: true, max: 4 }),
    grade: v.text(e?.grade, `Education #${i + 1} grade/CGPA`, { max: 40 }),
  }));
  rows.forEach((e, i) => { if (!/^(19|20)\d{2}$/.test(e.year)) throw bad(`Education #${i + 1} passing year must be like 2024.`); });
  if (required && !rows.length) throw bad('Please add at least one education record.');
  return rows;
}

function personalFields(b, strict) {
  const out = {
    father_name: v.text(b.father_name, 'Father name', { required: strict, max: 120 }) || null,
    cnic: v.cnic(b.cnic, { required: strict }),
    phone1: v.phone(b.phone1, 'Contact number 1', { required: strict }),
    phone2: v.phone(b.phone2, 'Contact number 2', { required: strict }),
    address: v.text(b.address, 'Current address', { required: strict, max: 500 }) || null,
    permanent_address: v.text(b.permanent_address, 'Permanent address', { required: strict, max: 500 }) || null,
    family_background: v.optText(b.family_background, 'Family background', 2000),
    last_job_reason: v.optText(b.last_job_reason, 'Reason for leaving last job', 2000),
    about: v.optText(b.about, 'About note', 2000),
    designation: v.text(b.designation, 'Designation', { max: 120 }) || null,
  };
  if (out.phone1 && out.phone2 && out.phone1 === out.phone2) throw bad('Contact number 1 and Contact number 2 must be different.');
  return out;
}

async function nextEmployeeCode(db) {
  const { rows } = await db.query(`SELECT 'SH-' || lpad(nextval('employee_code_seq')::text, 4, '0') AS code`);
  return rows[0].code;
}

// ── First-time setup: creates the Super Admin ──
r.post('/setup', rateLimit('setup', 10, 15 * 60 * 1000), registerFiles, ah(async (req, res) => {
  if (await superExists()) throw bad('Setup is already complete. Please log in.');
  const gv = requireGoogle(req);
  const b = req.body;
  const full_name = v.text(b.full_name, 'Full name', { required: true, max: 120, min: 3 });
  const password = v.password(b.password, b.confirm_password, await passwordPolicy());
  const photo = req.files?.photo?.[0];
  if (!photo) throw bad('Profile picture is required.');
  const p = personalFields(b, false);
  const education = parseEducation(b.education, false);
  const hash = await bcrypt.hash(password, 12);
  let user;
  try {
    user = await txWithFiles(async db => {
      const code = await nextEmployeeCode(db);
      const u = (await db.query(
        `INSERT INTO users(employee_code,role,status,full_name,email,google_sub,google_verified,password_hash,education,approved_at,
           father_name,cnic,phone1,phone2,address,permanent_address,family_background,last_job_reason,about,designation)
         VALUES ($1,'super_admin','approved',$2,$3,$4,$17,$5,$6,NOW(),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [code, full_name, gv.email, gv.dev ? null : gv.sub, hash, JSON.stringify(education), p.father_name, p.cnic, p.phone1, p.phone2, p.address,
          p.permanent_address, p.family_background, p.last_job_reason, p.about, p.designation || 'Owner / Super Admin', !gv.dev])).rows[0];
      const f = await saveFile(db, photo, 'photo', u.id);
      await db.query(`UPDATE files SET verify_status='verified', verified_by=$1, verified_at=NOW() WHERE id=$2`, [u.id, f.id]);
      await db.query('UPDATE users SET photo_file_id=$1 WHERE id=$2', [f.id, u.id]);
      if (req.files?.cv?.[0]) { const cv = await saveFile(db, req.files.cv[0], 'cv', u.id); await db.query('UPDATE users SET cv_file_id=$1 WHERE id=$2', [cv.id, u.id]); }
      await audit(db, u, 'setup.super_admin', 'user', u.id);
      return u;
    });
  } catch (e) {
    if (e.code === '23505' && String(e.constraint || '').includes('one_super_admin')) throw bad('Setup is already complete. Please log in.');
    throw e;
  }
  res.clearCookie(GV_COOKIE, cookieOptions());
  await createSession(res, req, user.id);
  sendMail(user.email, 'Your ScholarshipHive ERP Super Admin account is ready', template({
    title: 'Super Admin account created', greeting: `Hi ${user.full_name},`,
    lines: ['You are now the Super Admin of ScholarshipHive ERP and have full access.', 'Employees can now register; their requests will appear under Settings → Requests.'],
    action: { label: 'Open ERP', url: link('/') },
  }));
  res.status(201).json({ user: publicUser(user, {}) });
}));

// ── Employee registration ──
r.post('/register', rateLimit('register', 10, 15 * 60 * 1000), registerFiles, ah(async (req, res) => {
  if (!(await superExists())) throw bad('The system is not set up yet. Admin must complete first-time setup.');
  const gv = requireGoogle(req);
  const b = req.body;
  const full_name = v.text(b.full_name, 'Full name', { required: true, max: 120, min: 3 });
  const p = personalFields(b, true);
  const education = parseEducation(b.education, true);
  const password = v.password(b.password, b.confirm_password, await passwordPolicy());
  const photo = req.files?.photo?.[0];
  const cv = req.files?.cv?.[0];
  const docs = req.files?.documents || [];
  if (!photo) throw bad('Profile picture is required.');
  if (!cv) throw bad('CV is required.');
  if (!docs.length) throw bad('Please attach at least one document (e.g. CNIC copy or degree).');
  const labels = v.json(b.document_labels, []);
  // Validate all files up-front so nothing is saved if one is fake.
  checkFile(photo, 'photo'); checkFile(cv, 'cv'); docs.forEach(d => checkFile(d, 'document'));
  const hash = await bcrypt.hash(password, 12);

  const user = await txWithFiles(async db => {
    const code = await nextEmployeeCode(db);
    const u = (await db.query(
      `INSERT INTO users(employee_code,role,status,full_name,email,google_sub,google_verified,password_hash,education,
         father_name,cnic,phone1,phone2,address,permanent_address,family_background,last_job_reason,about,designation)
       VALUES ($1,'employee','pending',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [code, full_name, gv.email, gv.dev ? null : gv.sub, !gv.dev, hash, JSON.stringify(education), p.father_name, p.cnic, p.phone1, p.phone2,
        p.address, p.permanent_address, p.family_background, p.last_job_reason, p.about, p.designation])).rows[0];
    const f = await saveFile(db, photo, 'photo', u.id);
    const c = await saveFile(db, cv, 'cv', u.id);
    await db.query('UPDATE users SET photo_file_id=$1, cv_file_id=$2 WHERE id=$3', [f.id, c.id, u.id]);
    for (let i = 0; i < docs.length; i++) {
      const d = await saveFile(db, docs[i], 'document', u.id);
      const label = String(Array.isArray(labels) ? labels[i] || '' : '').trim().slice(0, 120) || `Document ${i + 1}`;
      await db.query('INSERT INTO user_documents(user_id,file_id,label) VALUES ($1,$2,$3)', [u.id, d.id, label]);
    }
    await audit(db, u, 'register', 'user', u.id);
    return u;
  });
  res.clearCookie(GV_COOKIE, cookieOptions());
  sendMail(user.email, 'Registration received — ScholarshipHive ERP', template({
    title: 'We received your registration', greeting: `Hi ${user.full_name},`,
    lines: [`Your employee ID is ${user.employee_code}.`, 'Your request is now waiting for admin approval. You will get another email as soon as admin approves it and assigns your role.'],
  }));
  sendMail(await adminEmails(), `New registration request: ${user.full_name} (${user.employee_code})`, template({
    title: 'New employee registration', lines: [`${user.full_name} (${user.email}) registered and is waiting for approval.`],
    action: { label: 'Review request', url: link('/settings/admin?tab=requests') },
  }));
  res.status(201).json({ ok: true, employee_code: user.employee_code });
}));

// ── Login / logout ──
r.post('/login', rateLimit('login', 10, 15 * 60 * 1000), ah(async (req, res) => {
  const email = v.email(req.body.email);
  const pw = String(req.body.password || '');
  const u = await one('SELECT * FROM users WHERE lower(email)=$1', [email]);
  const ok = await bcrypt.compare(pw, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'Email or password is incorrect.');
  const problem = statusProblem(u);
  if (problem) throw new HttpError(403, problem, { code: 'ACCOUNT_' + u.status.toUpperCase() });
  await createSession(res, req, u.id);
  await audit(null, u, 'login', 'user', u.id);
  u.budget = await loadBudget(u.id);
  res.json({ user: publicUser(u, await loadPerms(u.id)) });
}));

r.post('/logout', ah(async (req, res) => { await destroySession(req, res); res.json({ ok: true }); }));

// ── Personal settings ──
r.put('/preferences', requireAuth, ah(async (req, res) => {
  const theme = req.body.theme !== undefined ? v.oneOf(req.body.theme, ['light', 'dark'], 'Theme') : req.user.theme;
  const font = req.body.font_size !== undefined ? v.oneOf(req.body.font_size, ['small', 'normal', 'large', 'xlarge'], 'Font size') : req.user.font_size;
  const language = req.body.language !== undefined ? v.oneOf(req.body.language, ['en', 'roman', 'ur'], 'Language') : (req.user.language || 'en');
  await query('UPDATE users SET theme=$1, font_size=$2, language=$3, updated_at=NOW() WHERE id=$4', [theme, font, language, req.user.id]);
  res.json({ ok: true, theme, font_size: font, language });
}));

r.put('/password', requireAuth, rateLimit('pw', 10, 15 * 60 * 1000), ah(async (req, res) => {
  const u = await one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.current_password || ''), u.password_hash))) throw bad('Current password is incorrect.');
  const pw = v.password(req.body.new_password, req.body.confirm_password, await passwordPolicy());
  await query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2', [await bcrypt.hash(pw, 12), req.user.id]);
  await audit(null, req.user, 'password.change', 'user', req.user.id);
  sendMail(req.user.email, 'Your password was changed', template({ title: 'Password changed', greeting: `Hi ${req.user.full_name},`, lines: ['Your ScholarshipHive ERP password was just changed. If this was not you, contact admin immediately.'] }));
  res.json({ ok: true });
}));

// ═════════ Forgot password ═════════
// The link holds a random 256-bit token; only its SHA-256 is stored. Links expire, work once and
// log the person out everywhere. The answer never reveals whether an email is registered.
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const RESET_MINUTES = 30;

export async function createResetLink(userId, { minutes = RESET_MINUTES, by = null, ip = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await query('UPDATE password_resets SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL', [userId]); // older links stop working
  await query(`INSERT INTO password_resets(user_id,token_hash,expires_at,requested_by,ip) VALUES ($1,$2,NOW() + ($3 || ' minutes')::interval,$4,$5)`, [userId, sha(token), String(minutes), by, ip]);
  return link(`/reset-password?token=${token}`);
}

const GENERIC = 'If this email belongs to an active account, a reset link has been sent. Check your inbox and spam folder. The link works for 30 minutes.';
r.post('/forgot', rateLimit('forgot', 5, 15 * 60 * 1000), ah(async (req, res) => {
  const email = v.email(req.body.email);
  const u = await one(`SELECT id, full_name, email, status FROM users WHERE lower(email)=$1`, [email]);
  let devLink;
  if (u && u.status === 'approved') {
    const url = await createResetLink(u.id, { ip: (req.ip || '').slice(0, 64) });
    await audit(null, u, 'password.reset_requested', 'user', u.id);
    sendMail(u.email, 'Reset your ScholarshipHive ERP password', template({
      title: 'Reset your password', greeting: `Hi ${u.full_name},`,
      lines: ['We received a request to reset your password. Click the button below to choose a new one.', `This link works once and expires in ${RESET_MINUTES} minutes.`, 'If you did not ask for this, ignore this email — your password stays the same.'],
      action: { label: 'Choose a new password', url },
    }));
    if (!config.isProd && !smtpConfigured()) devLink = url; // local testing only, never in production
  } else {
    await bcrypt.compare('x', DUMMY_HASH); // same timing whether or not the email exists
  }
  res.json({ ok: true, message: GENERIC, emailEnabled: smtpConfigured(), googleEnabled: googleConfigured(), ...(devLink ? { devLink } : {}) });
}));

async function tokenUser(token) {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(t)) return null;
  return one(`SELECT pr.id AS reset_id, u.id, u.full_name, u.email, u.status FROM password_resets pr JOIN users u ON u.id=pr.user_id
               WHERE pr.token_hash=$1 AND pr.used_at IS NULL AND pr.expires_at > NOW()`, [sha(t)]);
}
const mask = e => e.replace(/^(.{2})[^@]*(@.*)$/, (_, a, b) => a + '•••' + b);

r.get('/reset/check', rateLimit('reset-check', 30, 15 * 60 * 1000), ah(async (req, res) => {
  if (req.query.google === '1') {
    const gv = unseal(req.cookies?.[GV_COOKIE]);
    if (gv?.mode !== 'reset') throw bad('Google verification expired. Please start again.');
    return res.json({ ok: true, email: mask(gv.email), via: 'google' });
  }
  const u = await tokenUser(req.query.token);
  if (!u || u.status !== 'approved') throw bad('This reset link is invalid or has expired. Please request a new one.');
  res.json({ ok: true, email: mask(u.email), via: 'email' });
}));

r.post('/reset', rateLimit('reset', 10, 15 * 60 * 1000), ah(async (req, res) => {
  const pw = v.password(req.body.password, req.body.confirm_password, await passwordPolicy());
  let userId, resetId = null;
  if (req.body.token) {
    const u = await tokenUser(req.body.token);
    if (!u || u.status !== 'approved') throw bad('This reset link is invalid or has expired. Please request a new one.');
    userId = u.id; resetId = u.reset_id;
  } else {
    const gv = unseal(req.cookies?.[GV_COOKIE]);
    if (gv?.mode !== 'reset' || !gv.uid) throw bad('Google verification expired. Please start again.');
    const u = await one('SELECT id, status FROM users WHERE id=$1', [gv.uid]);
    if (!u || u.status !== 'approved') throw bad('This account is not active.');
    userId = u.id;
  }
  const hash = await bcrypt.hash(pw, 12);
  const u = await tx(async db => {
    if (resetId) {
      const used = await db.query('UPDATE password_resets SET used_at=NOW() WHERE id=$1 AND used_at IS NULL', [resetId]);
      if (!used.rowCount) throw bad('This reset link was already used.');
    }
    await db.query('UPDATE password_resets SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL', [userId]);
    const row = (await db.query('UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2 RETURNING id, full_name, email', [hash, userId])).rows[0];
    await db.query('DELETE FROM sessions WHERE user_id=$1', [userId]); // log out everywhere
    await audit(db, row, 'password.reset', 'user', userId, { via: resetId ? 'email-link' : 'google' });
    return row;
  });
  res.clearCookie(GV_COOKIE, cookieOptions());
  sendMail(u.email, 'Your password was reset', template({ title: 'Password reset', greeting: `Hi ${u.full_name},`, lines: ['Your ScholarshipHive ERP password was just reset and you were logged out of all devices.', 'If this was not you, contact admin immediately.'], action: { label: 'Log in', url: link('/login') } }));
  res.json({ ok: true });
}));

export default r;
