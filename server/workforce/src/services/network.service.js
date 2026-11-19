'use strict';
const knex = require('../db');
const { officeNetworkMatches, normalizeOfficeNetwork, normalizeForSave } = require('../utils/ip');

async function approvedOfficeNetwork(ip, db = knex) {
  const rows = await db('office_network_rules').where({ is_active: true }).orderBy('id', 'desc');
  const matched = rows.find((r) => officeNetworkMatches(r.rule, ip)) || null;
  return { ip, rows, matched };
}

async function list(db = knex) {
  const rows = await db('office_network_rules').orderBy('id', 'desc');
  return rows.map((r) => ({ id: r.id, name: r.name, publicIp: r.rule, rule: r.rule, isActive: r.is_active, createdAt: r.created_at }));
}

async function add({ name, raw, detectedIp, actorId }, db = knex) {
  const cleanName = String(name || 'Office WiFi').trim().slice(0, 80);
  const rule = normalizeForSave(raw, detectedIp);
  if (!cleanName || !rule) return { error: 'Network name and a valid IP/range are required.' };
  const existing = await db('office_network_rules').whereRaw('lower(name)=lower(?) AND lower(rule)=lower(?)', [cleanName, rule]).first();
  if (existing) return { existing: true, id: existing.id, rule };
  const [row] = await db('office_network_rules').insert({ name: cleanName, rule, created_by: actorId || null }).returning('*');
  return { id: row.id, rule };
}

module.exports = { approvedOfficeNetwork, list, add, normalizeOfficeNetwork };
