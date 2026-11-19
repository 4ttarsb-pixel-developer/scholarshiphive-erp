// ═══════════════════════════════════════════════════════════════════════════
//  npm run db:reset -- --confirm=<database name>
//
//  DELETES EVERY TABLE AND ALL DATA (users, sales, expenses, files …) in the
//  database from DATABASE_URL, then creates a clean, empty schema.
//  Use it once to throw away old test / dummy data. There is no undo.
//  The command refuses to run unless you type the exact database name.
// ═══════════════════════════════════════════════════════════════════════════
import { config } from '../src/config.js';
import { migrate, one, many, query, closePool } from '../src/db.js';

const arg = process.argv.find(a => a.startsWith('--confirm='));
if (!config.databaseUrl) { console.error('\n✖ DATABASE_URL is empty in .env\n'); process.exit(1); }

try {
  const info = await one('SELECT current_database() AS db, current_user AS u, inet_server_addr()::text AS host');
  const host = (() => { try { return new URL(config.databaseUrl).hostname; } catch { return info.host || '?'; } })();
  const tables = await many(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
  const users = await one('SELECT COUNT(*)::int AS n FROM users').catch(() => ({ n: 0 }));
  console.log(`\nDatabase: "${info.db}"  on  ${host}  (user ${info.u})`);
  console.log(`Tables now: ${tables.length}   ·   users: ${users.n}`);
  if (!arg || arg.split('=')[1] !== info.db) {
    console.log(`\nNothing was deleted. To wipe EVERYTHING in this database and start fresh, run:\n\n   npm run db:reset -- --confirm=${info.db}\n`);
    process.exitCode = 1;
  } else {
    console.log('\nDeleting every table …');
    try {
      await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    } catch (e) {
      // Some hosted roles may not own the schema — drop our tables one by one instead.
      console.log(`  (schema could not be recreated: ${e.message} — dropping tables one by one)`);
      await query(`DO $$ DECLARE r record; BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename); END LOOP;
        FOR r IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public' LOOP EXECUTE format('DROP SEQUENCE IF EXISTS public.%I CASCADE', r.sequence_name); END LOOP;
      END $$;`);
    }
    await migrate({ force: true });
    const after = await many(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`);
    console.log(`✔ Fresh database ready — ${after.length} empty tables, no dummy data.`);
    console.log('  Next: open the website → "First-time setup" to create the Super Admin.\n');
  }
} catch (e) {
  console.error('\n✖ ' + e.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
