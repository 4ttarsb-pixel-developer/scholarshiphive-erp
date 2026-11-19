const test=require('node:test');
const assert=require('node:assert/strict');
const app=require('../src/app');
let server,base,admin,employee,userId;
async function req(path,{method='GET',body,token=admin}={}){
 const headers={};if(token)headers.Authorization=`Bearer ${token}`;if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 return {status:response.status,body:await response.json()};
}
async function waitSync(id){
 for(let i=0;i<80;i++){
  const status=await req(`/ad-integrations/${id}/status`);
  if(!status.body.data.syncInProgress)return status.body.data;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw new Error('sync failed to finish');
}
test.before(async()=>{
 server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));
 base=`http://127.0.0.1:${server.address().port}/api/v1`;
 const a=await req('/auth/login',{method:'POST',body:{email:'admin@mea.test',password:'AdminDemo!2026'},token:null});
 const e=await req('/auth/login',{method:'POST',body:{email:'employee@mea.test',password:'EmployeeDemo!2026'},token:null});
 admin=a.body.data.token;employee=e.body.data.token;userId=e.body.data.user.id;
});
test.after(()=>server.close());
test('Account → Campaign → Ad Group → Ad: accurate hierarchy, filters, new ads and role isolation',async()=>{
 const created=await req('/ad-accounts',{method:'POST',body:{name:'Company Meta',platform:'Meta Ads',externalAccountId:'12345009876'}});
 assert.equal(created.status,201);
 const id=created.body.data.id;
 assert.equal((await req(`/ad-integrations/${id}/ads`,{token:employee})).status,404);
 const original=global.fetch,previous=process.env.META_ACCESS_TOKEN;
 process.env.META_ACCESS_TOKEN='authorized-synthetic-test-token';
 let secondAd=false;
 global.fetch=async(input,options)=>{
  const reportDate=new Date().toISOString().slice(0,10);
  if(String(input).startsWith('https://graph.facebook.com/')){
   assert.equal(options.headers.Authorization,'Bearer authorized-synthetic-test-token');
   const url=new URL(String(input)),path=url.pathname;
   let data;
   if(path.endsWith('/campaigns'))data={data:[{id:'cmp1',name:'Scholarships',status:'ACTIVE'}]};
   else if(path.endsWith('/adsets'))data={data:[{id:'set1',name:'Interest Audience',campaign_id:'cmp1',status:'ACTIVE'}]};
   else if(path.endsWith('/ads'))data={data:[{id:'ad1',name:'Fall Admissions',campaign_id:'cmp1',adset_id:'set1',status:'ACTIVE',effective_status:'ACTIVE'},...(secondAd?[{id:'ad2',name:'Scholarship Retargeting',campaign_id:'cmp1',adset_id:'set1',status:'PAUSED',effective_status:'PAUSED'}]:[])]};
   else if(path.endsWith('/insights')&&url.searchParams.get('level')==='ad')data={data:[{ad_id:'ad1',date_start:reportDate,spend:'25.25',clicks:'12',impressions:'450'},...(secondAd?[{ad_id:'ad2',date_start:reportDate,spend:'4.75',clicks:'3',impressions:'100'}]:[])]};
   else if(path.endsWith('/insights'))data={data:[{date_start:reportDate,spend:'80',clicks:'35',impressions:'1100',account_currency:'PKR'}]};
   else data={id:'act_12345009876',name:'Company Meta Account',currency:'PKR'};
   return {ok:true,status:200,json:async()=>data};
  }
  return original(input,options);
 };
 try{
  assert.equal((await req(`/ad-integrations/${id}/verify`,{method:'POST'})).status,200);
  assert.equal((await req(`/ad-integrations/${id}/refresh`,{method:'POST'})).status,202);
  const first=await waitSync(id);
  assert.equal(first.adCount,1);
  assert.equal(first.newAdsDetected,0);
  const hierarchy=await req(`/ad-integrations/${id}/hierarchy`);
  assert.equal(hierarchy.status,200);
  assert.equal(hierarchy.body.data.campaigns[0].name,'Scholarships');
  assert.equal(hierarchy.body.data.adGroups[0].campaignId,'cmp1');
  assert.equal(hierarchy.body.data.ads[0].metrics.spend,25.25);
  assert.equal(hierarchy.body.data.ads[0].adGroupId,'set1');
  assert.equal((await req(`/ad-integrations/${id}/ads?campaignId=cmp1&adGroupId=set1&status=ACTIVE`)).body.data.items.length,1);
  assert.equal((await req(`/ad-integrations/${id}/ads?campaignId=missing`)).body.data.items.length,0);
  assert.equal((await req(`/ad-integrations/${id}/ads/ad1`)).body.data.ad.name,'Fall Admissions');
  assert.equal((await req(`/ad-integrations/${id}/ads/nope`)).status,404);
  assert.equal((await req(`/ad-integrations/${id}/hierarchy`,{token:employee})).status,404);
  assert.equal((await req(`/ad-accounts/${id}/assignments`,{method:'POST',body:{userId}})).status,201);
  assert.equal((await req(`/ad-integrations/${id}/hierarchy`,{token:employee})).status,200);
  assert.equal((await req(`/ad-integrations/${id}/verify`,{method:'POST',token:employee})).status,403);
  secondAd=true;
  assert.equal((await req(`/ad-integrations/${id}/refresh`,{method:'POST'})).status,202);
  const second=await waitSync(id);
  assert.equal(second.adCount,2);
  assert.equal(second.newAdsDetected,1);
  assert.equal((await req(`/ad-integrations/${id}/ads?status=PAUSED`)).body.data.items[0].name,'Scholarship Retargeting');
  // Parent level amount comes from platform account insights, NOT the sum of ad metrics.
  assert.equal((await req(`/ad-integrations/${id}/performance`)).body.data.metrics.spend,80);
  assert.equal((await req(`/ad-integrations/${id}/hierarchy`)).body.data.campaigns[0].metrics.spend,30);
  assert.equal(JSON.stringify((await req(`/ad-integrations/${id}/hierarchy`)).body).includes('authorized-synthetic-test-token'),false);
 }finally{global.fetch=original;if(previous===undefined)delete process.env.META_ACCESS_TOKEN;else process.env.META_ACCESS_TOKEN=previous;}
});
