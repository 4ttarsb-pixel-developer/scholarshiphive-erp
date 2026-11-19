const test=require('node:test');
const assert=require('node:assert/strict');
const app=require('../src/app');
let server,base,adminToken,employeeToken,employeeUser;
async function request(path,{method='GET',body,token=adminToken}={}){
  const headers={};
  if(token)headers.Authorization=`Bearer ${token}`;
  if(body!==undefined)headers['Content-Type']='application/json';
  const r=await fetch(`${base}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
}
test.before(async()=>{
  server=app.listen(0);
  await new Promise(r=>server.once('listening',r));
  base=`http://127.0.0.1:${server.address().port}/api/v1`;
  let a=await request('/auth/login',{method:'POST',body:{email:'admin@mea.test',password:'AdminDemo!2026'},token:null});
  let e=await request('/auth/login',{method:'POST',body:{email:'employee@mea.test',password:'EmployeeDemo!2026'},token:null});
  assert.equal(a.status,200);assert.equal(e.status,200);
  adminToken=a.body.data.token;employeeToken=e.body.data.token;employeeUser=e.body.data.user;
});
test.after(()=>server.close());
test('Employee sees only assigned accounts and has no management rights',async()=>{
  const admin=await request('/ad-accounts');
  assert.equal(admin.status,200);
  assert.equal(admin.body.data.length,0); // No seeded demo ad accounts
  const first=await request('/ad-accounts',{method:'POST',body:{platform:'Meta Ads',name:'Team Meta Reference'}});
  const other=await request('/ad-accounts',{method:'POST',body:{platform:'Google Ads',name:'Other Google Reference'}});
  assert.equal(first.status,201);assert.equal(other.status,201);
  const target=first.body.data;
  assert.deepEqual((await request('/ad-accounts',{token:employeeToken})).body.data,[]);
  assert.equal((await request('/ad-accounts/'+target.id,{token:employeeToken})).status,404);
  assert.equal((await request('/ad-accounts',{method:'POST',body:{platform:'Meta Ads',name:'Unauthorized'},token:employeeToken})).status,403);
  assert.equal((await request('/ad-accounts/'+target.id,{method:'PATCH',body:{name:'Wrong'},token:employeeToken})).status,403);
  assert.equal((await request('/ad-accounts/'+target.id,{method:'DELETE',token:employeeToken})).status,403);
  assert.equal((await request('/ad-accounts/'+target.id+'/assignments',{method:'POST',body:{userId:employeeUser.id},token:employeeToken})).status,403);
  assert.equal((await request('/ad-accounts/'+target.id+'/assignments/'+employeeUser.id,{method:'DELETE',token:employeeToken})).status,403);
  assert.equal((await request('/ad-accounts',{token:null})).status,401);
  assert.equal((await request('/ad-accounts/'+target.id+'/assignments',{method:'POST',body:{userId:employeeUser.id}})).status,201);
  assert.equal((await request('/ad-accounts/'+target.id+'/assignments',{method:'POST',body:{userId:employeeUser.id}})).status,409);
  const visible=await request('/ad-accounts',{token:employeeToken});
  assert.equal(visible.body.data.length,1);
  assert.equal(visible.body.data[0].id,target.id);
  assert.equal(visible.body.data[0].access,'read-only');
  assert.equal(visible.body.data[0].assignedEmployees,undefined);
  assert.equal((await request('/ad-accounts/'+target.id,{token:employeeToken})).status,200);
  assert.equal((await request('/ad-accounts/'+other.body.data.id,{token:employeeToken})).status,404);
  assert.equal((await request('/ad-accounts/'+target.id+'/assignments/'+employeeUser.id,{method:'DELETE'})).status,200);
  assert.deepEqual((await request('/ad-accounts',{token:employeeToken})).body.data,[]);
});
test('Admin can register, rename, assign and remove demo accounts',async()=>{
  const created=await request('/ad-accounts',{method:'POST',body:{platform:'TikTok Ads',name:'New TikTok Demo',externalAccountId:'test-demo-abc'}});
  assert.equal(created.status,201);
  const id=created.body.data.id;
  assert.equal((await request('/ad-accounts',{method:'POST',body:{platform:'TikTok Ads',name:'Duplicated',externalAccountId:'test-demo-abc'}})).status,409);
  assert.equal((await request('/ad-accounts',{method:'POST',body:{platform:'Not Supported',name:'Invalid'}})).status,400);
  assert.equal((await request('/ad-accounts/'+id,{method:'PATCH',body:{name:'Renamed Demo'}})).body.data.name,'Renamed Demo');
  const newEmployee=await request('/users',{method:'POST',body:{name:'Access Test',email:'access-test@mea.test',role:'Employee',password:'StrongPassDemo!2026'}});
  assert.equal(newEmployee.status,201);
  const uid=newEmployee.body.data.id;
  assert.equal((await request('/ad-accounts/'+id+'/assignments',{method:'POST',body:{userId:uid}})).status,201);
  const acc=(await request('/ad-accounts/'+id)).body.data;
  assert.equal(acc.assignedEmployees[0].userId,uid);
  assert.equal((await request('/users/'+uid+'/status',{method:'PATCH',body:{status:'Inactive'}})).status,200);
  const login=await request('/auth/login',{method:'POST',body:{email:'access-test@mea.test',password:'StrongPassDemo!2026'},token:null});
  assert.equal(login.status,401);
  assert.equal((await request('/ad-accounts/'+id+'/assignments',{method:'POST',body:{userId:uid}})).status,400);
  assert.equal((await request('/ad-accounts/'+id,{method:'DELETE'})).status,200);
  assert.equal((await request('/ad-accounts/'+id)).status,404);
});
