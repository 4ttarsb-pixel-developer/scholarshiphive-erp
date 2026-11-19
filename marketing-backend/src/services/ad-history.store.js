// Append-only ad history archive.
//   memory driver  -> dev JSON snapshot (var/ad-history.json), preserved behavior.
//   postgres driver-> normalized tables (ad_campaigns/ad_groups/ads/
//     ad_daily_metrics/ad_account_daily_metrics/ad_sync_coverage). The nested
//     `db` object is the working cache: hydrated at startup and persisted via
//     persist(account) at the async sync/verify boundaries, so commit()/slice()/
//     coverage() stay synchronous and unchanged. Records are never deleted.
const fs=require('node:fs');
const path=require('node:path');
const {HttpError}=require('../utils/http');
const fx=require('./fx.service');
const store=require('../data/mock.store');
const IS_PG=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres';
const pg=()=>require('../db/pool');
const file=process.env.MEA_AD_ARCHIVE_PATH||path.join(__dirname,'../../var/ad-history.json');
let memoryDB={version:1,accounts:{}};
function getDB(){
 if(IS_PG){const ctx=require('../db/request-context').current();if(ctx)return ctx.adHistory;}
 return memoryDB;
}
function setDB(value){
 if(IS_PG){const ctx=require('../db/request-context').current();if(ctx){ctx.adHistory=value;return;}}
 memoryDB=value;
}
if(!IS_PG){
 try {if(!['test','production'].includes(process.env.NODE_ENV)&&fs.existsSync(file)) {const obj=JSON.parse(fs.readFileSync(file,'utf8'));if(obj?.version===1&&obj.accounts)setDB(obj);}}
 catch(e){throw new Error(`Cannot read ads archive at ${file}; refusing to overwrite it: ${e.message}`)}
}
function write(){
 if(IS_PG||['test','production'].includes(process.env.NODE_ENV))return;
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=file+'.'+process.pid+'.tmp';
 fs.writeFileSync(tmp,JSON.stringify(getDB()),{mode:0o600});
 try{fs.renameSync(tmp,file)}catch(e){try{fs.rmSync(tmp,{force:true})}catch{}throw e;}
}
function key(a){return `${a.platform}:${String(a.externalAccountId||'').replace(/^act_/,'').replaceAll('-','')}`;}
const account=a=>{const k=key(a);const db=getDB();if(!db.accounts[k])db.accounts[k]={platform:a.platform,externalAccountId:a.externalAccountId,campaigns:{},adGroups:{},ads:{},daily:{},syncedRanges:[],lastSyncedAt:null,lastVerifiedAt:null,externalName:null,currency:null,accountDaily:{},lastError:null,newAdsDetected:0,newCampaignsDetected:0};return db.accounts[k]};
function seen(old,item,now){return {...old,...item,firstSeenAt:old?.firstSeenAt||now,lastSeenAt:now,missingSyncCount:0,availabilityStatus:'AVAILABLE',lastKnownPlatformStatus:item.effectiveStatus||item.status||old?.lastKnownPlatformStatus||'UNKNOWN'};}
function commit(a,snapshot,period){
 const r=account(a),now=new Date().toISOString();
 const isFirstSync=!r.lastSyncedAt;
 const previouslyKnown={ads:new Set(Object.keys(r.ads)),campaigns:new Set(Object.keys(r.campaigns))};
 const seenIds={campaigns:new Set(),adGroups:new Set(),ads:new Set()};
 for(const kind of ['campaigns','adGroups','ads']){
  for(const item of snapshot[kind]||[]){const id=String(item.id);seenIds[kind].add(id);
   const {daily,metrics,...rest}=item; r[kind][id]=seen(r[kind][id],rest,now);
   if(kind==='ads'&&Array.isArray(daily))for(const entry of daily){if(entry.date>=period.startDate&&entry.date<=period.endDate){r.daily[`${id}|${entry.date}`]={adId:id,date:entry.date,...entry.metrics,source:'live_api',updatedAt:now};}}
  }
  // Never DELETE. Missing inventory is not proof that Meta deleted the ad.
  for(const [id,item] of Object.entries(r[kind]))if(!seenIds[kind].has(id)){
   item.missingSyncCount=(item.missingSyncCount||0)+1;
   if(item.missingSyncCount>=2)item.availabilityStatus='UNAVAILABLE';
  }
 }
 if(snapshot.performance?.daily)for(const x of snapshot.performance.daily){if(x.date>=period.startDate&&x.date<=period.endDate)r.accountDaily[x.date]={...x.metrics,date:x.date,updatedAt:now};}
 r.syncedRanges.push({startDate:period.startDate,endDate:period.endDate,at:now});
 if(r.syncedRanges.length>250)r.syncedRanges=r.syncedRanges.slice(-250);
 r.lastSyncedAt=now;r.lastError=null;
 r.newAdsDetected=isFirstSync?0:(snapshot.ads||[]).filter(x=>!previouslyKnown.ads.has(String(x.id))).length;
 r.newCampaignsDetected=isFirstSync?0:(snapshot.campaigns||[]).filter(x=>!previouslyKnown.campaigns.has(String(x.id))).length;
 if(snapshot.currency)r.currency=snapshot.currency;
 write();return r;
}
function verify(a,info){const r=account(a);r.lastVerifiedAt=new Date().toISOString();r.externalName=info.externalName||a.name;r.currency=info.currency||r.currency;write();return r;}
function error(a,message){const r=account(a);r.lastError=String(message||'Sync failed').slice(0,500);write();}
const entries=(a,kind)=>Object.values(account(a)[kind]);
function coverage(a,period){
 const rows=account(a).syncedRanges;
 // Check each date covered; missing coverage is not a zero-spend result.
 const covered=new Set();for(const r of rows){let d=new Date(r.startDate+'T00:00:00Z'),end=new Date(r.endDate+'T00:00:00Z');while(d<=end){covered.add(d.toISOString().slice(0,10));d.setUTCDate(d.getUTCDate()+1)}}
 let days=0;const begin=new Date(period.startDate+'T00:00:00Z'),end=new Date(period.endDate+'T00:00:00Z');while(begin<=end){if(covered.has(begin.toISOString().slice(0,10)))days++;begin.setUTCDate(begin.getUTCDate()+1)}
 return {coveredDays:days,totalDays:period.days,complete:days===period.days};
}
function totalDaily(entries,dates){const sums={spend:0,impressions:0,clicks:0,leads:0,conversions:0},known={spend:false,impressions:false,clicks:false,leads:false,conversions:false};
 for(const r of entries){if(!dates(r.date))continue;for(const k of Object.keys(sums))if(typeof r[k]==='number'&&Number.isFinite(r[k])){known[k]=true;sums[k]+=r[k]}}
 return Object.fromEntries(Object.keys(sums).map(k=>[k,known[k]?(k==='spend'?Math.round(sums[k]*100)/100:sums[k]):null]));}
