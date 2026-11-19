import { query } from '../db.js';

/** Records who did what. Never throws. `db` can be a transaction client. */
export async function audit(db, user, action, entity, entityId, details = {}) {
  try {
    await (db || { query }).query(
      'INSERT INTO audit_log(user_id,user_name,action,entity,entity_id,details,ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [user?.id || null, user?.full_name || 'System', action, entity || null, entityId == null ? null : String(entityId), JSON.stringify(details), user?.ip || null]);
  } catch (e) { console.error('[audit]', e.message); }
}

/** Field-by-field difference between two records (for "what changed" in the audit log). */
export function diff(before, after, keys) {
  const out = {};
  for (const k of keys) {
    const a = before?.[k] ?? null, b = after?.[k] ?? null;
    if (String(a) !== String(b)) out[k] = { from: a, to: b };
  }
  return out;
}
