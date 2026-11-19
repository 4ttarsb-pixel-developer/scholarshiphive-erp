// npm run db:setup  → creates every table (safe to run again; never deletes data, never adds dummy rows)
// npm run db:check  → only checks the connection and lists tables
import { config } from '../src/config.js';
import { migrate, many, one, closePool } from '../src/db.js';

const checkOnly = process.argv.includes('--check');
if (!config.databaseUrl) {
  console.error('\n✖ DATABASE_URL is empty in .env. See SETUP_GUIDE.md\n');
  process.exit(1);
}
try {
  const v = await one('SELECT version() AS v, current_database() AS db, current_user AS u');
  console.log(`✔ Connected to "${v.db}" as "${v.u}"\n  ${v.v.split(',')[0]}`);
  if (!checkOnly) {
    await migrate({ force: true });
    console.log('✔ All tables are ready — new tables/columns added, existing data kept (no dummy data).');
  }
  const tables = await many(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`);
  console.log(`  ${tables.length} tables: ${tables.map(t => t.table_name).join(', ')}`);
  const users = await one(`SELECT COUNT(*)::int AS n FROM users`).catch(() => ({ n: 0 }));
  console.log(users.n ? `  Users: ${users.n}` : '  No users yet → open the website and complete "First-time setup" to create the Super Admin.');
} catch (e) {
  console.error('\n✖ Database error: ' + e.message);
  if (/password authentication failed/i.test(e.message)) console.error('  → The username/password in DATABASE_URL is wrong.');
  if (/does not exist/i.test(e.message)) console.error('  → Create the database first (see SETUP_GUIDE.md).');
  if (/ECONNREFUSED/i.test(e.message)) console.error('  → PostgreSQL is not running or the port is wrong.');
  if (/permission denied/i.test(e.message)) console.error('  → Make the user the OWNER of the database (see SETUP_GUIDE.md).');
  process.exitCode = 1;
} finally {
  await closePool();
}
