'use strict';
// Runs the original eight Salary Analyzer integration/unit files against a
// dedicated PostgreSQL database. It only resets the `workforce` schema.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Load the root .env when dotenv is installed, but check the required test URL
// before importing pg so a missing test configuration is reported clearly.
try { require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') }); } catch {}
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error('[workforce-tests] NOT RUN: TEST_DATABASE_URL is required. Set it to a separate throw-away PostgreSQL database whose name contains \"test\". The suite must not report success when its eight integration tests were not executed.');
  process.exit(2);
}
const { Client } = require('pg');
const dbName = decodeURIComponent(new URL(testUrl).pathname.slice(1));
if (!/test/i.test(dbName)) {
  console.error(`Refusing to reset database "${dbName}": the database name must contain "test".`);
  process.exit(1);
}
(async () => {
  const client = new Client({ connectionString: testUrl, ssl: String(process.env.DATABASE_SSL || '').toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS workforce CASCADE; CREATE SCHEMA workforce;');
  } finally { await client.end(); }

  const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: testUrl };
  const migrate = spawnSync(process.execPath, ['-e', "require('./index.cjs').migrateWorkforce().then(() => require('./index.cjs').closeWorkforcePool()).catch(e => { console.error(e); process.exit(1); })"], {
    cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit'
  });
  if (migrate.status !== 0) process.exit(migrate.status || 1);
  const args = process.argv.slice(2);
  const fs = require('node:fs');
  const files = args.some(a => a.endsWith('.js')) ? [] : fs.readdirSync(path.join(__dirname, '..', 'test')).filter(f => f.endsWith('.test.js')).sort().map(f => path.join('test', f));
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...args, ...files], {
    cwd: path.resolve(__dirname, '..'), env, stdio: 'inherit'
  });
  process.exit(result.status === null ? 1 : result.status);
})().catch(err => { console.error('[workforce-tests]', err); process.exit(1); });
