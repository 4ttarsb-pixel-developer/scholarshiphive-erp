import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { config, ROOT_DIR, onVercel } from './config.js';

// NUMERIC -> JS number, BIGINT -> number, DATE -> 'YYYY-MM-DD' string (no timezone shifting)
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, v => v);

let pool;
export function getPool() {
  if (!pool) {
    const tz = process.env.TZ || 'Asia/Karachi';
    // Neon's pooled host (-pooler) does not accept the "options" startup parameter, so skip it there.
    const pooled = /-pooler\./.test(config.databaseUrl || '');
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
      max: onVercel ? 3 : 10,
      ...(pooled ? {} : { options: `-c TimeZone=${tz}` }),
      idleTimeoutMillis: onVercel ? 10000 : 30000,
      // Never hang forever: a sleeping Neon compute wakes in ~1-5 s; give up well before Vercel's 30 s limit.
      connectionTimeoutMillis: 12000,
      query_timeout: onVercel ? 25000 : 120000,
      keepAlive: true,
    });
    if (pooled) pool.on('connect', c => { c.query(`SET TIME ZONE '${tz.replace(/'/g, '')}'`).catch(() => {}); });
    // An idle client dropped by the server must not crash the process.
    pool.on('error', err => console.error('[db] idle client error:', err.message));
  }
  return pool;
}

// Network blips / Neon restarts. Only read-only statements are retried, so nothing is ever written twice.
const TRANSIENT = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', '57P01', '57P02', '57P03', '08000', '08003', '08006', '08001', '08004']);
const isTransient = e => TRANSIENT.has(e?.code) || /Connection terminated|connection timeout|Client has encountered a connection error/i.test(e?.message || '');
const readOnly = text => /^\s*(SELECT|WITH)\b/i.test(text) && !/\b(INSERT|UPDATE|DELETE|nextval|pg_advisory)/i.test(text);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function query(text, params) {
  try {
    return await getPool().query(text, params);
  } catch (e) {
    if (!isTransient(e) || !readOnly(text)) throw e;
    await sleep(400);
    return getPool().query(text, params);
  }
}
export async function one(text, params) { const r = await query(text, params); return r.rows[0] || null; }
export async function many(text, params) { const r = await query(text, params); return r.rows; }

/** Run fn(client) inside a transaction. */
export async function tx(fn) {
  let client;
  try { client = await getPool().connect(); } catch (e) {
    if (!isTransient(e)) throw e;
    await sleep(400);
    client = await getPool().connect();
  }
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Creates / upgrades every table from server/db/schema.sql (safe to repeat).
 * The schema's SHA-256 is remembered, so warm starts skip it unless the file changed.
 */
export async function migrate({ force = false } = {}) {
  const sql = await fs.readFile(path.join(ROOT_DIR, 'server', 'db', 'schema.sql'), 'utf8');
  const hash = crypto.createHash('sha256').update(sql).digest('hex');
  if (!force) {
    const done = await one(`SELECT value->>'hash' AS h FROM app_settings WHERE key='schema_hash'`).catch(() => null);
    if (done?.h === hash) return { skipped: true };
  }
  // Transaction-level advisory lock: two cold starts at the same moment will not run the schema together.
  await tx(async client => {
    await client.query('SELECT pg_advisory_xact_lock(7270001)');
    await client.query(sql);
    await client.query(`INSERT INTO app_settings(key,value,updated_at) VALUES ('schema_hash', $1, NOW())
                        ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify({ hash, at: new Date().toISOString() })]);
  });
  return { skipped: false };
}

export async function closePool() { if (pool) { await pool.end(); pool = undefined; } }
