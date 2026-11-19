// Calendar-based ad reporting + append-only history archive (development filesystem).
// No ad record is deleted merely because an API no longer returns it.
const {HttpError}=require('../utils/http');
const store=require('../data/mock.store');
const archive=require('./ad-history.store');
const {parsePeriod,chunks}=require('../utils/report-period');
const adapters={'Meta Ads':require('../integrations/meta/meta.service'),'Google Ads':require('../integrations/google/google.service'),'TikTok Ads':require('../integrations/tiktok/tiktok.service')};
const running=new Map();
const IS_PG=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres';
const configStatus=platform=>Boolean(platform==='Meta Ads'?process.env.META_ACCESS_TOKEN:platform==='Google Ads'?(process.env.GOOGLE_ADS_ACCESS_TOKEN||(process.env.GOOGLE_CLIENT_ID&&process.env.GOOGLE_CLIENT_SECRET&&process.env.GOOGLE_REFRESH_TOKEN)):platform==='TikTok Ads'?process.env.TIKTOK_ACCESS_TOKEN:false);
function getAccount(id,user){
 const a=store.accounts.find(item=>item.id===id);
 if(!a||!user||(user.role!=='Admin'&&!store.adAccountAssignments.some(x=>x.accountId===id&&x.userId===user.id&&user.status==='Active')))throw new HttpError(404,'Ad account not found');
 return a;
}
function snapshot(id,user,q={}){const a=getAccount(id,user);return archive.slice(a,parsePeriod(q));}
function status(id,user,q={}){const a=getAccount(id,user),r=archive.account(a),v=snapshot(id,user,q);return {accountId:id,platform:a.platform,credentialsConfigured:configStatus(a.platform),integrationStatus:running.has(id)?'Syncing':r.lastError?'Sync failed':r.lastSyncedAt?'Synced':r.lastVerifiedAt?'Verified':'Not connected',lastVerifiedAt:r.lastVerifiedAt,lastSyncedAt:r.lastSyncedAt,lastError:r.lastError,metrics:v.metrics,spend:v.coverage.complete?v.metrics.spend:null,leads:v.coverage.complete?v.metrics.leads:null,ads:v.ads.length,currency:r.currency,spendPKR:v.coverage.complete?v.metrics.spendPKR:null,fxStatus:v.metrics.fxStatus,missingRateMonths:v.metrics.missingRateMonths,externalName:r.externalName,source:v.source,period:v.period,coverage:v.coverage,campaignCount:v.campaigns.length,adGroupCount:v.adGroups.length,adCount:v.ads.length,archivedAdCount:v.archivedAdCount,newAdsDetected:r.newAdsDetected||0,newCampaignsDetected:r.newCampaignsDetected||0,syncInProgress:running.has(id)};}
async function verify(id,user){
 if(user.role!=='Admin')throw new HttpError(403,'Admin access required');
 const a=getAccount(id,user);if(!a.externalAccountId)throw new HttpError(400,'Register a real external account ID to verify this account');
 try{const result=await adapters[a.platform].verify(a);archive.verify(a,result);a.integrationStatus='Verified';if(archive.IS_PG)await archive.persist(a);return status(id,user);}
 catch(e){archive.error(a,e.message);a.integrationStatus='Verification failed';if(archive.IS_PG)await archive.persist(a).catch(()=>{});throw e;}
}
async function doSync(a,period){
 const adapter=adapters[a.platform];
 if(!a.externalAccountId)throw new HttpError(400,'External account ID is required');
 if(!configStatus(a.platform))throw new HttpError(409,'Advertising API credentials are not configured');
 if(!archive.account(a).lastVerifiedAt)throw new HttpError(409,'Verify the account first');
 // Track new ads/campaigns across the ENTIRE multi-chunk synchronization.
 // Comparing only the last chunk would incorrectly reset newAdsDetected to 0.
 const before=archive.account(a);
 const beforeAds=new Set(Object.keys(before.ads));
 const beforeCampaigns=new Set(Object.keys(before.campaigns));
 const wasSynced=Boolean(before.lastSyncedAt);
 // Sequential bounded history chunks; current inventory is fetched with each chunk and archived.
 for(const span of chunks(period,a.platform==='Meta Ads'?7:30)){
  const [performance,campaigns,adGroups,ads]=await Promise.all([
   adapter.performance(a,span),adapter.campaigns(a),adapter.adGroups(a),adapter.ads(a,span)
  ]);
  archive.commit(a,{performance,campaigns,adGroups,ads,currency:performance.currency||archive.account(a).currency},span);
  // Commit each successfully fetched period BEFORE fetching the next one:
  // a later API failure must not lose earlier accepted historic daily facts.
  if(IS_PG)await archive.persist(a);
 }
 const after=archive.account(a);
 after.newAdsDetected=wasSynced?Object.keys(after.ads).filter(id=>!beforeAds.has(id)).length:0;
 after.newCampaignsDetected=wasSynced?Object.keys(after.campaigns).filter(id=>!beforeCampaigns.has(id)).length:0;
 const v=archive.slice(a,period);a.integrationStatus='Synced';a.spend=v.metrics.spend;a.leads=v.metrics.leads;a.ads=v.ads.length;if(archive.IS_PG){await archive.persist(a);await archive.recordRun(a,period,'SUCCEEDED',null);}return v;
}
async function enqueue(id,user,{force=false,...query}={}){
 const a=getAccount(id,user),period=parsePeriod(query),r=archive.account(a);
 if(running.has(id))return {queued:false,inProgress:true,message:'Another sync is running',...status(id,user,query)};
 if(!a.externalAccountId)throw new HttpError(400,'External account ID is required');
 if(!configStatus(a.platform))throw new HttpError(409,'Credentials for this platform are not configured');
 if(!r.lastVerifiedAt)throw new HttpError(409,'Admin must verify the account first');
 if(!force && r.lastSyncedAt && Date.now()-Date.parse(r.lastSyncedAt)<30_000) return {queued:false,inProgress:false,message:'Recently synchronized',...status(id,user,query)};
 if(IS_PG){
  // In PG mode manual/refresh work is also durable and processed by the
  // background worker, not a detached promise tied to an HTTP request.
  const jobId=await require('../jobs/ad-sync.queue').enqueue(a.id,{startDate:period.startDate,endDate:period.endDate,reason:'manual'});
  return {queued:!!jobId,inProgress:true,period,message:jobId?'Sync queued in PostgreSQL':'Sync already queued for this interval',...status(id,user,query)};
 }
 const promise=Promise.resolve().then(()=>doSync(a,period)).catch(async e=>{archive.error(a,e.message);a.integrationStatus='Sync failed';if(archive.IS_PG){await archive.persist(a).catch(()=>{});await archive.recordRun(a,period,'FAILED',e.message);}}).finally(()=>running.delete(id));
 running.set(id,promise);
 return {queued:true,inProgress:true,period,message:'Sync started',...status(id,user,query)};
}
function campaigns(id,user,q={}){const v=snapshot(id,user,q);return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,coverage:v.coverage,items:v.campaigns};}
function adGroups(id,user,campaignId,q={}){const v=snapshot(id,user,q);return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,coverage:v.coverage,items:campaignId?v.adGroups.filter(g=>g.campaignId===campaignId):v.adGroups};}
function ads(id,user,q={}){const v=snapshot(id,user,q);let items=v.ads;
 if(q.campaignId)items=items.filter(a=>a.campaignId===q.campaignId);if(q.adGroupId)items=items.filter(a=>a.adGroupId===q.adGroupId);
 if(q.status && q.status!=='ALL')items=items.filter(a=>q.status==='ACTIVE'?a.effectiveStatus==='ACTIVE':q.status==='PAUSED'?a.effectiveStatus==='PAUSED':a.effectiveStatus===q.status);
 return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,coverage:v.coverage,window:v.period.label,items};}