function slice(a,period){const r=account(a);const inRange=d=>d>=period.startDate&&d<=period.endDate;
 const adDaily=Object.values(r.daily);const ads=entries(a,'ads').map(item=>({...item,effectiveStatus:item.availabilityStatus==='UNAVAILABLE'?'UNAVAILABLE':(item.lastKnownPlatformStatus||'UNKNOWN'),metrics:(()=>{const daily=adDaily.filter(x=>x.adId===item.id&&inRange(x.date));const m=totalDaily(daily,()=>true);return {...m,...fx.convertDaily(daily,r.currency,m.spend)};})()}));
 // Show historical ads with activity in range, plus currently available ads, even with no spend.
 // Keep inventory visible in every reporting month, including stopped/deleted/unavailable ads.
 // Historical period metrics may be null if that ad had no activity in the selected dates.
 const matchedAds=ads.sort((x,y)=>(x.availabilityStatus==='UNAVAILABLE')-(y.availabilityStatus==='UNAVAILABLE') || x.name.localeCompare(y.name));
 const campaignList=entries(a,'campaigns'),groupList=entries(a,'adGroups');
 const covered=coverage(a,period);const accountRows=Object.values(r.accountDaily).filter(x=>inRange(x.date));
 const metrics=totalDaily(accountRows,()=>true);
 if(covered.complete&&metrics.spend===null){metrics.spend=0;metrics.clicks=0;metrics.impressions=0;}
 return {source:r.lastSyncedAt?'live_api':'not_synced',lastSyncedAt:r.lastSyncedAt,currency:r.currency,period,coverage:covered,metrics:{...metrics,...fx.convertDaily(accountRows,r.currency,metrics.spend),currency:r.currency,metricsAvailable:covered.complete,source:'historical_daily_archive'},campaigns:campaignList,adGroups:groupList,ads:matchedAds,archivedAdCount:ads.filter(x=>x.availabilityStatus==='UNAVAILABLE').length};
}
function inspect(){return JSON.parse(JSON.stringify(getDB()));}

