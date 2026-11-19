// SQL migration runner. Applies database/migrations/*.sql in filename order,
// each inside its own transaction, and records them in marketing.schema_migrations.
// Runs as the migration OWNER role (DB_OWNER_USER), falling back to DB_USER for
// local single-role setups. Never auto-edits already-applied migrations.
//
//   node src/db/migrate.js            apply all pending migrations
//   node src/db/migrate.js --status   show applied vs pending (needs DB)
//   node src/db/migrate.js --list     list migration files in order (no DB)
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../database/migrations');
const schema = 'marketing'; // fixed schema name; never interpolate an untrusted env value

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

// Migrations whose earlier text was functionally equivalent where it could run.
// 014 originally granted to role mea_app unconditionally (which fails on Railway /
// Neon single-role databases); the guarded version is accepted as the same migration.
const LEGACY_CHECKSUMS = {
  '014_public_reference_numbers.sql': ['1f4b1259c13d3d520e082781c49805a067cb3781e6e0dae66e91915ba34bef22'],
};

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function ownerPool() {
  const connectionString = process.env.DATABASE_URL || '';
  if (!connectionString) throw new Error('DATABASE_URL is required. Marketing migrations must use the shared ScholarshipHive database.');
  return new Pool({
    connectionString,
    ssl: String(process.env.DATABASE_SSL || process.env.DB_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
}

async function ensureTrackingTable(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (
      filename    TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function appliedSet(client) {
  const { rows } = await client.query(`SELECT filename, checksum FROM ${schema}.schema_migrations`);
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

async function migrateMarketing() {
  if ((process.env.PERSISTENCE_DRIVER || 'postgres').toLowerCase() !== 'postgres') {
    throw new Error('Marketing Analyzer requires PERSISTENCE_DRIVER=postgres.');
  }
  const args = process.argv.slice(2);
  const files = migrationFiles();

  if (args.includes('--list')) {
    console.log(`Migration files in ${MIGRATIONS_DIR}:`);
    files.forEach((f, i) => console.log(`  ${String(i + 1).padStart(2, '0')}. ${f}`));
    return { listed: files };
  }

  const pool = ownerPool();
  const client = await pool.connect();
  try {
    await ensureTrackingTable(client);
    const applied = await appliedSet(client);

    if (args.includes('--status')) {
      console.log('Applied migrations:');
      for (const f of files) {
        const state = applied.has(f) ? 'APPLIED ' : 'PENDING ';
        console.log(`  [${state}] ${f}`);
      }
      return { status: 'shown', files };
    }

    let count = 0;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const sum = checksum(sql);
      if (applied.has(file)) {
        const legacy = LEGACY_CHECKSUMS[file] || [];
        if (applied.get(file) !== sum && !legacy.includes(applied.get(file))) {
          throw new Error(`Migration ${file} changed after being applied (checksum mismatch). ` +
            `Never edit an applied migration; add a new numbered migration instead.`);
        }
        continue;
      }
      process.stdout.write(`Applying ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO ${schema}.schema_migrations (filename, checksum) VALUES ($1, $2)`,
          [file, sum],
        );
        await client.query('COMMIT');
        console.log('ok');
        count += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw err;
      }
    }
    console.log(count ? `\nApplied ${count} migration(s).` : '\nDatabase already up to date.');
    return { applied: count, total: files.length };
  } finally {
    client.release();
    await pool.end();
  }
}

module.exports = { migrateMarketing, migrationFiles };

if (require.main === module) {
  migrateMarketing().catch((err) => {
    console.error('\n[MEA][migrate] error:', err.message);
    process.exit(1);
  });
}
