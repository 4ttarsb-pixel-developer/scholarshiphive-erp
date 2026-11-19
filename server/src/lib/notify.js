import { query, many } from '../db.js';

/**
 * Adds an in-app notification for each user (duplicates with the same dedupe key are ignored).
 * Returns the ids of users that actually received a new notification. Never throws.
 */
export async function notify(db, userIds, { kind = 'info', title, body = '', link = null, dedupe = null, meta = {} }) {
  const ids = [...new Set((userIds || []).filter(Boolean).map(Number))];
  const got = [];
  for (const uid of ids) {
    try {
      const r = await (db || { query }).query(
        `INSERT INTO notifications(user_id,kind,title,body,link,dedupe_key,meta) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING user_id`,
        [uid, kind, String(title).slice(0, 200), String(body || '').slice(0, 2000), link, dedupe, JSON.stringify(meta || {})]);
      if (r.rowCount) got.push(uid);
    } catch (e) { console.error('[notify]', e.message); }
  }
  return got;
}

/** Approved admins + users with the given permission level on a module. */
export async function usersWith(module, level = 'view') {
  return (await many(
    `SELECT DISTINCT u.id FROM users u LEFT JOIN permissions p ON p.user_id=u.id AND p.module=$1
      WHERE u.status='approved' AND (u.role IN ('super_admin','admin') OR (p.level IS NOT NULL AND ($2='view' OR p.level='edit')))`, [module, level])).map(r => r.id);
}
