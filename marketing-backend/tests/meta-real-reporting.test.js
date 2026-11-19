const test=require('node:test');
const assert=require('node:assert/strict');
const meta=require('../src/integrations/meta/meta.service');
const dashboard=require('../src/services/dashboard.service');
test('Meta Insights action aliases are not double-counted',()=>{
 assert.equal(meta.leadCount([{action_type:'lead',value:'7'},{action_type:'offsite_conversion.fb_pixel_lead',value:'7'}]),7);
 assert.equal(meta.leadCount([{action_type:'offsite_conversion.fb_pixel_lead',value:'11'}]),11);
 assert.equal(meta.leadCount([{action_type:'link_click',value:'10'}]),null);
 assert.equal(meta.leadCount(undefined),null);
});
test('Meta adapter maps ad-level spend and leads from authorized Graph responses',async()=>{
 const original=global.fetch,old=process.env.META_ACCESS_TOKEN;
 process.env.META_ACCESS_TOKEN='local-mocked-test-token';
 global.fetch=async (url,opts)=>{
  assert.match(String(url),/^https:\/\/graph.facebook.com\/v26\.0\/act_12345\//);
  assert.equal(opts.headers.Authorization,'Bearer local-mocked-test-token');
  const s=String(url);
  const body=s.includes('/ads?')?{data:[{id:'ad-1',name:'Real-named sample',campaign_id:'camp-1',adset_id:'group-1',status:'ACTIVE'}]}:
             s.includes('/insights?')?{data:[{date_start:new Date().toISOString().slice(0,10),ad_id:'ad-1',spend:'125.50',clicks:'12',impressions:'1000',actions:[{action_type:'lead',value:'3'}]}]}:{data:[]};
  return {ok:true,status:200,json:async()=>body};
 };
 try{
  const items=await meta.ads({externalAccountId:'12345'});
  assert.equal(items.length,1);assert.equal(items[0].metrics.spend,125.5);assert.equal(items[0].metrics.leads,3);
  assert.equal(items[0].campaignId,'camp-1');
 }finally{global.fetch=original;if(old===undefined)delete process.env.META_ACCESS_TOKEN;else process.env.META_ACCESS_TOKEN=old;}
});
test('Dashboard has no fabricated leads or ad spending before live sync',async()=>{
 const summary=await dashboard.summary();
 assert.equal(summary.syncedAccountCount,0);assert.equal(summary.liveLeads,null);
 assert.deepEqual(summary.byCurrency,[]);
});
