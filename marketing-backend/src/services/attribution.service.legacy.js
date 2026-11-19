// Counsellor attribution is NOT an expense entry and MUST NOT increase marketing spend.
// Account/campaign IDs are the stable join key. Calling and Revenue teams own their respective source systems.
const {randomUUID}=require('node:crypto');
const store=require('../data/mock.store');
const {HttpError,requiredText}=require('../utils/http');
const adAccounts=require('./ad-account.service');
const adIntegrations=require('./ad-integration.service');
const attributionStore=require('./attribution-store');
const PG=attributionStore.IS_PG;
const norm=v=>String(v||'').trim();
const phoneDigits=v=>String(v||'').replace(/\D/g,'');
function counsellorById(id){return store.counsellors.find(c=>c.id===id);}
function directory(user){
 if(!user)throw new HttpError(401,'Login required');
 const allowed=user.role==='Admin'?null:new Set(store.campaignAllocations.filter(m=>store.adAccountAssignments.some(a=>a.accountId===m.accountId&&a.userId===user.id&&user.status==='Active')).flatMap(m=>m.shares.map(s=>s.counsellorId)));
 return store.counsellors.filter(c=>!allowed||allowed.has(c.id)).map(({id,displayNumber,externalId,name,department,status,source})=>({id,displayNumber,externalId,name,department,status,source}));
}
async function createCounsellor(body,admin){
 if(admin?.role!=='Admin')throw new HttpError(403,'Admin access required');
 const externalId=requiredText(body?.externalId,'Calling counsellor ID',80),name=requiredText(body?.name,'Counsellor name',120);
 if(store.counsellors.some(c=>c.externalId.toLowerCase()===externalId.toLowerCase()))throw new HttpError(409,'Counsellor ID already exists');
 const department=norm(body?.department||'Calling');
 const workContactNumber=norm(body?.workContactNumber||'');
 if(workContactNumber && !/^[+0-9 ()-]{7,25}$/.test(workContactNumber))throw new HttpError(400,'Work contact number must be a valid short telephone reference');
 if(department.length>100)throw new HttpError(400,'Department must be shorter than 100 characters');
 const c={id:randomUUID(),externalId,name,department,workContactNumber,status:'Active',source:'manual_pending_calling_sync',createdBy:admin.id,createdAt:new Date().toISOString()};
 const event={id:randomUUID(),action:'counsellor_registered',counsellorId:c.id,actorId:admin.id,at:new Date().toISOString()};
 if(PG)await attributionStore.insertCounsellor(c,event);
 store.counsellors.push(c);
 store.attributionEvents.push(event);
 return c;
}
async function setCounsellorStatus(id,status,admin){
 if(admin?.role!=='Admin')throw new HttpError(403,'Admin access required');
 const c=counsellorById(id);if(!c)throw new HttpError(404,'Counsellor not found');
 if(!['Active','Inactive'].includes(status))throw new HttpError(400,'Invalid counsellor status');
 const event={id:randomUUID(),action:'counsellor_status_changed',counsellorId:id,actorId:admin.id,at:new Date().toISOString(),status};
 if(PG)await attributionStore.updateCounsellorStatus(id,status,event);
 c.status=status;
 store.attributionEvents.push(event);return c;
}
function key(accountId,campaignId){return `${accountId}::${campaignId}`;}
function findMapping(accountId,campaignId){return store.campaignAllocations.find(m=>m.accountId===accountId&&m.campaignId===campaignId);}
function knownCampaign(accountId,campaignId,user){
 const tree=adIntegrations.hierarchy(accountId,user);
 return tree.campaigns.find(c=>c.id===campaignId)||null;
}
function suggest(name,number){
 // Human-reviewed hints only: whole-word name matching; never silently allocate or auto-confirm.
 const safe=String(name||'').toLowerCase();
 return store.counsellors.filter(c=>c.status==='Active'&&(new RegExp('(^|[^a-z])'+c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z]|$)').test(safe)||(number&&phoneDigits(c.workContactNumber)&&phoneDigits(c.workContactNumber)===phoneDigits(number)))).map(c=>({id:c.id,externalId:c.externalId,name:c.name}));
}
function splitCents(amount,shares){
 if(amount==null)return shares.map(()=>null);
 const totalCents=Math.round(Number(amount)*100);
 const calculations=shares.map((s,i)=>({i,exact:totalCents*s.basisPoints/10000}));
 const cents=calculations.map(s=>Math.floor(s.exact));
 let remainder=totalCents-cents.reduce((a,b)=>a+b,0);
 calculations.sort((a,b)=>(b.exact-Math.floor(b.exact))-(a.exact-Math.floor(a.exact))||a.i-b.i);
 for(let i=0;i<remainder;i++)cents[calculations[i].i]++;
 return cents.map(c=>c/100);
}
function campaignOverview(accountId,user,period={}){
 const a=adAccounts.get(accountId,user);
 const data=adIntegrations.hierarchy(accountId,user,period);
 const live=data.source==='live_api';
 // Add mapping references even before credentials arrive. These are clearly NOT verified live campaigns.
 const names=new Set(data.campaigns.map(x=>x.id));
 const refs=store.campaignAllocations.filter(m=>m.accountId===accountId&&!names.has(m.campaignId)).map(m=>({id:m.campaignId,name:m.campaignLabel,status:'Unverified reference',metrics:null}));
 const items=[...data.campaigns,...refs].map(c=>{
  const m=findMapping(accountId,c.id);
  const metrics=live&&names.has(c.id)?c.metrics:null;
  const split=m?splitCents(metrics?.spend??null,m.shares):[];
  const splitPKR=m?splitCents(metrics?.spendPKR??null,m.shares):[];
  const allocation=m?m.shares.map((s,i)=>({counsellorId:s.counsellorId,externalCounsellorId:counsellorById(s.counsellorId)?.externalId||null,counsellorName:counsellorById(s.counsellorId)?.name||'Unknown',percent:s.basisPoints/100,attributedSpend:split[i],attributedSpendPKR:splitPKR[i]})):[];
  return {accountId,campaignId:c.id,campaignName:c.name,campaignTrackingNumber:m?.campaignTrackingNumber||'',status:c.status,verifiedByApi:live&&names.has(c.id),mappingStatus:m?'Confirmed':'Unassigned',allocation,spend:metrics?.spend??null,spendPKR:metrics?.spendPKR??null,clicks:metrics?.clicks??null,leads:metrics?.leads??null,spendWindow:live?data.window:null,currency:a.currency||null,possibleCounsellors:suggest(c.name,m?.campaignTrackingNumber),mappedAt:m?.updatedAt||null};
 });
 return {accountId,accountName:a.name,platform:a.platform,source:data.source,lastSyncedAt:data.lastSyncedAt,items,unassigned:items.filter(c=>c.mappingStatus==='Unassigned').length,currency:a.currency||null};
}
async function saveMapping(accountId,body,admin){
 if(admin?.role!=='Admin')throw new HttpError(403,'Admin access required');
 const a=adAccounts.get(accountId,admin);
 const campaignId=requiredText(body?.campaignId,'Campaign ID',120);
 const live=knownCampaign(accountId,campaignId,admin);
 const suppliedName=body?.campaignLabel===undefined?'':norm(body.campaignLabel);
 if(suppliedName.length>200)throw new HttpError(400,'Campaign name too long');
 if(!live&&!suppliedName)throw new HttpError(400,'For an unsynced campaign, provide its name as a reference');
 const shares=body?.shares;
 if(!Array.isArray(shares)||shares.length<1||shares.length>30)throw new HttpError(400,'Select 1 to 30 counsellors');
 const ids=new Set();let total=0;
 const parsed=shares.map(s=>{
  const counsellorId=norm(s.counsellorId),c=counsellorById(counsellorId);
  if(!c||c.status!=='Active')throw new HttpError(400,'Choose active counsellors from Calling directory');
  if(ids.has(c.id))throw new HttpError(400,'Duplicate counsellor is not allowed');ids.add(c.id);
  const percent=Number(s.percent);
  if(typeof s.percent!=='number'||!Number.isFinite(percent)||percent<=0||Math.abs(percent*100-Math.round(percent*100))>1e-6)throw new HttpError(400,'Each percentage must be greater than zero with at most 2 decimal places');
  const basisPoints=Math.round(percent*100);total+=basisPoints;
  return {counsellorId:c.id,basisPoints};
 });
 if(total!==10000)throw new HttpError(400,'Counsellor allocation percentages must total exactly 100%');
 const label=live?.name||suppliedName;
 const campaignTrackingNumber=norm(body?.campaignTrackingNumber||'');
 if(campaignTrackingNumber && !/^[+0-9 ()-]{7,25}$/.test(campaignTrackingNumber))throw new HttpError(400,'Campaign tracking number format is invalid');
 const previous=findMapping(accountId,campaignId);
 const now=new Date().toISOString();
 const next={id:previous?.id||randomUUID(),accountId,campaignId,campaignLabel:label,campaignTrackingNumber,shares:parsed,createdAt:previous?.createdAt||now,updatedAt:now,updatedBy:admin.id};
 const event={id:randomUUID(),action:previous?'mapping_updated':'mapping_confirmed',accountId,campaignId,accountName:a.name,actorId:admin.id,at:now,previousShares:previous?structuredClone(previous.shares):null,newShares:structuredClone(parsed)};
 if(PG)await attributionStore.saveMapping(next,event);
 if(previous)store.campaignAllocations.splice(store.campaignAllocations.indexOf(previous),1,next);else store.campaignAllocations.push(next);
 store.attributionEvents.push(event);
 return { ...next,verifiedByApi:Boolean(live),note:'Allocation is reporting attribution only; no additional financial expense created.'};
}
async function removeMapping(accountId,campaignId,admin){if(admin?.role!=='Admin')throw new HttpError(403,'Admin access required');adAccounts.get(accountId,admin);const row=findMapping(accountId,campaignId);if(!row)throw new HttpError(404,'Campaign mapping not found');const event={id:randomUUID(),action:'mapping_removed',accountId,campaignId,actorId:admin.id,at:new Date().toISOString(),previousShares:structuredClone(row.shares)};if(PG)await attributionStore.removeMapping(accountId,campaignId,event);store.campaignAllocations.splice(store.campaignAllocations.indexOf(row),1);store.attributionEvents.push(event);return {removed:true};}
function history(accountId,user){adAccounts.get(accountId,user);if(user.role!=='Admin')throw new HttpError(403,'Audit history is Admin-only');return store.attributionEvents.filter(e=>e.accountId===accountId).slice().reverse();}
function report(user,period={}){
 const accounts=adAccounts.all(user);
 const rows=accounts.flatMap(a=>campaignOverview(a.id,user,period).items.flatMap(c=>c.allocation.map(s=>({platform:a.platform,accountId:a.id,accountName:a.name,campaignId:c.campaignId,campaignName:c.campaignName,counsellorId:s.counsellorId,externalCounsellorId:s.externalCounsellorId,counsellorName:s.counsellorName,percent:s.percent,attributedSpend:s.attributedSpend,attributedSpendPKR:s.attributedSpendPKR,reportedSpend:c.spend,reportedSpendPKR:c.spendPKR,currency:c.currency,spendWindow:c.spendWindow,verifiedByApi:c.verifiedByApi}))));
 return {rows,source:'Attribution allocations — not additional marketing expense',revenue:{connected:false,source:'Revenue Department',status:'Pending Revenue Team API / central DB integration',records:null},calling:{connected:false,source:'Calling Department',status:'Local reference directory until Calling Team sync'},notice:'Only confirmed counsellor mappings appear. Campaign spend is null if platform metrics are unavailable. Do not sum campaign and attributed spend together.'};
}
module.exports={directory,createCounsellor,setCounsellorStatus,campaignOverview,saveMapping,removeMapping,history,report};
