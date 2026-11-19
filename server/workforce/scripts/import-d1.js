'use strict';
/**
 * Import a Cloudflare D1 export into PostgreSQL. You create the export yourself:
 *   cd legacy/attendance_worker
 *   npx wrangler d1 export attendance-db --remote --output=d1-export.sql
 * Then:
 *   npm run import:d1 -- --file ../legacy/attendance_worker/d1-export.sql --dry-run
 *   npm run import:d1 -- --file ../legacy/attendance_worker/d1-export.sql --confirm-backup
 * This script never connects to Cloudflare and needs no Cloudflare credentials.
 * Accepts either the .sql dump or a .sqlite/.db file.
 */
const fs = require('fs');
const path = require('path');
const knex = require('../src/db');
const config = require('../src/config');
const { importLegacy } = require('./lib/legacy-import');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

(async () => {
  const fileArg = opt('--file');
  if (!fileArg) throw new Error('Pass --file <d1-export.sql | database.sqlite>. See the comment at the top of this script.');
  const file = path.resolve(fileArg);
  const dryRun = flag('--dry-run');
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  if (!dryRun && !flag('--confirm-backup')) throw new Error('Run "npm run db:backup" first, then re-run with --confirm-backup (or --dry-run).');
  const SQL = await require('sql.js')();
  const bytes = fs.readFileSync(file);
  let db;
  if (/\.sql$/i.test(file)) {
    db = new SQL.Database();
    db.exec(bytes.toString('utf8'));
  } else {
    db = new SQL.Database(bytes);
  }
  const report = await importLegacy(knex, db, { dialect: 'd1', sourceBytes: bytes, dryRun, tz: config.businessTimezone });
  console.log(JSON.stringify(report, null, 2));
  console.log(dryRun ? '\nDRY RUN — nothing was saved.' : '\nImport complete. Map imported logins to employees in the web dashboard, then retire the Worker (legacy/README_LEGACY.md).');
})().then(() => knex.destroy()).catch((e) => { console.error(`[import:d1] ${e.message}`); knex.destroy().then(() => process.exit(1)); });
