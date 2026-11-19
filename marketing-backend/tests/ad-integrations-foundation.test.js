const test=require('node:test');
const assert=require('node:assert/strict');
const app=require('../src/app');
let server,base,admin,employee,userId;
async function req(path,{method='GET',body,token=admin}={}){
 const headers={};if(token)headers.Authorization=`Bearer ${token}`;if(body!==undefined)headers['Content-Type']='application/json';
 const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};
}
test.before(async()=>{
 server=app.listen(0);await new Promise(ok=>server.once('listening',ok));base=`http://127.0.0.1:${server.address().port}/api/v1`;
 const a=await req('/auth/login',{method:'POST',body:{email:'admin@mea.test',password:'AdminDemo!2026'},token:null});
 const e=await req('/auth/login',{method:'POST',body:{email:'employee@mea.test',password:'EmployeeDemo!2026'},token:null});
 admin=a.body.data.token;employee=e.body.data.token;userId=e.body.data.user.id;
});
test.after(()=>server.close());
test('Verification requires configured credentials and employee permissions are enforced',async()=>{
 const create=await req('/ad-accounts',{method:'POST',body:{name:'Google Account',platform:'Google Ads',externalAccountId:'1234567890'}});
 assert.equal(create.status,201);const id=create.body.data.id;
 assert.equal((await req(`/ad-integrations/${id}/status`)).body.data.credentialsConfigured,false);
 assert.equal((await req(`/ad-integrations/${id}/verify`,{method:'POST'})).status,409);
 assert.equal((await req(`/ad-integrations/${id}/refresh`,{method:'POST'})).status,409);
 assert.equal((await req(`/ad-integrations/${id}/status`,{token:employee})).status,404);
 assert.equal((await req(`/ad-accounts/${id}/assignments`,{method:'POST',body:{userId}})).status,201);
 assert.equal((await req(`/ad-integrations/${id}/status`,{token:employee})).status,200);
 assert.equal((await req(`/ad-integrations/${id}/verify`,{method:'POST',token:employee})).status,403);
 assert.equal((await req(`/ad-integrations/${id}/campaigns`,{token:employee})).status,200);
 assert.equal((await req(`/ad-integrations/${id}/performance`,{token:employee})).body.data.metrics.metricsAvailable,false);
});
test('Meta adapter verifies and fetches actual-shaped metrics, never leaks token',async()=>{
 const created=await req('/ad-accounts',{method:'POST',body:{platform:'Meta Ads',name:'API Verification',externalAccountId:'9876543210'}});
 assert.equal(created.status,201);const id=created.body.data.id;
 const original=global.fetch,previous=process.env.META_ACCESS_TOKEN;
 process.env.META_ACCESS_TOKEN='only-test-token';
 global.fetch=async(input,opts)=>{
  const reportDate=new Date().toISOString().slice(0,10);
  const url=String(input);
  if(url.startsWith('https://graph.facebook.com/')){
    assert.equal(opts.headers.Authorization,'Bearer only-test-token');
    const result=url.includes('/insights')?{data:[{date_start:reportDate,spend:'432.10',impressions:'1000',clicks:'30',account_currency:'PKR'}]}:
      url.includes('/campaigns')?{data:[{id:'one',name:'Verified Campaign',status:'ACTIVE'}]}:
      {id:'act_9876543210',name:'Verified Company Account',currency:'PKR'};
    return {ok:true,status:200,json:async()=>result};
  }
  return original(input,opts);
 };
 try {
  assert.equal((await req(`/ad-integrations/${id}/verify`,{method:'POST'})).status,200);
  assert.equal((await req(`/ad-integrations/${id}/refresh`,{method:'POST'})).status,202);
  let st;
  for(let i=0;i<30;i++){
    await new Promise(done=>setTimeout(done,20));
    st=await req(`/ad-integrations/${id}/status`);
    if(!st.body.data.syncInProgress)break;
  }
  assert.equal(st.body.data.integrationStatus,'Synced');
  assert.equal(st.body.data.metrics.spend,432.1);
  const campaigns=await req(`/ad-integrations/${id}/campaigns`);
  assert.equal(campaigns.body.data.items[0].name,'Verified Campaign');
  const result=await req(`/ad-integrations/${id}/performance`);
  assert.equal(result.body.data.metrics.clicks,30);
  assert.equal(result.body.data.metrics.leads,null);
  assert.equal(JSON.stringify(result.body).includes('only-test-token'),false);
 } finally { global.fetch=original;if(previous===undefined)delete process.env.META_ACCESS_TOKEN;else process.env.META_ACCESS_TOKEN=previous; }
});
