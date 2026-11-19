// Idempotent import of the development JSON archives into PostgreSQL.
//   backend/var/fx-rates.json      -> fx_rates (+ history as needed)
//   backend/var/ad-accounts.json   -> ad_accounts (+ ad_account_assignments)
//   backend/var/ad-history.json    -> ad_campaigns/ad_groups/ads/metrics/coverage
//
//   node scripts/import-json.js
// Run AFTER migrations + seed. Safe to run repeatedly (upserts, no deletes).
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const VAR = path.resolve(__dirname, '..', 'var');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(path.join(VAR, f), 'utf8')); } catch { return null; } };
const PLATFORM_TO_DB = { 'Meta Ads': 'meta', 'Google Ads': 'google', 'TikTok Ads': 'tiktok' };

async function main() {
  if ((process.env.PERSISTENCE_DRIVER || 'memory') !== 'postgres') {
    console.error('Set PERSISTENCE_DRIVER=postgres (and run migrations) before importing.');
    process.exit(1);
  }
  const { pool } = require('../src/db/pool');
  const repo = require('../src/repositories');

  // --- FX rates ---
  const fxJson = readJson('fx-rates.json');
  let fxCount = 0;
  if (fxJson && fxJson.rates) {
    for (const r of Object.values(fxJson.rates)) {
      await repo.fx.upsert({ currency: r.currency, month: r.month, rate: r.rate, source: r.source || 'Imported', oldRate: null, userId: null });
      fxCount += 1;
    }
  }
  console.log(`FX rates imported/updated: ${fxCount}`);

  // --- Ad accounts + assignments ---
  const accJson = readJson('ad-accounts.json');
  let accCount = 0, asgCount = 0;
  if (accJson && Array.isArray(accJson.accounts)) {
    for (const a of accJson.accounts) {
      if (!a.id || !a.externalAccountId || !PLATFORM_TO_DB[a.platform]) continue;
      await pool.query(
        `INSERT INTO marketing.ad_accounts (id, platform, external_account_id, display_name, integration_status)
           VALUES ($1,$2,$3,$4,'Not connected')
         ON CONFLICT (platform, external_account_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [a.id, PLATFORM_TO_DB[a.platform], a.externalAccountId, a.name]);
      accCount += 1;
    }
    for (const x of accJson.assignments || []) {
      const u = (await pool.query(`SELECT id FROM marketing.users WHERE lower(email)=lower($1) AND role='Employee'`, [x.userEmail || ''])).rows[0];
      const acc = (await pool.query(`SELECT id FROM marketing.ad_accounts WHERE id=$1`, [x.accountId])).rows[0];
      if (!u || !acc) continue;
      await pool.query(
        `INSERT INTO marketing.ad_account_assignments (ad_account_id, user_id, assigned_at)
           VALUES ($1,$2, COALESCE($3::timestamptz, now()))
         ON CONFLICT (ad_account_id, user_id) DO UPDATE SET revoked_at = NULL`,
        [x.accountId, u.id, x.assignedAt || null]);
      asgCount += 1;
    }
  }
  console.log(`Ad accounts imported: ${accCount}; assignments: ${asgCount}`);

  // --- Ad history (normalized) ---
  const histJson = readJson('ad-history.json');
  if (histJson && histJson.accounts) {
    const archive = require('../src/services/ad-history.store');
    const { imported, skipped } = await archive.importJson(histJson);
    console.log(`Ad history accounts imported: ${imported}; skipped (not registered): ${skipped}`);
  } else {
    console.log('No ad-history.json to import.');
  }

  await pool.end();
  console.log('Import complete.');
}

main().catch((err) => { console.error('[MEA][import] error:', err.message); process.exit(1); });
