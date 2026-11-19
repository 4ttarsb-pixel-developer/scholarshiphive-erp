import { config, assertConfig, googleConfigured, smtpConfigured } from './config.js';
import { migrate, closePool, query } from './db.js';
import { createApp } from './app.js';
import { runDailyIfDue } from './lib/jobs.js';
import workforce from '../workforce/index.cjs';
import marketingDb from '../../marketing-backend/src/db/migrate.js';
import marketingJobs from '../../marketing-backend/src/jobs/ad-sync.job.js';

// Log instead of dying: a stray rejected promise must not take the whole office offline.
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e?.stack || e));
process.on('uncaughtException', e => console.error('[uncaughtException]', e?.stack || e));

// A managed database (Railway / Neon) can take a few seconds to accept connections after
// a deploy or while waking up. Retry only connection problems; real SQL errors fail at once.
const CONNECT_ERRORS = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|timeout|Connection terminated|the database system is starting up/i;
async function prepareDatabase() {
  const attempts = Math.max(1, Number(process.env.DB_CONNECT_RETRIES) || 6);
  for (let i = 1; ; i++) {
    try {
      await migrate();
      await workforce.migrateWorkforce();
      await marketingDb.migrateMarketing();
      return;
    } catch (e) {
      const retryable = CONNECT_ERRORS.test(`${e.code || ''} ${e.message || ''}`);
      if (!retryable || i >= attempts) throw e;
      const wait = Math.min(15000, 2000 * i);
      console.warn(`[db] database not reachable yet (${e.code || e.message}); retry ${i}/${attempts - 1} in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function main() {
  assertConfig();
  try {
    await prepareDatabase();
  } catch (e) {
    console.error('\n✖ Could not connect to / prepare the database.');
    console.error('  ' + e.message);
    console.error('  Check DATABASE_URL (and DATABASE_SSL) in your environment variables and that PostgreSQL is running (SETUP_GUIDE.md / RAILWAY_DEPLOY.md).\n');
    process.exit(1);
  }
  // Marketing account sync scheduler runs in the same long-lived Node process.
  marketingJobs.startScheduler();
  // Daily job (payment reminders, monthly cycles, clean-up) — checked every 30 minutes, runs once a day
  runDailyIfDue();
  setInterval(runDailyIfDue, 30 * 60 * 1000).unref();
  // Remove idle sessions every 10 minutes
  setInterval(() => query(`DELETE FROM sessions WHERE last_activity < NOW() - ($1 || ' minutes')::interval`, [String(config.sessionIdleMinutes)]).catch(() => {}), 10 * 60 * 1000).unref();

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`\n✔ ScholarshipHive ERP running on ${config.appUrl}  (port ${config.port}, ${config.env})`);
    console.log(`  Google sign-in: ${googleConfigured() ? 'configured' : 'NOT configured'}${config.google.devBypass ? '  (DEV bypass ON)' : ''}`);
    console.log(`  Email (SMTP):   ${smtpConfigured() ? 'configured' : 'NOT configured — emails will be logged only'}\n`);
  });
  const stop = () => { server.close(async () => { await workforce.closeWorkforcePool().catch(() => {}); await closePool(); process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(e => { console.error('\n✖ ' + e.message + '\n'); process.exit(1); });
