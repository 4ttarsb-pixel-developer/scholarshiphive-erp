const {parsePeriod}=require('../../utils/report-period');
const {requestJson,checkCredentials,asNumber}=require('../common/request');
const {HttpError}=require('../../utils/http');
const {ad,normalStatus}=require('../common/hierarchy');
const VERSION=process.env.GOOGLE_ADS_API_VERSION||'v26';
async function googleToken(){
 if(process.env.GOOGLE_ADS_ACCESS_TOKEN)return checkCredentials(process.env.GOOGLE_ADS_ACCESS_TOKEN,'Google Ads');
 const id=checkCredentials(process.env.GOOGLE_CLIENT_ID,'Google Ads OAuth client ID');
 const secret=checkCredentials(process.env.GOOGLE_CLIENT_SECRET,'Google Ads OAuth client secret');
 const refresh=checkCredentials(process.env.GOOGLE_REFRESH_TOKEN,'Google Ads OAuth refresh token');
 const body=new URLSearchParams({client_id:id,client_secret:secret,refresh_token:refresh,grant_type:'refresh_token'});
 const data=await requestJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
 return checkCredentials(data.access_token,'Google Ads access token');
}
async function search(account,query){
 const customer=String(account.externalAccountId||'').replaceAll('-','');
 if(!/^\d{5,20}$/.test(customer))throw new HttpError(400,'Google customer ID must contain digits');
 const token=await googleToken();
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 if(process.env.GOOGLE_LOGIN_CUSTOMER_ID)headers['login-customer-id']=process.env.GOOGLE_LOGIN_CUSTOMER_ID.replaceAll('-','');
 const d=await requestJson(`https://googleads.googleapis.com/${VERSION}/customers/${customer}/googleAds:searchStream`,{method:'POST',headers,body:JSON.stringify({query})});
 if(!Array.isArray(d))throw new HttpError(502,'Google Ads returned an unexpected reporting response');
 return d.flatMap(batch=>batch.results||[]);
}
async function verify(a){const list=await search(a,'SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1');const c=list[0]?.customer;if(!c)throw new HttpError(502,'Google Ads customer could not be verified');return {externalName:c.descriptiveName||a.name,currency:c.currencyCode||null,externalId:String(c.id||a.externalAccountId)};}
async function campaigns(a){return (await search(a,'SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.status != REMOVED')).map(r=>({id:String(r.campaign?.id),name:r.campaign?.name||'Unnamed campaign',status:normalStatus(r.campaign?.status)})).filter(x=>x.id!=='undefined');}
async function adGroups(a){return (await search(a,'SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != REMOVED')).map(r=>({id:String(r.adGroup?.id),name:r.adGroup?.name||'Unnamed ad group',status:normalStatus(r.adGroup?.status),campaignId:String(r.campaign?.id||'')})).filter(x=>x.id!=='undefined');}
function dateSQL(p){return `segments.date BETWEEN '${p.startDate}' AND '${p.endDate}'`;}
async function ads(a,period=parsePeriod()){
 const inventoryQuery=`SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status, ad_group.id, campaign.id FROM ad_group_ad WHERE ad_group_ad.status != REMOVED`;
 const reportQuery=`SELECT ad_group_ad.ad.id, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE ${dateSQL(period)}`;
 const [items,report]=await Promise.all([search(a,inventoryQuery),search(a,reportQuery)]);
 const byId=new Map();
 for(const r of report){const id=String(r.adGroupAd?.ad?.id||'');if(!id||!r.segments?.date)continue;
  if(!byId.has(id))byId.set(id,[]);const m=r.metrics||{};
  byId.get(id).push({date:r.segments.date,metrics:{spend:Math.round(asNumber(m.costMicros)/10000)/100,impressions:asNumber(m.impressions),clicks:asNumber(m.clicks),leads:null,conversions:asNumber(m.conversions)}});
 }
 return items.filter(r=>r.adGroupAd?.ad?.id!==undefined).map(r=>{
  const item=r.adGroupAd,daily=byId.get(String(item.ad.id))||[];
  return {...ad({id:item.ad.id,name:item.ad.name||`Ad ${item.ad.id}`,status:item.status,campaignId:r.campaign?.id,adGroupId:r.adGroup?.id}),daily};
 });
}
async function performance(a,period=parsePeriod()){
 const rows=await search(a,`SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE ${dateSQL(period)}`);
 const daily=rows.filter(x=>x.segments?.date).map(r=>({date:r.segments.date,metrics:{spend:Math.round(asNumber(r.metrics?.costMicros)/10000)/100,impressions:asNumber(r.metrics?.impressions),clicks:asNumber(r.metrics?.clicks),conversions:asNumber(r.metrics?.conversions),leads:null}}));
 return {window:period.label,period,daily,currency:null,source:'Google Ads daily metrics',metricsAvailable:true};
}
module.exports={verify,campaigns,adGroups,ads,performance};
