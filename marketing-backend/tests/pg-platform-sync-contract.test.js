'use strict';
// Simulated adapter responses prove all three platforms write the SAME normalized
// PostgreSQL schema. No mock application store, HTTP server, or credentials used.
const test=require('node:test');const assert=require('node:assert/strict');
process.env.PERSISTENCE_DRIVER='postgres';
process.env.META_ACCESS_TOKEN='fixture-not-live';process.env.GOOGLE_ADS_ACCESS_TOKEN='fixture-not-live';process.env.TIKTOK_ACCESS_TOKEN='fixture-not-live';
const ids={'meta-1':'meta','google-1':'google','tiktok-1':'tiktok'};
const performed=[];
const fake={
 query:async(sql,params=[])=>{
  performed.push({sql,params});
  if(sql.includes('FROM marketing.ad_accounts a WHERE a.id'))return {rows:[{id:params[0],platform:ids[params[0]],name:'Test platform',externalAccountId:'123456',currency:'PKR',lastVerifiedAt:'2026-10-01T00:00:00Z',lastSyncedAt:'2026-10-01T00:00:00Z'}],rowCount:1};
  if(sql.includes('FROM marketing.ad_accounts a WHERE $1='))return {rows:[],rowCount:0};
  if(sql.includes('SELECT external_ad_id id FROM marketing.ads')||sql.includes('SELECT external_campaign_id id FROM marketing.ad_campaigns'))return {rows:[],rowCount:0};
  if(sql.includes('RETURNING id'))return {rows:[{id:'ad-db-id'}],rowCount:1};
  if(sql.includes('SELECT id,last_known_status,availability_status FROM marketing.ads'))return {rows:[],rowCount:0};
  if(sql.includes('SELECT id::text id,')&&sql.includes('missing_sync_count FROM marketing.'))return {rows:[],rowCount:0};
  if(sql.includes('ad_sync_coverage'))return {rows:[{n:2}],rowCount:1};
  if(sql.includes('FROM marketing.ad_account_daily_metrics'))return {rows:[{date:'2026-10-01',spend:13,impressions:100,clicks:2,leads:null,conversions:null}],rowCount:1};
  if(sql.includes('FROM marketing.fx_rates'))return {rows:[],rowCount:0};
  return {rows:[],rowCount:1};
 },
 withTransaction:async fn=>fn({query:async(s,p)=>fake.query(s,p)})
};
const dbPath=require.resolve('../src/db/pool');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:fake};
for(const name of ['meta','google','tiktok']){
 const file=require.resolve(`../src/integrations/${name}/${name}.service`);
 require.cache[file]={id:file,filename:file,loaded:true,exports:{
  verify:async()=>({currency:'PKR'}),
  campaigns:async()=>[{id:'campaign-1',name:'Campaign',status:'ACTIVE'}],
  adGroups:async()=>[{id:'group-1',campaignId:'campaign-1',name:'Group',status:'ACTIVE'}],
  ads:async()=>[{id:'ad-1',name:'Ad',campaignId:'campaign-1',adGroupId:'group-1',status:'ACTIVE',daily:[{date:'2026-10-01',metrics:{spend:13,impressions:100,clicks:2,leads:null,conversions:null}}]}],
  performance:async()=>({currency:'PKR',daily:[{date:'2026-10-01',metrics:{spend:13,impressions:100,clicks:2,leads:null,conversions:null}}]})
 }};
}
const service=require('../src/services/pg/ad-integration.service');
for(const accountId of Object.keys(ids))test(`${ids[accountId]} platform daily data persists through common SQL tables`,async()=>{
 const before=performed.length;
 await service.runWindow({id:accountId,connectedBy:null},{startDate:'2026-10-01',endDate:'2026-10-02'});
 const writes=performed.slice(before);
 for(const table of ['ad_campaigns','ad_groups','ads','ad_daily_metrics','ad_account_daily_metrics','ad_sync_coverage']){
  assert.ok(writes.some(x=>x.sql.includes('INSERT INTO marketing.'+table)),table);
 }
 assert.ok(writes.some(x=>x.sql.includes('new_ads_detected')));
 assert.ok(!writes.some(x=>/^\s*DELETE FROM marketing\.(ads|ad_daily_metrics)/i.test(x.sql)));
});
