const { HttpError } = require('../utils/http');
const auth = require('../services/auth.service');
const pool = require('../db/pool');

let lastIdentitySync = 0;
let identitySyncPromise = null;
function toMarketingRole(erpUser) {
  return ['admin', 'super_admin'].includes(String(erpUser?.role || '').toLowerCase()) ? 'Admin' : 'Employee';
}
async function upsertErpUser(erpUser) {
  const erpUserId = Number(erpUser?.id);
  const email = String(erpUser?.email || '').trim().toLowerCase();
  if (!Number.isSafeInteger(erpUserId) || erpUserId <= 0 || !email) {
    throw new HttpError(403, 'Your ERP account needs a valid central identity and email address before Marketing Analyzer access can be enabled.');
  }
  const name = String(erpUser.full_name || erpUser.name || email).trim().slice(0, 160) || email;
  const role = toMarketingRole(erpUser);
  const status = String(erpUser.status || '').toLowerCase() === 'approved' ? 'Active' : 'Inactive';
  const initials = name.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
  await pool.query(`
    INSERT INTO marketing.users(name,email,role,status,initials,erp_user_id)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT (erp_user_id) WHERE erp_user_id IS NOT NULL
    DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, role=EXCLUDED.role,
      status=EXCLUDED.status, initials=EXCLUDED.initials, updated_at=now()
  `, [name, email, role, status, initials, erpUserId]);
  const result = await pool.query('SELECT id, name, email, role, status, initials FROM marketing.users WHERE erp_user_id=$1', [erpUserId]);
  if (!result.rows[0] || result.rows[0].status !== 'Active') throw new HttpError(403, 'Your ScholarshipHive account is not approved for Marketing Analyzer access.');
  return result.rows[0];
}
async function syncApprovedErpUsers() {
  if (Date.now() - lastIdentitySync < 60000) return;
  if (identitySyncPromise) return identitySyncPromise;
  identitySyncPromise = (async () => {
    const { rows } = await pool.query(`SELECT id, full_name, email, role, status FROM public.users WHERE status='approved' AND COALESCE(email,'')<>''`);
    for (const user of rows) await upsertErpUser(user);
    lastIdentitySync = Date.now();
  })().finally(() => { identitySyncPromise = null; });
  return identitySyncPromise;
}

async function requireAuth(req, _res, next) {
  try {
    // Shared ERP request path: sessionLoader has already verified the signed-in
    // ERP cookie. Never accept an arbitrary user id from request headers/body.
    if (req.erpUser) {
      const erp = req.erpUser;
      const p = erp.perms?.marketing;
      const admin = ['admin', 'super_admin'].includes(String(erp.role || '').toLowerCase());
      const allowed = admin || p === 'view' || p === 'edit';
      if (!allowed) throw new HttpError(403, 'Marketing Analyzer permission is required.');
      if (String(erp.role || '').toLowerCase() === 'admin' || String(erp.role || '').toLowerCase() === 'super_admin') await syncApprovedErpUsers();
      req.user = await upsertErpUser(erp);
      req.marketingVia = 'erp-sso';
      return next();
    }
    // Standalone compatibility for local legacy development only.
    if (process.env.NODE_ENV === 'production') throw new HttpError(401, 'Sign in through ScholarshipHive ERP.');
    const header = req.get('authorization') || '';
    const token = /^Bearer [a-f0-9]{64}$/i.test(header) ? header.slice(7) : null;
    const user = token ? await auth.resolve(token) : null;
    if (!user) throw new HttpError(401, 'Sign in through ScholarshipHive ERP.');
    req.user = user;
    req.sessionToken = token;
    return next();
  } catch (err) { return next(err); }
}
const adminOnly = (req, _res, next) => req.user?.role === 'Admin' ? next() : next(new HttpError(403, 'ScholarshipHive administrator access required.'));
module.exports = { requireAuth, adminOnly, upsertErpUser, syncApprovedErpUsers };
