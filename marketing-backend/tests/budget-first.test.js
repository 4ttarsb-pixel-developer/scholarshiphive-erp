const test=require('node:test');
const assert=require('node:assert/strict');
const app=require('../src/app');
const now=new Date();
const month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
let server,base,adminToken,employeeToken,employeeId;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+QXcAAAAASUV5CYII='; // test body uses validated 1x1 below
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+QXcAAAAASUVORK5CYII=';
async function req(path,method='GET',body,token=adminToken){
  const headers=token?{Authorization:`Bearer ${token}`}:{},opts={method,headers};
  if(body!==undefined){headers['Content-Type']='application/json';opts.body=JSON.stringify(body)}
  const r=await fetch(base+path,opts);return {status:r.status,data:await r.json()};
}
async function docsAndSubmit(id){
  for(let slot=1;slot<=3;slot++){
    const upload=await req(`/expenses/${id}/documents`,'POST',{slot,name:`proof-${slot}.png`,mimeType:'image/png',dataBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+QXcAAAAASUVORK5CYII='},employeeToken);
    assert.equal(upload.status,201,JSON.stringify(upload.data));
  }
  assert.equal((await req(`/expenses/${id}/submit`,'POST',{},employeeToken)).status,200);
}
test.before(async()=>{
  server=app.listen(0);await new Promise(ok=>server.once('listening',ok));base=`http://127.0.0.1:${server.address().port}/api/v1`;
  adminToken=(await req('/auth/login','POST',{email:'admin@mea.test',password:'AdminDemo!2026'},null)).data.data.token;
  const login=(await req('/auth/login','POST',{email:'employee@mea.test',password:'EmployeeDemo!2026'},null)).data.data;
  employeeToken=login.token;employeeId=login.user.id;
});
test.after(()=>server.close());
test('zero budgets means employees cannot create expenses, and cannot assign budgets',async()=>{
  const initial=await req('/budgets/my?month='+month,'GET',undefined,employeeToken);
  assert.equal(initial.status,200);assert.equal(initial.data.data.items.length,0);
  const exp=await req('/expenses','POST',{title:'No budget expense',category:'Printing & Branding',subcategory:'Printing',amount:100,date:month+'-13'},employeeToken);
  assert.equal(exp.status,409);
  assert.equal((await req('/budgets/employee-allocations','POST',{month,userId:employeeId,category:'Printing & Branding',subcategory:'Printing',limit:100},employeeToken)).status,403);
  assert.equal((await req('/budgets/employee-allocations','GET',undefined,employeeToken)).status,403);
});
test('Admin allocates company group then category-specific employee budget; cannot overallocate',async()=>{
  assert.equal((await req('/budgets/employee-allocations','POST',{month,userId:employeeId,category:'Printing & Branding',subcategory:'Printing',limit:3000})).status,409);
  assert.equal((await req('/budgets','POST',{month,category:'Printing & Branding',subcategory:'Printing',limit:5000})).status,201);
  const allocated=await req('/budgets/employee-allocations','POST',{month,userId:employeeId,category:'Printing & Branding',subcategory:'Printing',limit:3000});
  assert.equal(allocated.status,201);
  assert.equal((await req('/budgets/employee-allocations','POST',{month,userId:employeeId,category:'Printing & Branding',subcategory:'Printing',limit:100})).status,409);
  assert.equal((await req('/budgets/employee-allocations','POST',{month,userId:employeeId,category:'Marketing Tools',subcategory:'ChatGPT',limit:2500})).status,409);
  const mine=(await req('/budgets/my?month='+month,'GET',undefined,employeeToken)).data.data;
  assert.equal(mine.items.length,1);assert.equal(mine.items[0].limit,3000);assert.equal(mine.items[0].availableToCreate,3000);
  assert.equal((await req('/expenses','POST',{title:'Unassigned category',category:'Marketing Tools',subcategory:'ChatGPT',amount:50,date:month+'-13'},employeeToken)).status,409);
  assert.equal((await req('/budgets','PATCH',{limit:100})).status,404);
});
test('Pending expenses reserve balance; edit cap, release on rejection, approved spend tracked',async()=>{
  const create=amount=>req('/expenses','POST',{title:'Category spend request',category:'Printing & Branding',subcategory:'Printing',amount,date:month+'-13'},employeeToken);
  const first=await create(1800);assert.equal(first.status,201);
  assert.equal((await create(1300)).status,409);
  const second=await create(1000);assert.equal(second.status,201);
  let mine=(await req('/budgets/my?month='+month,'GET',undefined,employeeToken)).data.data;
  assert.equal(mine.items[0].pending,2800);assert.equal(mine.items[0].availableToCreate,200);
  assert.equal((await req(`/expenses/${first.data.data.id}`,'PATCH',{amount:2200},employeeToken)).status,409);
  assert.equal((await req('/budgets','PATCH',{limit:100})).status,404);
  const allo=(await req('/budgets/employee-allocations?month='+month)).data.data.items[0];
  assert.equal((await req(`/budgets/employee-allocations/${allo.id}`,'PATCH',{limit:2700})).status,409);
  await docsAndSubmit(second.data.data.id);
  assert.equal((await req(`/audit/${second.data.data.id}/decision`,'POST',{action:'reject',note:'Invalid supporting evidence'})).status,200);
  mine=(await req('/budgets/my?month='+month,'GET',undefined,employeeToken)).data.data;
  assert.equal(mine.items[0].pending,1800);assert.equal(mine.items[0].availableToCreate,1200);
  const third=await create(1200);assert.equal(third.status,201);
  await docsAndSubmit(first.data.data.id);
  assert.equal((await req(`/audit/${first.data.data.id}/decision`,'POST',{action:'approve'})).status,200);
  mine=(await req('/budgets/my?month='+month,'GET',undefined,employeeToken)).data.data;
  assert.equal(mine.items[0].used,1800);assert.equal(mine.items[0].pending,1200);
  assert.equal(mine.items[0].availableToCreate,0);
  assert.equal((await create(1)).status,409);
});
