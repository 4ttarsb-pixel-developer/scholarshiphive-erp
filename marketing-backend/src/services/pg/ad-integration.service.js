'use strict';
// PostgreSQL-only reporting and ad-sync runtime. The DB is queried on every read;
// no global mutable ad history, account or FX cache exists in this execution path.
const {db,HttpError,parsePeriod,fmtTs,num,money,configStatus,account,accounts}=require('./common');
const {chunks}=require('../../utils/report-period');
const adapters={'Meta Ads':require('../../integrations/meta/meta.service'),'Google Ads':require('../../integrations/google/google.service'),'TikTok Ads':require('../../integrations/tiktok/tiktok.service')};
const queue=require('../../jobs/ad-sync.queue');
const statsFields=['spend','impressions','clicks','leads','conversions'];
function rollup(rows){
 const result={spend:null,impressions:null,clicks:null,leads:null,conversions:null};
 for(const field of statsFields){const known=rows.filter(r=>r[field]!=null);if(known.length)result[field]=field==='spend'||field==='conversions'?money(known.reduce((sum,r)=>sum+Number(r[field]),0)):known.reduce((sum,r)=>sum+Number(r[field]),0);}
 return result;
}
async function convert(rows,currency,nativeSpend,fxRates){
 if(nativeSpend==null)return {spendPKR:null,fxStatus:'source_unavailable',missingRateMonths:[],ratePolicy:'company_monthly_reference'};
 if(currency==='PKR')return {spendPKR:money(nativeSpend),fxStatus:'native_pkr',missingRateMonths:[],ratePolicy:'native'};
 if(!currency)return {spendPKR:null,fxStatus:'currency_unknown',missingRateMonths:[],ratePolicy:'company_monthly_reference'};
 if(nativeSpend===0)return {spendPKR:0,fxStatus:'zero_spend',missingRateMonths:[],ratePolicy:'company_monthly_reference'};
 if(!rows.length)return {spendPKR:null,fxStatus:'daily_data_unavailable',missingRateMonths:[],ratePolicy:'company_monthly_reference'};
 let total=0;const missing=new Set();
 for(const row of rows){if(row.spend==null)continue;const month=row.date.slice(0,7),rate=fxRates.get(`${currency}:${month}`);if(rate==null)missing.add(month);else total+=Number(row.spend)*rate;}
 return {spendPKR:missing.size?null:money(total),fxStatus:missing.size?'rate_missing':'converted',missingRateMonths:[...missing].sort(),ratePolicy:'company_monthly_reference'};
}
async function snapshot(accountRow,q={}){
 const period=parsePeriod(q),id=accountRow.id,currency=accountRow.currency;
 const [campaigns,groups,ads,daily,accountDaily,covered,fx]=await Promise.all([
  db.query(`SELECT external_campaign_id id,name,last_known_status status,availability_status "availabilityStatus",${fmtTs('first_seen_at')} "firstSeenAt",${fmtTs('last_seen_at')} "lastSeenAt",missing_sync_count "missingSyncCount" FROM marketing.ad_campaigns WHERE account_id=$1 ORDER BY name,id`,[id]),
  db.query(`SELECT external_group_id id,external_campaign_id "campaignId",name,last_known_status status,availability_status "availabilityStatus",${fmtTs('first_seen_at')} "firstSeenAt",${fmtTs('last_seen_at')} "lastSeenAt",missing_sync_count "missingSyncCount" FROM marketing.ad_groups WHERE account_id=$1 ORDER BY name,id`,[id]),
  db.query(`SELECT external_ad_id id,external_campaign_id "campaignId",external_group_id "adGroupId",name,last_known_status status,availability_status "availabilityStatus",${fmtTs('first_seen_at')} "firstSeenAt",${fmtTs('last_seen_at')} "lastSeenAt",missing_sync_count "missingSyncCount" FROM marketing.ads WHERE account_id=$1 ORDER BY name,id`,[id]),
  db.query(`SELECT a.external_ad_id "adId",to_char(m.report_date,'YYYY-MM-DD') date,m.spend_original::float8 spend,m.impressions::float8 impressions,m.clicks::float8 clicks,m.leads::float8 leads,m.conversions::float8 conversions FROM marketing.ad_daily_metrics m JOIN marketing.ads a ON a.id=m.ad_id WHERE a.account_id=$1 AND m.report_date BETWEEN $2::date AND $3::date`,[id,period.startDate,period.endDate]),
  db.query(`SELECT to_char(report_date,'YYYY-MM-DD') date,spend_original::float8 spend,impressions::float8 impressions,clicks::float8 clicks,leads::float8 leads,conversions::float8 conversions FROM marketing.ad_account_daily_metrics WHERE account_id=$1 AND report_date BETWEEN $2::date AND $3::date`,[id,period.startDate,period.endDate]),
  db.query(`SELECT count(*)::int n FROM marketing.ad_sync_coverage WHERE account_id=$1 AND report_date BETWEEN $2::date AND $3::date`,[id,period.startDate,period.endDate]),
  db.query(`SELECT currency,to_char(month,'YYYY-MM') AS "month",rate_pkr::float8 rate FROM marketing.fx_rates WHERE month BETWEEN date_trunc('month',$1::date)::date AND date_trunc('month',$2::date)::date`,[period.startDate,period.endDate]),
 ]);
 const rates=new Map(fx.rows.map(r=>[`${String(r.currency).trim()}:${r.month}`,r.rate]));
 const adRows=[];
 for(const item of ads.rows){const d=daily.rows.filter(r=>r.adId===item.id);const metrics=rollup(d);adRows.push({...item,effectiveStatus:item.availabilityStatus==='UNAVAILABLE'?'UNAVAILABLE':item.status||'UNKNOWN',metrics:{...metrics,...await convert(d,currency,metrics.spend,rates)}});}
 const coverage={coveredDays:covered.rows[0]?.n||0,totalDays:period.days,complete:(covered.rows[0]?.n||0)===period.days};
 const metrics=rollup(accountDaily.rows);
 if(coverage.complete && metrics.spend==null){metrics.spend=0;metrics.clicks=0;metrics.impressions=0;}
 Object.assign(metrics,await convert(accountDaily.rows,currency,metrics.spend,rates),{currency,metricsAvailable:coverage.complete,source:'historical_daily_archive'});
 return {source:accountRow.lastSyncedAt?'live_api':'not_synced',lastSyncedAt:accountRow.lastSyncedAt,currency,period,coverage,metrics,campaigns:campaigns.rows,adGroups:groups.rows,ads:adRows,archivedAdCount:adRows.filter(a=>a.availabilityStatus==='UNAVAILABLE').length};
}
async function status(id,user,q={}){
 const a=await account(id,user),v=await snapshot(a,q),running=await queue.accountSyncState(id);
 return {accountId:id,platform:a.platform,credentialsConfigured:configStatus(a.platform),integrationStatus:running.inProgress?'Syncing':a.lastError?'Sync failed':a.lastSyncedAt?'Synced':a.lastVerifiedAt?'Verified':'Not connected',lastVerifiedAt:a.lastVerifiedAt,lastSyncedAt:a.lastSyncedAt,lastError:a.lastError,metrics:v.metrics,spend:v.coverage.complete?v.metrics.spend:null,leads:v.coverage.complete?v.metrics.leads:null,ads:v.ads.length,currency:a.currency,spendPKR:v.coverage.complete?v.metrics.spendPKR:null,fxStatus:v.metrics.fxStatus,missingRateMonths:v.metrics.missingRateMonths,externalName:a.name,source:v.source,period:v.period,coverage:v.coverage,campaignCount:v.campaigns.length,adGroupCount:v.adGroups.length,adCount:v.ads.length,archivedAdCount:v.archivedAdCount,newAdsDetected:a.newAdsDetected||0,newCampaignsDetected:a.newCampaignsDetected||0,syncInProgress:running.inProgress};
}
async function verify(id,user){
 if(user.role!=='Admin')throw new HttpError(403,'Admin access required');
 const a=await account(id,user);if(!a.externalAccountId||a.externalAccountId.startsWith('pending-'))throw new HttpError(400,'Register an external account ID');
 const adapter=adapters[a.platform];if(!adapter)throw new HttpError(400,'Unknown platform');
 try{const result=await adapter.verify(a);
  await db.query(`UPDATE marketing.ad_accounts SET verified_at=now(),currency_code=COALESCE($2,currency_code),integration_status='Verified',last_error=NULL WHERE id=$1`,[id,result.currency||null]);
  return status(id,user);
 }catch(err){await db.query(`UPDATE marketing.ad_accounts SET last_error=$2,integration_status='Verification failed' WHERE id=$1`,[id,String(err.message).slice(0,500)]).catch(()=>{});throw err;}
}
async function enqueue(id,user,{force=false,...q}={}){
 const a=await account(id,user),p=parsePeriod(q);
 if(!a.externalAccountId||a.externalAccountId.startsWith('pending-'))throw new HttpError(400,'External account ID is required');
 if(!configStatus(a.platform))throw new HttpError(409,'Credentials for this platform are not configured');
 if(!a.lastVerifiedAt)throw new HttpError(409,'Admin must verify the account first');
 const state=await queue.accountSyncState(id);
 if(state.inProgress)return {queued:false,inProgress:true,message:'Another sync is already pending',...await status(id,user,q)};
 if(!force && a.lastSyncedAt && Date.now()-Date.parse(a.lastSyncedAt)<30000)return {queued:false,inProgress:false,message:'Recently synchronized',...await status(id,user,q)};
 const jobId=await queue.enqueue(id,{startDate:p.startDate,endDate:p.endDate,reason:'manual'});
 return {...await status(id,user,q),queued:!!jobId,inProgress:!!jobId,period:p,message:jobId?'Sync queued in PostgreSQL':'Sync already queued for this interval'};
}
async function performance(id,user,q={}){const a=await account(id,user),v=await snapshot(a,q);return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,coverage:v.coverage,metrics:v.metrics};}
async function campaigns(id,user,q={}){const a=await account(id,user),v=await snapshot(a,q);return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,coverage:v.coverage,items:v.campaigns};}
async function adGroups(id,user,campaignId,q={}){const a=await account(id,user),v=await snapshot(a,q);return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,coverage:v.coverage,items:campaignId?v.adGroups.filter(g=>g.campaignId===campaignId):v.adGroups};}
async function ads(id,user,q={}){
 const a=await account(id,user),v=await snapshot(a,q);let items=v.ads;
 if(q.campaignId)items=items.filter(x=>x.campaignId===q.campaignId);
 if(q.adGroupId)items=items.filter(x=>x.adGroupId===q.adGroupId);
 if(q.status&&q.status!=='ALL')items=items.filter(x=>x.effectiveStatus===q.status);
 return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,coverage:v.coverage,window:v.period.label,items};
}
async function adDetail(id,adId,user,q={}){const data=await ads(id,user,q),item=data.items.find(x=>x.id===adId);if(!item)throw new HttpError(404,'Ad not in selected report');return {...data,items:undefined,ad:item};}
function sumChildren(list){const known=list.filter(a=>a.metrics?.spend!=null);if(!known.length)return null;const allPKR=known.every(a=>a.metrics.spendPKR!=null);return {spend:money(known.reduce((n,a)=>n+a.metrics.spend,0)),spendPKR:allPKR?money(known.reduce((n,a)=>n+a.metrics.spendPKR,0)):null,impressions:known.reduce((n,a)=>n+(a.metrics.impressions||0),0),clicks:known.reduce((n,a)=>n+(a.metrics.clicks||0),0),leads:known.some(a=>a.metrics.leads!=null)?known.reduce((n,a)=>n+(a.metrics.leads||0),0):null};}
async function hierarchy(id,user,q={}){const a=await account(id,user),v=await snapshot(a,q);return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,window:v.period.label,coverage:v.coverage,campaigns:v.campaigns.map(c=>({...c,metrics:sumChildren(v.ads.filter(a=>a.campaignId===c.id))})),adGroups:v.adGroups.map(g=>({...g,metrics:sumChildren(v.ads.filter(a=>a.adGroupId===g.id))})),ads:v.ads,archivedAdCount:v.archivedAdCount};}
async function recordRun(a,period,status,error){await db.query(`INSERT INTO marketing.ad_sync_runs(account_id,start_date,end_date,source,status,completed_at,error) VALUES ($1,$2,$3,'live_api',$4,now(),$5)`,[a.id,period.startDate,period.endDate,status,error?String(error).slice(0,500):null]);}
async function commitChunk(a,span,result){
 const {performance,campaigns,groups,ads}=result,currency=performance.currency||a.currency||null;
 await db.withTransaction(async c=>{
  await c.query(`UPDATE marketing.ad_accounts SET currency_code=COALESCE($2,currency_code) WHERE id=$1`,[a.id,currency]);
  for(const item of campaigns){await c.query(`INSERT INTO marketing.ad_campaigns(account_id,external_campaign_id,name,last_known_status,availability_status,first_seen_at,last_seen_at,missing_sync_count) VALUES($1,$2,$3,$4,'AVAILABLE',now(),now(),0) ON CONFLICT(account_id,external_campaign_id) DO UPDATE SET name=EXCLUDED.name,last_known_status=EXCLUDED.last_known_status,availability_status='AVAILABLE',last_seen_at=now(),missing_sync_count=0`,[a.id,String(item.id),item.name,item.status||'UNKNOWN']);}
  for(const item of groups){await c.query(`INSERT INTO marketing.ad_groups(account_id,external_group_id,external_campaign_id,name,last_known_status,availability_status,first_seen_at,last_seen_at,missing_sync_count) VALUES($1,$2,$3,$4,$5,'AVAILABLE',now(),now(),0) ON CONFLICT(account_id,external_group_id) DO UPDATE SET external_campaign_id=EXCLUDED.external_campaign_id,name=EXCLUDED.name,last_known_status=EXCLUDED.last_known_status,availability_status='AVAILABLE',last_seen_at=now(),missing_sync_count=0`,[a.id,String(item.id),String(item.campaignId||''),item.name,item.status||'UNKNOWN']);}
  for(const item of ads){
   const old=(await c.query(`SELECT id,last_known_status,availability_status FROM marketing.ads WHERE account_id=$1 AND external_ad_id=$2 FOR UPDATE`,[a.id,String(item.id)])).rows[0];
   const v=await c.query(`INSERT INTO marketing.ads(account_id,external_ad_id,external_campaign_id,external_group_id,name,last_known_status,availability_status,first_seen_at,last_seen_at,missing_sync_count) VALUES($1,$2,$3,$4,$5,$6,'AVAILABLE',now(),now(),0) ON CONFLICT(account_id,external_ad_id) DO UPDATE SET external_campaign_id=EXCLUDED.external_campaign_id,external_group_id=EXCLUDED.external_group_id,name=EXCLUDED.name,last_known_status=EXCLUDED.last_known_status,availability_status='AVAILABLE',last_seen_at=now(),missing_sync_count=0 RETURNING id`,[a.id,String(item.id),String(item.campaignId||''),String(item.adGroupId||''),item.name,item.effectiveStatus||item.status||'UNKNOWN']);
   const newStatus=item.effectiveStatus||item.status||'UNKNOWN';if(!old || old.last_known_status!==newStatus||old.availability_status==='UNAVAILABLE')await c.query(`INSERT INTO marketing.ad_status_events(ad_id,old_status,new_status,source,verified) VALUES($1,$2,$3,'live_api',true)`,[v.rows[0].id,old?.availability_status==='UNAVAILABLE'?'UNAVAILABLE':old?.last_known_status||null,newStatus]);
   for(const day of item.daily||[]){if(day.date<span.startDate||day.date>span.endDate)continue;const m=day.metrics||{};
    await c.query(`INSERT INTO marketing.ad_daily_metrics(ad_id,report_date,currency,spend_original,impressions,clicks,leads,conversions,source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'live_api') ON CONFLICT(ad_id,report_date) DO UPDATE SET currency=EXCLUDED.currency,spend_original=EXCLUDED.spend_original,impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,leads=EXCLUDED.leads,conversions=EXCLUDED.conversions,fetched_at=now()`,[v.rows[0].id,day.date,currency,m.spend??null,m.impressions??null,m.clicks??null,m.leads??null,m.conversions??null]);
   }
  }
  for(const day of performance.daily||[]){if(day.date<span.startDate||day.date>span.endDate)continue;const m=day.metrics||{};
   await c.query(`INSERT INTO marketing.ad_account_daily_metrics(account_id,report_date,currency,spend_original,impressions,clicks,leads,conversions) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(account_id,report_date) DO UPDATE SET currency=EXCLUDED.currency,spend_original=EXCLUDED.spend_original,impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,leads=EXCLUDED.leads,conversions=EXCLUDED.conversions,fetched_at=now()`,[a.id,day.date,currency,m.spend??null,m.impressions??null,m.clicks??null,m.leads??null,m.conversions??null]);
  }
  // Coverage records even when no ads exist: empty successful reports are valid.
  await c.query(`INSERT INTO marketing.ad_sync_coverage(account_id,report_date,source,received_at) SELECT $1, d::date,'live_api',now() FROM generate_series($2::date,$3::date,'1 day'::interval) d ON CONFLICT(account_id,report_date) DO NOTHING`,[a.id,span.startDate,span.endDate]);
 });
}
async function finalizeInventory(a,seen){
 // Missing inventory is not proof of deletion. Only mark UNAVAILABLE after two
 // COMPLETE successful full-inventory syncs; never remove historical facts.
 await db.withTransaction(async client=>{
  for(const [table,column,ids] of [['ad_campaigns','external_campaign_id',seen.campaigns],['ad_groups','external_group_id',seen.groups],['ads','external_ad_id',seen.ads]]){
   const old=(await client.query(`SELECT id::text id,${column} external_id,availability_status,last_known_status,missing_sync_count FROM marketing.${table} WHERE account_id=$1 FOR UPDATE`,[a.id])).rows;
   for(const row of old){if(ids.has(row.external_id))continue;
    const count=Number(row.missing_sync_count||0)+1,unavailable=count>=2;
    await client.query(`UPDATE marketing.${table} SET missing_sync_count=$2,availability_status=CASE WHEN $3 THEN 'UNAVAILABLE' ELSE availability_status END WHERE id=$1`,[row.id,count,unavailable]);
    if(table==='ads'&&unavailable&&row.availability_status!=='UNAVAILABLE')await client.query(`INSERT INTO marketing.ad_status_events(ad_id,old_status,new_status,source,verified) VALUES($1,$2,'UNAVAILABLE','sync_missing',false)`,[row.id,row.last_known_status]);
   }
  }
 });
}
async function runWindow(input,{startDate,endDate}){
 // Called from durable queue worker, after it has claimed the account lock.
 const a=await account(input.id,{id:input.connectedBy,role:'Admin'}),period=parsePeriod({startDate,endDate});
 if(!a.lastVerifiedAt)throw new HttpError(409,'Verify the account first');
 if(!configStatus(a.platform))throw new HttpError(409,'Advertising API credentials are not configured');
 const adapter=adapters[a.platform];const [knownAds,knownCampaigns]=await Promise.all([db.query(`SELECT external_ad_id id FROM marketing.ads WHERE account_id=$1`,[a.id]),db.query(`SELECT external_campaign_id id FROM marketing.ad_campaigns WHERE account_id=$1`,[a.id])]);
 const existingAds=new Set(knownAds.rows.map(x=>x.id)),existingCampaigns=new Set(knownCampaigns.rows.map(x=>x.id));
 const first=!a.lastSyncedAt,seen={campaigns:new Set(),groups:new Set(),ads:new Set()};
 try{
  for(const span of chunks(period,a.platform==='Meta Ads'?7:30)){
   const [performance,campaigns,groups,ads]=await Promise.all([adapter.performance(a,span),adapter.campaigns(a),adapter.adGroups(a),adapter.ads(a,span)]);
   // A failure in a later chunk never deletes earlier valid history.
   await commitChunk(a,span,{performance,campaigns,groups,ads});
   campaigns.forEach(x=>seen.campaigns.add(String(x.id)));groups.forEach(x=>seen.groups.add(String(x.id)));ads.forEach(x=>seen.ads.add(String(x.id)));
  }
  await finalizeInventory(a,seen);
  await db.query(`UPDATE marketing.ad_accounts SET last_synced_at=now(),last_error=NULL,integration_status='Synced',new_ads_detected=$2,new_campaigns_detected=$3 WHERE id=$1`,[a.id,first?0:[...seen.ads].filter(x=>!existingAds.has(x)).length,first?0:[...seen.campaigns].filter(x=>!existingCampaigns.has(x)).length]);
  await recordRun(a,period,'SUCCEEDED',null);
  return performance(a.id,{role:'Admin',id:a.connectedBy},period);
 }catch(err){await db.query(`UPDATE marketing.ad_accounts SET last_error=$2,integration_status='Sync failed' WHERE id=$1`,[a.id,String(err.message).slice(0,500)]).catch(()=>{});await recordRun(a,period,'FAILED',err.message).catch(()=>{});throw err;}
}
async function tick(){const rows=await accounts({role:'Admin'});for(const a of rows){if(a.lastVerifiedAt&&configStatus(a.platform)){const p=parsePeriod();await queue.enqueue(a.id,{startDate:p.startDate,endDate:p.endDate,reason:'scheduled'});}}}
function purge(){} // Historical records and facts are never removed.
module.exports={snapshot,status,verify,enqueue,campaigns,adGroups,ads,adDetail,performance,hierarchy,runWindow,tick,purge,configStatus,hasRunningSync:()=>false};