function adDetail(id,adId,user,q={}){const v=ads(id,user,q);const row=v.items.find(a=>a.id===adId);if(!row)throw new HttpError(404,'Ad not in selected report');return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,coverage:v.coverage,ad:row};}
function performance(id,user,q={}){const v=snapshot(id,user,q);return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,coverage:v.coverage,metrics:v.metrics};}
function hierarchy(id,user,q={}){const v=snapshot(id,user,q);const sums=ads=>{const arr=ads.filter(a=>a.metrics?.spend!==null);return arr.length?{spend:Math.round(arr.reduce((n,a)=>n+a.metrics.spend,0)*100)/100,spendPKR:arr.every(a=>a.metrics.spendPKR!==null&&a.metrics.spendPKR!==undefined)?Math.round(arr.reduce((n,a)=>n+a.metrics.spendPKR,0)*100)/100:null,impressions:arr.reduce((n,a)=>n+(a.metrics.impressions||0),0),clicks:arr.reduce((n,a)=>n+(a.metrics.clicks||0),0),leads:arr.some(a=>a.metrics.leads!==null)?arr.reduce((n,a)=>n+(a.metrics.leads||0),0):null}:null};
 const campaigns=v.campaigns.map(c=>({...c,metrics:sums(v.ads.filter(a=>a.campaignId===c.id))}));
 const adGroups=v.adGroups.map(g=>({...g,metrics:sums(v.ads.filter(a=>a.adGroupId===g.id))}));
 return {source:v.source,lastSyncedAt:v.lastSyncedAt,period:v.period,window:v.period.label,coverage:v.coverage,campaigns,adGroups,ads:v.ads,archivedAdCount:v.archivedAdCount};
}
function purge(id){ // Explicitly removing an account reference must NOT erase its historical archive.
 running.delete(id);
}
// Durable-worker entry point: run a sync for an explicit date window.
function runWindow(a,{startDate,endDate}){return doSync(a,parsePeriod({startDate,endDate}));}
async function tick(){for(const a of store.accounts){if(archive.account(a).lastVerifiedAt&&configStatus(a.platform)){try{await enqueue(a.id,{id:a.connectedBy,role:'Admin',status:'Active'},{force:true});}catch{/* Keep scheduler alive; errors appear in archive. */}}}}
module.exports={status,verify,enqueue,campaigns,adGroups,ads,adDetail,performance,hierarchy,purge,tick,runWindow,configStatus,hasRunningSync:()=>running.size>0};
