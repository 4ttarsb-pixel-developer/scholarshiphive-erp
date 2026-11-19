const test=require('node:test');
const assert=require('node:assert/strict');
const meta=require('../src/integrations/meta/meta.service');
test('Meta period request uses explicit date ranges and date_increment=1',async()=>{
 const prev=global.fetch,token=process.env.META_ACCESS_TOKEN;
 process.env.META_ACCESS_TOKEN='test-only-token';let sawInsight=false;
 global.fetch=async(url,opts)=>{
  const u=new URL(String(url));assert.equal(u.hostname,'graph.facebook.com');
  assert.equal(opts.headers.Authorization,'Bearer test-only-token');
  if(u.pathname.endsWith('/ads'))return {ok:true,status:200,json:async()=>({data:[{id:'ad1',name:'Historical Meta Ad',campaign_id:'c1',adset_id:'g1',status:'ARCHIVED',effective_status:'ARCHIVED'}]})};
  if(u.pathname.endsWith('/insights')){
   sawInsight=true;assert.equal(u.searchParams.get('time_increment'),'1');
   assert.deepEqual(JSON.parse(u.searchParams.get('time_range')),{since:'2026-09-01',until:'2026-09-30'});
   if(u.searchParams.get('level')==='ad')return {ok:true,status:200,json:async()=>({data:[{ad_id:'ad1',date_start:'2026-09-05',spend:'67.34',impressions:'30',clicks:'6',actions:[{action_type:'lead',value:'1'}]}]})};
   return {ok:true,status:200,json:async()=>({data:[{date_start:'2026-09-05',spend:'67.34',impressions:'30',clicks:'6',actions:[{action_type:'lead',value:'1'}]}]})};
  }
  throw new Error(`Unexpected API ${u.pathname}`);
 };
 try{
  const p={startDate:'2026-09-01',endDate:'2026-09-30'};
  const a={externalAccountId:'12345'};
  const ads=await meta.ads(a,p),report=await meta.performance(a,p);
  assert.equal(ads.length,1);assert.equal(ads[0].effectiveStatus,'ARCHIVED');
  assert.equal(ads[0].daily[0].metrics.spend,67.34);
  assert.equal(ads[0].daily[0].metrics.leads,1);
  assert.equal(report.daily[0].date,'2026-09-05');assert.equal(sawInsight,true);
 }finally{global.fetch=prev; if(token===undefined)delete process.env.META_ACCESS_TOKEN;else process.env.META_ACCESS_TOKEN=token;}
});
