'use strict';
const knex = require('../db');

/**
 * Append an audit entry. Pass the transaction (trx) so the audit row commits
 * atomically with the change it describes.
 */
async function audit(db, { actor, action, entityType, entityId, detail, before, after, ip }) {
  await (db || knex)('audit_logs').insert({
    actor_id: actor?.id || null,
    actor_name: actor ? (actor.fullName || actor.username || 'System') : 'System',
    action,
    entity_type: entityType || null,
    entity_id: entityId === undefined || entityId === null ? null : String(entityId),
    detail: detail || null,
    before_data: before ? JSON.stringify(before) : null,
    after_data: after ? JSON.stringify(after) : null,
    ip: ip || null,
  });
}

async function activity(db, { username, userId, action, allowed = true, message = '', ip }) {
  try {
    await (db || knex)('activity_logs').insert({
      username: username || null, user_id: userId || null, action, allowed, message: String(message || '').slice(0, 500), ip_address: ip || null,
    });
  } catch (_) { /* activity logging must never break login */ }
}

module.exports = { audit, activity };
