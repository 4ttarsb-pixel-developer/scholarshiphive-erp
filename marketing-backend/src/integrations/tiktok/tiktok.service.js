const {parsePeriod}=require('../../utils/report-period');
const {requestJson,checkCredentials,asNumber}=require('../common/request');
const {HttpError}=require('../../utils/http');
const {ad,normalStatus}=require('../common/hierarchy');
function idOf(account){const id=String(account.externalAccountId||'');if(!/^\d{5,30}$/.test(id))throw new HttpError(400,'TikTok advertiser ID must contain digits');return id;}
async function get(path,params){const token=checkCredentials(process.env.TIKTOK_ACCESS_TOKEN,'TikTok Ads');const url=new URL('https://business-api.tiktok.com/open_api/v1.3/'+path);Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,typeof v==='string'?v:JSON.stringify(v)));const d=await requestJson(url,{headers:{'Access-Token':token,Accept:'application/json'}});if(d.code!==undefined && d.code!==0)throw new HttpError(502,'TikTok API rejected the request. Check advertiser access and reporting permissions.');return d.data||{};}
async function getAll(a,path,params){const rows=[];for(let page=1;page<=25;page++){const d=await get(path,{...params,page,page_size:100});const list=d.list||[];rows.push(...list);const totalPages=Number(d.page_info?.total_page||d.pageInfo?.totalPage||0);if((totalPages&&page>=totalPages)||(!totalPages&&list.length<100))return rows;}throw new HttpError(502,'TikTok view exceeds current pagination safety limit');}
async function verify(a){const d=await get('advertiser/info/',{advertiser_ids:[idOf(a)]});const advertiser=d.list?.find(x=>String(x.advertiser_id)===idOf(a));if(!advertiser)throw new HttpError(502,'TikTok advertiser could not be verified');return {externalName:advertiser.name||a.name,currency:advertiser.currency||null,externalId:idOf(a)};}
async function campaigns(a){return (await getAll(a,'campaign/get/',{advertiser_id:idOf(a)})).filter(c=>c.campaign_id!==undefined).map(c=>({id:String(c.campaign_id),name:c.campaign_name||'Unnamed campaign',status:normalStatus(c.operation_status)}));}
async function adGroups(a){return (await getAll(a,'adgroup/get/',{advertiser_id:idOf(a)})).filter(g=>g.adgroup_id!==undefined).map(g=>({id:String(g.adgroup_id),name:g.adgroup_name||'Unnamed ad group',campaignId:String(g.campaign_id||''),status:normalStatus(g.operation_status)}));}
async function ads(a,period=parsePeriod()){
 const advertiser_id=idOf(a);
 const [items,reports]=await Promise.all([
  getAll(a,'ad/get/',{advertiser_id}),
  getAll(a,'report/integrated/get/',{advertiser_id,report_type:'BASIC',data_level:'AUCTION_AD',dimensions:['ad_id','stat_time_day'],metrics:['spend','impressions','clicks'],start_date:period.startDate,end_date:period.endDate})
 ]);
 const byId=new Map();
 for(const r of reports){const id=String(r.dimensions?.ad_id||r.ad_id||'');const date=String(r.dimensions?.stat_time_day||'').slice(0,10);if(!id||!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
  if(!byId.has(id))byId.set(id,[]);const m=r.metrics||{};byId.get(id).push({date,metrics:{spend:asNumber(m.spend),impressions:asNumber(m.impressions),clicks:asNumber(m.clicks),leads:null,conversions:null}});
 }
 return items.filter(x=>x.ad_id!==undefined).map(x=>({...ad({id:x.ad_id,name:x.ad_name,status:x.operation_status,campaignId:x.campaign_id,adGroupId:x.adgroup_id}),daily:byId.get(String(x.ad_id))||[]}));
}
async function performance(a,period=parsePeriod()){
 const rows=await getAll(a,'report/integrated/get/',{advertiser_id:idOf(a),report_type:'BASIC',data_level:'AUCTION_ADVERTISER',dimensions:['stat_time_day'],metrics:['spend','impressions','clicks'],start_date:period.startDate,end_date:period.endDate});
 const daily=rows.map(r=>({date:String(r.dimensions?.stat_time_day||'').slice(0,10),metrics:{spend:asNumber(r.metrics?.spend),impressions:asNumber(r.metrics?.impressions),clicks:asNumber(r.metrics?.clicks),leads:null,conversions:null}})).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date));
 return {window:period.label,period,daily,currency:null,source:'TikTok daily integrated reporting',metricsAvailable:true};
}
module.exports={verify,campaigns,adGroups,ads,performance};
