const test=require('node:test');
const assert=require('node:assert/strict');
const google=require('../src/integrations/google/google.service');
const tiktok=require('../src/integrations/tiktok/tiktok.service');
test('Google adapter maps SearchStream data and micros to currency units',async()=>{
 const old=global.fetch,previous=process.env.GOOGLE_ADS_ACCESS_TOKEN;
 process.env.GOOGLE_ADS_ACCESS_TOKEN='local-test-google-token';
 global.fetch=async(url,opts)=>{
   const reportDate=new Date().toISOString().slice(0,10);
   if(String(url).startsWith('https://googleads.googleapis.com/')){
     assert.equal(opts.headers.Authorization,'Bearer local-test-google-token');
     const {query}=JSON.parse(opts.body);
     const result=query.includes('customer.descriptive_name')?[{results:[{customer:{id:'1234567890',descriptiveName:'Company Google Ads',currencyCode:'PKR'}}]}]:
       query.includes('campaign.status')?[{results:[{campaign:{id:'55',name:'Marketing Campaign',status:'ENABLED'}}]}]:
       [{results:[{segments:{date:reportDate},metrics:{costMicros:'125000000',impressions:'450',clicks:'12',conversions:4}}]}];
     return {ok:true,status:200,json:async()=>result};
   }
   return old(url,opts);
 };
 try{
  const account={externalAccountId:'123-456-7890'};
  assert.equal((await google.verify(account)).currency,'PKR');
  assert.equal((await google.campaigns(account))[0].id,'55');
  const m=await google.performance(account);
  assert.equal(m.daily[0].metrics.spend,125);assert.equal(m.daily[0].metrics.clicks,12);assert.equal(m.daily[0].metrics.leads,null);assert.equal(m.daily[0].metrics.conversions,4);
 }finally{global.fetch=old;if(previous===undefined)delete process.env.GOOGLE_ADS_ACCESS_TOKEN;else process.env.GOOGLE_ADS_ACCESS_TOKEN=previous;}
});
test('TikTok adapter maps authorized advertiser and reports',async()=>{
 const old=global.fetch,previous=process.env.TIKTOK_ACCESS_TOKEN;
 process.env.TIKTOK_ACCESS_TOKEN='local-test-tiktok-token';
 global.fetch=async(url,opts)=>{
  const reportDate=new Date().toISOString().slice(0,10);
  const target=String(url);
  if(target.startsWith('https://business-api.tiktok.com/')){
   assert.equal(opts.headers['Access-Token'],'local-test-tiktok-token');
   const d=target.includes('advertiser/info')?{list:[{advertiser_id:'999887766',name:'Company TikTok',currency:'PKR'}]}:
     target.includes('campaign/get')?{list:[{campaign_id:'42',campaign_name:'New Promotion',operation_status:'ENABLE'}]}:
     {list:[{dimensions:{stat_time_day:reportDate},metrics:{spend:'10.20',impressions:'300',clicks:'20'}},{dimensions:{stat_time_day:reportDate},metrics:{spend:'5.60',impressions:'100',clicks:'7'}}]};
   return {ok:true,status:200,json:async()=>({code:0,data:d})};
  }
  return old(url,opts);
 };
 try{
  const a={externalAccountId:'999887766'};
  assert.equal((await tiktok.verify(a)).externalName,'Company TikTok');
  assert.equal((await tiktok.campaigns(a))[0].name,'New Promotion');
  const m=await tiktok.performance(a);
  assert.equal(Math.round(m.daily.reduce((n,d)=>n+d.metrics.spend,0)*100)/100,15.8);assert.equal(m.daily.reduce((n,d)=>n+d.metrics.impressions,0),400);assert.equal(m.daily[0].metrics.leads,null);
 }finally{global.fetch=old;if(previous===undefined)delete process.env.TIKTOK_ACCESS_TOKEN;else process.env.TIKTOK_ACCESS_TOKEN=previous;}
});
test('Google adapter fetches multiple ad groups and zero-spend ads without inventing performance',async()=>{
 const previous=process.env.GOOGLE_ADS_ACCESS_TOKEN,old=global.fetch;
 process.env.GOOGLE_ADS_ACCESS_TOKEN='synthetic-google-test';
 global.fetch=async(url,options)=>{
  const reportDate=new Date().toISOString().slice(0,10);
  if(String(url).includes('googleads.googleapis.com')){
   const query=JSON.parse(options.body).query;
   let results=[];
   if(query.includes('FROM ad_group WHERE'))results=[{adGroup:{id:'g1',name:'Group A',status:'ENABLED'},campaign:{id:'c1'}}];
   else if(query.includes('FROM ad_group_ad')&&query.includes('metrics.cost_micros'))results=[{adGroupAd:{ad:{id:'ad01'}},segments:{date:reportDate},metrics:{costMicros:'12000000',impressions:'100',clicks:'3',conversions:1}}];
   else if(query.includes('FROM ad_group_ad'))results=[{adGroupAd:{ad:{id:'ad01',name:'Active Ad'},status:'ENABLED'},campaign:{id:'c1'},adGroup:{id:'g1'}},{adGroupAd:{ad:{id:'ad02',name:'No Report Yet'},status:'PAUSED'},campaign:{id:'c1'},adGroup:{id:'g1'}}];
   return {ok:true,status:200,json:async()=>[{results}]};
  }
  return old(url,options);
 };
 try{
  const acc={externalAccountId:'1234567890'};
  const groups=await google.adGroups(acc),ads=await google.ads(acc);
  assert.equal(groups[0].campaignId,'c1');
  assert.equal(ads.length,2);assert.equal(ads[0].daily[0].metrics.spend,12);
  assert.equal(ads[1].metrics,null);assert.equal(ads[1].effectiveStatus,'PAUSED');
 }finally{global.fetch=old;if(previous===undefined)delete process.env.GOOGLE_ADS_ACCESS_TOKEN;else process.env.GOOGLE_ADS_ACCESS_TOKEN=previous;}
});
test('TikTok adapter associates ad IDs and ad group with individual reporting',async()=>{
 const previous=process.env.TIKTOK_ACCESS_TOKEN,old=global.fetch;
 process.env.TIKTOK_ACCESS_TOKEN='synthetic-tiktok-test';
 global.fetch=async(url,opts)=>{
  const reportDate=new Date().toISOString().slice(0,10);
  if(String(url).startsWith('https://business-api.tiktok.com/')){
   const path=String(url);
   let data={list:[]};
   if(path.includes('/adgroup/get/'))data={list:[{adgroup_id:'g1',campaign_id:'c1',adgroup_name:'Audience',operation_status:'ENABLE'}]};
   else if(path.includes('/ad/get/'))data={list:[{ad_id:'a1',ad_name:'TikTok Ad',adgroup_id:'g1',campaign_id:'c1',operation_status:'ENABLE'}]};
   else if(path.includes('/report/integrated/get/'))data={list:[{dimensions:{ad_id:'a1',stat_time_day:reportDate},metrics:{spend:'15.40',clicks:'9',impressions:'140'}}]};
   return {ok:true,status:200,json:async()=>({code:0,data})};
  }
  return old(url,opts);
 };
 try{
  const account={externalAccountId:'99887766'},groups=await tiktok.adGroups(account),ads=await tiktok.ads(account);
  assert.equal(groups[0].id,'g1');assert.equal(ads[0].campaignId,'c1');assert.equal(ads[0].daily[0].metrics.spend,15.4);
 }finally{global.fetch=old;if(previous===undefined)delete process.env.TIKTOK_ACCESS_TOKEN;else process.env.TIKTOK_ACCESS_TOKEN=previous;}
});