// ===========================================================================
// POSTGRES persistence: hydrate the cache at startup; persist an account subtree
// at the async sync/verify boundary. Historical rows are upserted, never deleted.
// ===========================================================================
const n=(v)=>v==null?null:Number(v);
const TS=(c)=>`to_char(${c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
async function hydrate(period=null){
 if(!IS_PG)return;
 setDB({version:1,accounts:{}});
 const {pool}=pg();
 for(const a of store.accounts){
  const accId=a.id;
  const meta=(await pool.query(`SELECT currency_code AS currency, ${TS('verified_at')} AS "verifiedAt", ${TS('last_synced_at')} AS "lastSyncedAt", last_error AS "lastError" FROM marketing.ad_accounts WHERE id=$1`,[accId])).rows[0]||{};
  const r=account(a);
  r.currency=meta.currency||null; r.lastVerifiedAt=meta.verifiedAt||null; r.lastSyncedAt=meta.lastSyncedAt||null; r.lastError=meta.lastError||null; r.externalName=a.name;
  for(const c of (await pool.query(`SELECT external_campaign_id id, name, last_known_status status, availability_status "availabilityStatus", ${TS('first_seen_at')} "firstSeenAt", ${TS('last_seen_at')} "lastSeenAt", missing_sync_count "missingSyncCount" FROM marketing.ad_campaigns WHERE account_id=$1`,[accId])).rows)
   r.campaigns[c.id]={id:c.id,name:c.name,status:c.status,availabilityStatus:c.availabilityStatus,lastKnownPlatformStatus:c.status,firstSeenAt:c.firstSeenAt,lastSeenAt:c.lastSeenAt,missingSyncCount:c.missingSyncCount};
  for(const g of (await pool.query(`SELECT external_group_id id, external_campaign_id "campaignId", name, last_known_status status, availability_status "availabilityStatus", ${TS('first_seen_at')} "firstSeenAt", ${TS('last_seen_at')} "lastSeenAt", missing_sync_count "missingSyncCount" FROM marketing.ad_groups WHERE account_id=$1`,[accId])).rows)
   r.adGroups[g.id]={id:g.id,campaignId:g.campaignId,name:g.name,status:g.status,availabilityStatus:g.availabilityStatus,lastKnownPlatformStatus:g.status,firstSeenAt:g.firstSeenAt,lastSeenAt:g.lastSeenAt,missingSyncCount:g.missingSyncCount};
  const adRows=(await pool.query(`SELECT id::text uuid, external_ad_id id, external_campaign_id "campaignId", external_group_id "adGroupId", name, last_known_status status, availability_status "availabilityStatus", ${TS('first_seen_at')} "firstSeenAt", ${TS('last_seen_at')} "lastSeenAt", missing_sync_count "missingSyncCount" FROM marketing.ads WHERE account_id=$1`,[accId])).rows;
  const uuidToExt={};
  for(const ad of adRows){uuidToExt[ad.uuid]=ad.id;r.ads[ad.id]={id:ad.id,campaignId:ad.campaignId,adGroupId:ad.adGroupId,name:ad.name,status:ad.status,availabilityStatus:ad.availabilityStatus,lastKnownPlatformStatus:ad.status,firstSeenAt:ad.firstSeenAt,lastSeenAt:ad.lastSeenAt,missingSyncCount:ad.missingSyncCount};}
  for(const m of (await pool.query(`SELECT a.external_ad_id "extId", to_char(m.report_date,'YYYY-MM-DD') date, m.currency, m.spend_original spend, m.impressions, m.clicks, m.leads, m.conversions, m.source FROM marketing.ad_daily_metrics m JOIN marketing.ads a ON a.id=m.ad_id
     WHERE a.account_id=$1 AND ($2::date IS NULL OR m.report_date >= $2::date)
                           AND ($3::date IS NULL OR m.report_date <= $3::date)`,[accId,period?.startDate||null,period?.endDate||null])).rows)
   r.daily[`${m.extId}|${m.date}`]={adId:m.extId,date:m.date,spend:n(m.spend),impressions:n(m.impressions),clicks:n(m.clicks),leads:n(m.leads),conversions:n(m.conversions),source:m.source};
  for(const m of (await pool.query(`SELECT to_char(report_date,'YYYY-MM-DD') date, spend_original spend, impressions, clicks, leads, conversions FROM marketing.ad_account_daily_metrics
     WHERE account_id=$1 AND ($2::date IS NULL OR report_date >= $2::date)
                         AND ($3::date IS NULL OR report_date <= $3::date)`,[accId,period?.startDate||null,period?.endDate||null])).rows)
   r.accountDaily[m.date]={date:m.date,spend:n(m.spend),impressions:n(m.impressions),clicks:n(m.clicks),leads:n(m.leads),conversions:n(m.conversions)};
  r.syncedRanges=(await pool.query(`SELECT to_char(report_date,'YYYY-MM-DD') d, ${TS('received_at')} at FROM marketing.ad_sync_coverage WHERE account_id=$1 ORDER BY report_date`,[accId])).rows.map(x=>({startDate:x.d,endDate:x.d,at:x.at}));
 }
}
async function persist(a){
 if(!IS_PG)return;
 const r=account(a),accId=a.id;
 const {withTransaction}=pg();
 await withTransaction(async client=>{
  await client.query(`UPDATE marketing.ad_accounts SET currency_code=$2, verified_at=$3, last_synced_at=$4, last_error=$5 WHERE id=$1`,
   [accId, r.currency||null, r.lastVerifiedAt||null, r.lastSyncedAt||null, r.lastError||null]);
  for(const [id,c] of Object.entries(r.campaigns))
   await client.query(`INSERT INTO marketing.ad_campaigns (account_id,external_campaign_id,name,last_known_status,availability_status,first_seen_at,last_seen_at,missing_sync_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (account_id,external_campaign_id) DO UPDATE SET name=EXCLUDED.name,last_known_status=EXCLUDED.last_known_status,availability_status=EXCLUDED.availability_status,first_seen_at=COALESCE(marketing.ad_campaigns.first_seen_at,EXCLUDED.first_seen_at),last_seen_at=EXCLUDED.last_seen_at,missing_sync_count=EXCLUDED.missing_sync_count`,
    [accId,id,c.name||null,c.lastKnownPlatformStatus||c.status||null,c.availabilityStatus||'AVAILABLE',c.firstSeenAt||null,c.lastSeenAt||null,c.missingSyncCount||0]);
  for(const [id,g] of Object.entries(r.adGroups))
   await client.query(`INSERT INTO marketing.ad_groups (account_id,external_group_id,external_campaign_id,name,last_known_status,availability_status,first_seen_at,last_seen_at,missing_sync_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (account_id,external_group_id) DO UPDATE SET external_campaign_id=EXCLUDED.external_campaign_id,name=EXCLUDED.name,last_known_status=EXCLUDED.last_known_status,availability_status=EXCLUDED.availability_status,first_seen_at=COALESCE(marketing.ad_groups.first_seen_at,EXCLUDED.first_seen_at),last_seen_at=EXCLUDED.last_seen_at,missing_sync_count=EXCLUDED.missing_sync_count`,
    [accId,id,g.campaignId||null,g.name||null,g.lastKnownPlatformStatus||g.status||null,g.availabilityStatus||'AVAILABLE',g.firstSeenAt||null,g.lastSeenAt||null,g.missingSyncCount||0]);
  const extToUuid={};
  for(const [id,ad] of Object.entries(r.ads)){
   const previous=await client.query(
     `SELECT id::text id, last_known_status, availability_status FROM marketing.ads
      WHERE account_id=$1 AND external_ad_id=$2 FOR UPDATE`,[accId,id]);
   const old=previous.rows[0];
   const nextStatus=ad.availabilityStatus==='UNAVAILABLE'?'UNAVAILABLE':(ad.lastKnownPlatformStatus||ad.status||'UNKNOWN');
   const priorStatus=old?(old.availability_status==='UNAVAILABLE'?'UNAVAILABLE':(old.last_known_status||'UNKNOWN')):null;
   const res=await client.query(`INSERT INTO marketing.ads (account_id,external_ad_id,external_campaign_id,external_group_id,name,last_known_status,availability_status,first_seen_at,last_seen_at,missing_sync_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (account_id,external_ad_id) DO UPDATE SET external_campaign_id=EXCLUDED.external_campaign_id,external_group_id=EXCLUDED.external_group_id,name=EXCLUDED.name,last_known_status=EXCLUDED.last_known_status,availability_status=EXCLUDED.availability_status,first_seen_at=COALESCE(marketing.ads.first_seen_at,EXCLUDED.first_seen_at),last_seen_at=EXCLUDED.last_seen_at,missing_sync_count=EXCLUDED.missing_sync_count RETURNING id::text`,
    [accId,id,ad.campaignId||null,ad.adGroupId||null,ad.name||null,ad.lastKnownPlatformStatus||ad.status||null,ad.availabilityStatus||'AVAILABLE',ad.firstSeenAt||null,ad.lastSeenAt||null,ad.missingSyncCount||0]);
   extToUuid[id]=res.rows[0].id;
   if(priorStatus!==nextStatus){
    await client.query(`INSERT INTO marketing.ad_status_events
       (ad_id,old_status,new_status,source,verified) VALUES ($1,$2,$3,$4,$5)`,
       [res.rows[0].id,priorStatus,nextStatus,
        ad.availabilityStatus==='UNAVAILABLE'?'sync_missing':'live_api',ad.availabilityStatus!=='UNAVAILABLE']);
   }
  }
  for(const m of Object.values(r.daily)){
   const uuid=extToUuid[String(m.adId)]; if(!uuid)continue;
   await client.query(`INSERT INTO marketing.ad_daily_metrics (ad_id,report_date,currency,spend_original,impressions,clicks,leads,conversions,source,fetched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
     ON CONFLICT (ad_id,report_date) DO UPDATE SET currency=EXCLUDED.currency,spend_original=EXCLUDED.spend_original,impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,leads=EXCLUDED.leads,conversions=EXCLUDED.conversions,fetched_at=now()`,
    [uuid,m.date,r.currency||null,n(m.spend),n(m.impressions),n(m.clicks),n(m.leads),n(m.conversions),m.source||'live_api']);
  }
  for(const m of Object.values(r.accountDaily))
   await client.query(`INSERT INTO marketing.ad_account_daily_metrics (account_id,report_date,currency,spend_original,impressions,clicks,leads,conversions,fetched_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
     ON CONFLICT (account_id,report_date) DO UPDATE SET currency=EXCLUDED.currency,spend_original=EXCLUDED.spend_original,impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,leads=EXCLUDED.leads,conversions=EXCLUDED.conversions,fetched_at=now()`,
    [accId,m.date,r.currency||null,n(m.spend),n(m.impressions),n(m.clicks),n(m.leads),n(m.conversions)]);
  for(const range of r.syncedRanges){
   let d=new Date(range.startDate+'T00:00:00Z');const end=new Date(range.endDate+'T00:00:00Z');
   while(d<=end){const ds=d.toISOString().slice(0,10);
    await client.query(`INSERT INTO marketing.ad_sync_coverage (account_id,report_date,source,received_at) VALUES ($1,$2,'live_api',now()) ON CONFLICT (account_id,report_date) DO NOTHING`,[accId,ds]);
    d.setUTCDate(d.getUTCDate()+1);}
  }
 });
}
// Idempotent import of a var/ad-history.json archive into the normalized tables.
// Matches each archived account to a registered ad_accounts row by platform +
// external id (register the account catalog first). Never deletes history.
async function importJson(obj){
 if(!IS_PG)throw new Error('ad-history import requires the postgres driver');
 const {pool}=pg();
 const toDb={'Meta Ads':'meta','Google Ads':'google','TikTok Ads':'tiktok'};
 let imported=0,skipped=0;
 for(const [k,entry] of Object.entries(obj.accounts||{})){
  const platformDb=toDb[entry.platform]||entry.platform;
  const found=(await pool.query(`SELECT id::text id FROM marketing.ad_accounts WHERE platform=$1 AND external_account_id=$2`,[platformDb,entry.externalAccountId])).rows[0];
  if(!found){skipped++;continue;}
  getDB().accounts[k]=entry;
  await persist({id:found.id,platform:entry.platform,externalAccountId:entry.externalAccountId});
  imported++;
 }
 return {imported,skipped};
}
// Durable record of each sync attempt (phase F observability: last success/failure).
async function recordRun(a,period,status,error){
 if(!IS_PG)return;
 await pg().query(
  `INSERT INTO marketing.ad_sync_runs (account_id,start_date,end_date,source,status,completed_at,error)
     VALUES ($1,$2,$3,'live_api',$4,now(),$5)`,
  [a.id,period.startDate,period.endDate,status,error?String(error).slice(0,500):null]).catch(()=>{});
}
module.exports={account,commit,verify,error,slice,coverage,inspect,hydrate,persist,importJson,recordRun,file,IS_PG};
