'use strict';
/** Creates backend/backups/<db>-<timestamp>.sql using pg_dump (must be on PATH). */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../src/config');

const dir = path.join(__dirname, '..', 'backups');
fs.mkdirSync(dir, { recursive: true });
const url = new URL(config.databaseUrl);
const file = path.join(dir, `${url.pathname.slice(1)}-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`);
const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
const r = spawnSync('pg_dump', ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1), '-f', file, '--no-owner'], { env, stdio: 'inherit' });
if (r.error || r.status !== 0) {
  console.error('[backup] pg_dump failed or is not on PATH. On Windows add "C:\\Program Files\\PostgreSQL\\16\\bin" to PATH, or back up with pgAdmin (right-click database › Backup).');
  process.exit(1);
}
console.log(`[backup] Saved ${file}`);
