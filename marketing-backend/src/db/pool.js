// Single shared PostgreSQL connection pool + transaction / health helpers.
// Loaded only when PERSISTENCE_DRIVER=postgres. All repository SQL uses
// parameterized queries and fully-qualifies tables as marketing.<table>.
const { Pool } = require('pg');

const schema = 'marketing'; // fixed schema name; never interpolate an untrusted env value

function buildConfig(overrides = {}) {
  const connectionString = process.env.DATABASE_URL || '';
  const pooled = /-pooler\./.test(connectionString);
  return {
    // Keep module imports possible for the isolated in-memory test harness.
    // Production startup validates DATABASE_URL before any API is served; this
    // inert fallback is never used as a second persistence database.
    ...(connectionString ? { connectionString } : { host: '127.0.0.1', port: 1, database: 'disabled_without_DATABASE_URL', user: 'disabled', password: 'disabled' }),
    ssl: String(process.env.DATABASE_SSL || process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.MARKETING_DB_POOL_MAX || process.env.DB_POOL_MAX || 3),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    // Neon/PgBouncer pooler rejects startup `options`; runtime SQL is schema-qualified.
    // Keep search_path only for direct PostgreSQL connections.
    ...(pooled ? {} : { options: `-c search_path=${schema},public` }),
    ...overrides,
  };
}

const pool = new Pool(buildConfig());

// Surface pool-level errors instead of crashing the process silently.
pool.on('error', (err) => console.error('[MEA][db] idle client error:', err.message));

function assertSharedDatabaseConfigured() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Marketing Analyzer shares the ScholarshipHive database.');
}

function query(text, params) {
  assertSharedDatabaseConfigured();
  return pool.query(text, params);
}

// Run fn(client) inside a single BEGIN/COMMIT transaction; ROLLBACK on throw.
// Every multi-row budget/audit write MUST reuse this one checked-out client.
async function withTransaction(fn) {
  assertSharedDatabaseConfigured();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore rollback error */ }
    throw err;
  } finally {
    client.release();
  }
}

// Lightweight probe for the health endpoint / startup gate. Never leaks DSN details.
async function healthCheck() {
  assertSharedDatabaseConfigured();
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0] && rows[0].ok === 1;
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, healthCheck, close, buildConfig, assertSharedDatabaseConfigured, schema };
