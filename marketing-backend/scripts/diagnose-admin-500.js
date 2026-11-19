'use strict';
/* Scholarshiphive MEA - READ ONLY Admin HTTP 500 diagnosis.
   Run in backend directory: node scripts/diagnose-admin-500.js
   Reads local .env, never prints tokens, passwords, or account identifiers.
*/
const path = require('node:path');
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
const db = require('../src/db/pool');
const root = path.resolve(__dirname,'../');
const printed = new Set();
let failCount = 0;
function safe(v) {
  let s=String(v ?? '');
  for(const key of ['META_ACCESS_TOKEN','GOOGLE_ADS_ACCESS_TOKEN','TIKTOK_ACCESS_TOKEN','DB_PASSWORD','DB_OWNER_PASSWORD','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN']){
    const secret=process.env[key];
    if(secret && secret.length>3)s=s.split(secret).join('[REDACTED]');
  }
  return s.slice(0,300);
}
async function probe(title, fn) {
  try { const out = await fn(); console.log('[PASS]',title,(out===undefined?'':safe(out))); return out; }
  catch(e){failCount++;console.log('[FAIL]',title,'code='+safe(e.code||'unknown'),'message='+safe(e.message),'detail='+safe(e.detail||'none')); return null;}
}
(async()=>{
  console.log('Scholarshiphive MEA Admin 500 Read-only Diagnostic');
  console.log('Mode:',process.env.PERSISTENCE_DRIVER||'not-set','DB:',process.env.DB_NAME||'not-set','schema:',process.env.DB_SCHEMA||'marketing');
  const month=process.argv[2]||'2026-10';
  await probe('Database SELECT 1',async()=>(await db.query('SELECT 1 AS ok')).rows[0].ok);
  await probe('Applied migrations 014-017',async()=>{
    const r=await db.query("SELECT filename FROM marketing.schema_migrations WHERE filename ~ '^0(14|15|16|17)_' ORDER BY filename");
    return r.rows.map(x=>x.filename).join(', ')||'(none applied)';
  });
  await probe('Required account columns',async()=>{
    const r=await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='marketing' AND table_name='ad_accounts' AND column_name IN ('display_number','new_ads_detected','new_campaigns_detected') ORDER BY column_name");
    const found=r.rows.map(x=>x.column_name);const missing=['display_number','new_ads_detected','new_campaigns_detected'].filter(x=>!found.includes(x));
    return missing.length?'MISSING: '+missing.join(', '):'All present';
  });
  await probe('Account direct DB SELECT (no IDs printed)',async()=>{
    const {accounts}=require('../src/services/pg/common');const result=await accounts({role:'Admin'});return 'records='+result.length;
  });
  await probe('Account list with reporting and queue (no IDs printed)',async()=>{
    const rows=await require('../src/services/pg/ad-account.service').all({role:'Admin'}, {month});return 'records='+rows.length;
  });
  await probe('Dashboard admin summary',async()=>{
    const row=await require('../src/services/pg/dashboard.service').summary(month,{month});return 'month='+row.month;
  });
  await probe('Ad reports overview',async()=>{
    const row=await require('../src/services/pg/dashboard.service').report({month});return 'accounts='+row.accounts.length;
  });
  console.log('\nFinished. Failed probes:',failCount,'(No changes made to your database.)');
})().catch(e=>{console.error('Fatal:',safe(e.message));process.exitCode=1}).finally(async()=>{await db.close().catch(()=>{})});
