'use strict';
const config = require('./config');
const knex = require('./db');
const { createApp } = require('./app');

async function main() {
  try {
    await knex.raw('select 1');
  } catch (e) {
    console.error('\n[startup] Cannot connect to PostgreSQL using DATABASE_URL.');
    console.error(`[startup] ${e.message}`);
    console.error('[startup] Check that PostgreSQL is running and backend/.env is correct (see TROUBLESHOOTING.md).\n');
    process.exit(1);
  }
  // Same migration table/schema as migrateWorkforce() in ../index.cjs.
  const [, pending] = await knex.migrate.list({ directory: require('path').join(__dirname, '..', 'db', 'migrations'), tableName: 'knex_migrations', schemaName: 'workforce' });
  if (pending.length) {
    console.error(`[startup] ${pending.length} database migration(s) pending. Run: npm run db:migrate`);
    process.exit(1);
  }
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[workforce-erp] API listening on http://localhost:${config.port}  (env: ${config.env}, tz: ${config.businessTimezone})`);
    console.log(`[workforce-erp] Health check: http://localhost:${config.port}/api/health`);
  });
  const shutdown = () => { server.close(() => knex.destroy().then(() => process.exit(0))); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
