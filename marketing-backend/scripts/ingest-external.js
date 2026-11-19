// SANDBOX ingestion tool for Calling/Revenue data into MEA's read-only shadow
// tables. This is NOT a live connector — it loads a local JSON file that matches
// the agreed contract shape, for staging/sandbox testing only. A production
// connector (authenticated read-only API or central-DB view) would call the same
// external-ingest service methods. Nothing here writes back to external systems.
//
//   node scripts/ingest-external.js <sandbox.json>
//   node scripts/ingest-external.js            (prints current ingest status)
//
// Sandbox file shape:
// { "source":"calling"|"revenue", "enable":false,
//   "counsellors":[{external_id,name,department,status}],
//   "leads":[{external_lead_id,campaign_id,counsellor_id,status,qualified_at,created_at,updated_at}],
//   "sales":[{external_sale_id,lead_id,counsellor_id,amount,currency,status,sold_at,updated_at}] }
require('dotenv').config();
const fs = require('node:fs');
const crypto = require('node:crypto');

async function main() {
  if ((process.env.PERSISTENCE_DRIVER || 'memory') !== 'postgres') {
    console.error('Set PERSISTENCE_DRIVER=postgres before ingesting external data.');
    process.exit(1);
  }
  const ingest = require('../src/services/external-ingest.service');
  const { pool } = require('../src/db/pool');
  const file = process.argv[2];

  if (!file) {
    console.log('No sandbox file given. Current external ingestion status:');
    console.log(JSON.stringify(await ingest.status(), null, 2));
    console.log('\nCalling/Revenue remain NOT CONNECTED until a contract is agreed and a connector supplies data.');
    await pool.end();
    return;
  }

  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const source = payload.source;
  if (!['calling', 'revenue'].includes(source)) { console.error("payload.source must be 'calling' or 'revenue'."); process.exit(1); }
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const startedAt = new Date().toISOString();

  await ingest.registerSource(source, { apiContractVersion: payload.contractVersion || 'sandbox-0', authReference: 'sandbox', enabled: !!payload.enable });
  let rows = 0, failures = 0;
  const run = async (fn) => { try { await fn(); rows += 1; } catch (e) { failures += 1; console.error('  row error:', e.message); } };

  for (const c of payload.counsellors || []) await run(() => ingest.upsertCounsellorRef(source, c));
  for (const l of payload.leads || []) await run(() => ingest.upsertLead(source, l));
  for (const s of payload.sales || []) await run(() => ingest.upsertSale(source, s));

  await ingest.recordRun(source, { rowCount: rows, failureCount: failures, payloadHash: hash, startedAt, completedAt: new Date().toISOString() });
  console.log(`Ingested from ${source}: ${rows} row(s), ${failures} failure(s). enabled=${!!payload.enable}`);
  console.log('Status:', JSON.stringify(await ingest.status()));
  await pool.end();
}

main().catch((err) => { console.error('[MEA][ingest-external] error:', err.message); process.exit(1); });
