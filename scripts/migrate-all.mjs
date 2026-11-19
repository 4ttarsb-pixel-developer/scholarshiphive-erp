// Apply the ERP, Workforce/Attendance, and Marketing SQL migrations to ONE PostgreSQL database.
import { migrate as migrateErp, closePool as closeErpPool } from '../server/src/db.js';
import workforce from '../server/workforce/index.cjs';
import marketingDb from '../marketing-backend/src/db/migrate.js';

let ok = false;
try {
  await migrateErp();
  await workforce.migrateWorkforce();
  await marketingDb.migrateMarketing();
  console.log('✔ All three schemas are ready in the same PostgreSQL database.');
  ok = true;
} catch (error) {
  console.error('✖ Unified migrations failed:', error.message);
  process.exitCode = 1;
} finally {
  await workforce.closeWorkforcePool().catch(() => {});
  await closeErpPool().catch(() => {});
}
if (!ok) process.exitCode = 1;
