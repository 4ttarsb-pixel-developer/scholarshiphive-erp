'use strict';
/**
 * Import the retired ASP.NET SQLite database into PostgreSQL.
 *   npm run import:sqlite -- --dry-run                 (preview, nothing saved)
 *   npm run import:sqlite -- --file ../legacy/AttendanceTestApi/attendance.db --confirm-backup
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
  const file = path.resolve(opt('--file', path.join(__dirname, '..', '..', 'legacy', 'AttendanceTestApi', 'attendance.db')));
  const dryRun = flag('--dry-run');
  if (!fs.existsSync(file)) throw new Error(`SQLite file not found: ${file}`);
  if (!dryRun && !flag('--confirm-backup')) {
    throw new Error('Run "npm run db:backup" first, then re-run with --confirm-backup (or use --dry-run to preview).');
  }
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const bytes = fs.readFileSync(file);
  const db = new SQL.Database(bytes);
  const report = await importLegacy(knex, db, { dialect: 'sqlite', sourceBytes: bytes, dryRun, tz: config.businessTimezone });
  console.log(JSON.stringify(report, null, 2));
  console.log(dryRun ? '\nDRY RUN — nothing was saved.' : '\nImport complete. Next: map imported logins to employees in Employees › Unmapped attendance logins.');
})().then(() => knex.destroy()).catch((e) => { console.error(`[import:sqlite] ${e.message}`); knex.destroy().then(() => process.exit(1)); });
