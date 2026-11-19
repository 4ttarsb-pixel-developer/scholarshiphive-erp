'use strict';
// Dependency-free contract checks of the SQL-backed runtime. No real credentials
// are needed; full PostgreSQL end-to-end verification happens on Windows.
const test=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const fs=require('node:fs');
process.env.PERSISTENCE_DRIVER='postgres';
const poolPath=require.resolve('../src/db/pool');
const calls=[];
const fake={
 query: async(sql,params=[])=>{
  calls.push({sql,params});
  if(sql.includes('FROM marketing.ad_accounts a WHERE a.id='))return {rows:[{id:'account-1',platform:'meta',name:'Company Meta',externalAccountId:'12345',currency:'PKR',lastVerifiedAt:'2026-10-01T00:00:00Z',lastSyncedAt:'2026-10-02T00:00:00Z',lastError:null}],rowCount:1};
  if(sql.includes('FROM marketing.ad_accounts a WHERE $1='))return {rows:[{id:'account-1',platform:'meta',name:'Company Meta',externalAccountId:'12345',currency:'PKR',lastVerifiedAt:'2026-10-01T00:00:00Z',lastSyncedAt:'2026-10-02T00:00:00Z',lastError:null}],rowCount:1};
  if(sql.includes('ad_sync_coverage'))return {rows:[{n:2}],rowCount:1};
  if(sql.includes('FROM marketing.ad_account_daily_metrics'))return {rows:[{date:'2026-10-01',spend:120,impressions:1000,clicks:50,leads:3,conversions:null},{date:'2026-10-02',spend:80,impressions:500,clicks:20,leads:1,conversions:null}],rowCount:2};
  if(sql.includes('FROM marketing.fx_rates'))return {rows:[],rowCount:0};
  if(sql.includes('FROM marketing.ad_account_assignments x JOIN'))return {rows:[],rowCount:0};
  return {rows:[],rowCount:0};
 },withTransaction:async fn=>fn({query:async(sql,params)=>fake.query(sql,params)}),close:async()=>{}
};
require.cache[poolPath]={id:poolPath,filename:poolPath,loaded:true,exports:fake};
const common=require('../src/services/pg/common');
const ads=require('../src/services/pg/ad-integration.service');
const accountService=require('../src/services/pg/ad-account.service');
test('Meta, Google and TikTok use the same normalized postgres account and metric tables',()=>{
 assert.deepEqual(common.kinds,{'Meta Ads':'meta','Google Ads':'google','TikTok Ads':'tiktok'});
 const sql=fs.readFileSync(path.resolve(__dirname,'../src/services/pg/ad-integration.service.js'),'utf8');
 for(const table of ['ad_campaigns','ad_groups','ads','ad_daily_metrics','ad_account_daily_metrics','ad_sync_coverage'])assert.ok(sql.includes('marketing.'+table),table);
 assert.ok(!sql.includes('mock.store'));
});
test('Direct SQL snapshot returns native PKR reporting and preserves separate ad/account totals',async()=>{
 const report=await ads.performance('account-1',{role:'Admin',id:'admin'},{startDate:'2026-10-01',endDate:'2026-10-02'});
 assert.equal(report.metrics.spend,200);assert.equal(report.metrics.spendPKR,200);
 assert.equal(report.metrics.leads,4);assert.equal(report.coverage.complete,true);
 assert.equal(report.metrics.fxStatus,'native_pkr');
 assert.ok(calls.some(c=>c.sql.includes('marketing.ad_account_daily_metrics')));
});
test('Direct account lookup uses PostgreSQL permissions not an in-process list',async()=>{
 const row=await common.account('account-1',{role:'Employee',id:'employee-1'});
 assert.equal(row.name,'Company Meta');assert.ok(calls.some(c=>c.sql.includes('ad_account_assignments x')&&c.params.includes('employee-1')));
});
test('DB-backed account rendering retains user-facing Meta name and source currency',async()=>{
 const list=await accountService.all({id:'admin',role:'Admin'},{startDate:'2026-10-01',endDate:'2026-10-02'});
 assert.equal(list[0].name,'Company Meta');assert.equal(list[0].platform,'Meta Ads');assert.equal(list[0].currency,'PKR');
});
test('PG production entrypoints do not load mock store or snapshot hydration',()=>{
 for(const name of ['ad-account.service','ad-integration.service','attribution.service','fx.service','dashboard.service']){
  const src=fs.readFileSync(path.resolve(__dirname,`../src/services/${name}.js`),'utf8');
  assert.ok(src.includes("require('./pg/"+name+"')"));
 }
 const app=fs.readFileSync(path.resolve(__dirname,'../src/app.js'),'utf8');
 assert.ok(!app.includes('refreshDatabaseSnapshot'));
});
