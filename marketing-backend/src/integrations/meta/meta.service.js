const {parsePeriod}=require('../../utils/report-period');
const {requestJson,checkCredentials,asNumber}=require('../common/request');
const {HttpError}=require('../../utils/http');
const {ad,normalStatus}=require('../common/hierarchy');
// Official Graph endpoints only; never follow arbitrary next-page URLs or user-supplied hosts.
function client(account) {
  const token=checkCredentials(process.env.META_ACCESS_TOKEN,'Meta Ads');
  const id=String(account.externalAccountId||'').replace(/^act_/,'');
  if(!/^\d+$/.test(id))throw new HttpError(400,'Meta account ID must contain digits');
  const version=process.env.META_GRAPH_VERSION || 'v26.0';
  if(!/^v\d+\.\d+$/.test(version))throw new HttpError(500,'Invalid Meta API version');
  return {token,base:`https://graph.facebook.com/${version}/act_${id}`};
}
async function get(account,path,query={}) {
 const {token,base}=client(account);
 const url=new URL(`${base}${path}`);
 Object.entries(query).forEach(([k,v])=>url.searchParams.set(k,String(v)));
 const result=await requestJson(url,{headers:{Authorization:`Bearer ${token}`}});
 if(result.error)throw new HttpError(502,'Meta API returned an error. Check account access and permissions.');
 return result;
}
async function pages(account,path,query={}){
 const list=[];let after;const cursors=new Set();
 for(let page=0;page<100;page++){
  const result=await get(account,path,{...query,limit:100,...(after?{after}:{})});
  list.push(...(result.data||[]));
  if(!result.paging?.next)return list;
  const cursor=result.paging?.cursors?.after;
  if(!cursor||cursors.has(cursor))throw new HttpError(502,'Meta pagination cursor missing or repeated');
  cursors.add(cursor);after=cursor;
 }
 throw new HttpError(502,'Meta account pagination limit reached. Fetch smaller date ranges.');
}
async function verify(account){const d=await get(account,'',{fields:'id,name,account_status,currency'});return {externalName:d.name||account.name,currency:d.currency||null,externalId:d.id||account.externalAccountId,platformStatus:d.account_status??null};}
async function campaigns(account){return (await pages(account,'/campaigns',{fields:'id,name,status,effective_status'})).map(x=>({id:String(x.id),name:x.name||'Unnamed campaign',status:normalStatus(x.effective_status||x.status)}));}
async function adGroups(account){return (await pages(account,'/adsets',{fields:'id,name,campaign_id,status,effective_status'})).map(x=>({id:String(x.id),name:x.name||'Unnamed ad set',campaignId:String(x.campaign_id||''),status:normalStatus(x.effective_status||x.status)}));}
// Meta actions contain different event types for the same outcome. Select ONE
// reporting category, never add aliases together or lead counts may double-count.
function leadCount(actions) {
 if(!Array.isArray(actions)) return null;
 for (const type of ['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead','onsite_conversion.lead']) {
   const row=actions.find(item=>item.action_type===type);
   if(row) return asNumber(row.value);
 }
 return null; // Not tracked/not included: NOT zero.
}
// Daily records are retained independently from current inventory.
// All reporting requests explicitly specify their period (no hardcoded last_7d).
function daysByAd(rows){
 const grouped=new Map();
 for(const r of rows){const id=String(r.ad_id||'');if(!id||!r.date_start)continue;
  if(!grouped.has(id))grouped.set(id,[]);
  grouped.get(id).push({date:r.date_start,metrics:{spend:asNumber(r.spend),impressions:asNumber(r.impressions),clicks:asNumber(r.clicks),leads:leadCount(r.actions),conversions:null}});
 }return grouped;
}
async function ads(account,period=parsePeriod()){
 const [items,insights]=await Promise.all([
  pages(account,'/ads',{fields:'id,name,campaign_id,adset_id,status,effective_status'}),
  pages(account,'/insights',{fields:'ad_id,spend,impressions,clicks,actions,date_start',time_range:JSON.stringify({since:period.startDate,until:period.endDate}),time_increment:1,level:'ad'})
 ]);
 const byId=daysByAd(insights);
 return items.map(x=>{
  const daily=byId.get(String(x.id))||[];
  const metric=daily.length?{spend:Math.round(daily.reduce((sum,d)=>sum+d.metrics.spend,0)*100)/100,impressions:daily.reduce((sum,d)=>sum+d.metrics.impressions,0),clicks:daily.reduce((sum,d)=>sum+d.metrics.clicks,0),leads:daily.some(d=>d.metrics.leads!==null)?daily.reduce((sum,d)=>sum+(d.metrics.leads||0),0):null,conversions:null}:null;
  return {...ad({id:x.id,name:x.name,campaignId:x.campaign_id,adGroupId:x.adset_id,status:x.status,effectiveStatus:x.effective_status,metrics:metric}),daily};
 });
}
async function performance(account,period=parsePeriod()){
 const insights=await pages(account,'/insights',{fields:'spend,impressions,clicks,account_currency,actions,date_start',time_range:JSON.stringify({since:period.startDate,until:period.endDate}),time_increment:1,level:'account'});
 const daily=insights.filter(r=>r.date_start).map(r=>({date:r.date_start,metrics:{spend:asNumber(r.spend),impressions:asNumber(r.impressions),clicks:asNumber(r.clicks),leads:leadCount(r.actions),conversions:null}}));
 return {period,window:period.label,daily,spend:Math.round(daily.reduce((sum,x)=>sum+x.metrics.spend,0)*100)/100,impressions:daily.reduce((sum,x)=>sum+x.metrics.impressions,0),clicks:daily.reduce((sum,x)=>sum+x.metrics.clicks,0),leads:daily.some(x=>x.metrics.leads!==null)?daily.reduce((sum,x)=>sum+(x.metrics.leads||0),0):null,conversions:null,currency:insights[0]?.account_currency||null,source:'Meta Insights daily',metricsAvailable:true};
}
module.exports={verify,campaigns,adGroups,ads,performance,leadCount};
