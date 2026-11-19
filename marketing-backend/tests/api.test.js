const test=require('node:test');
const assert=require('node:assert/strict');
const app=require('../src/app');
const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const currentDate = `${currentMonth}-13`;
const nextDate = new Date(now.getFullYear(),now.getMonth()+1,1);
const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,'0')}`;
const pastDate = new Date(now.getFullYear(),now.getMonth()-1,1);
const pastMonth = `${pastDate.getFullYear()}-${String(pastDate.getMonth()+1).padStart(2,'0')}`;

let server,base,adminToken,employeeToken,adminUser,employeeUser;
test.before(async()=>{
  server=app.listen(0);
  await new Promise(resolve=>server.once('listening',resolve));
  base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const admin=await req('/auth/login','POST',{email:'admin@mea.test',password:'AdminDemo!2026'},null);
  const employee=await req('/auth/login','POST',{email:'employee@mea.test',password:'EmployeeDemo!2026'},null);
  assert.equal(admin.status,200);assert.equal(employee.status,200);
  adminToken=admin.data.data.token;employeeToken=employee.data.data.token;
  adminUser=admin.data.data.user;employeeUser=employee.data.data.user;
  const initiallyEmpty=await req('/budgets?month='+currentMonth);
  assert.equal(initiallyEmpty.data.data.items.length,0);
  assert.equal((await req('/budgets','POST',{month:pastMonth,category:'Printing & Branding',subcategory:'Printing',limit:500})).status,409);
  assert.equal((await req('/budgets','POST',{month:currentMonth,category:'Printing & Branding',subcategory:'Printing',limit:500000})).status,201);
  assert.equal((await req('/budgets','POST',{month:currentMonth,category:'Podcast Marketing',subcategory:'Podcast Sponsorships',limit:180000})).status,201);
  for(const body of [
    {userId:adminUser.id,month:currentMonth,category:'Printing & Branding',subcategory:'Printing',limit:50000},
    {userId:employeeUser.id,month:currentMonth,category:'Printing & Branding',subcategory:'Printing',limit:50000},
    {userId:adminUser.id,month:currentMonth,category:'Podcast Marketing',subcategory:'Podcast Sponsorships',limit:180000}
  ])assert.equal((await req('/budgets/employee-allocations','POST',body)).status,201);


});
test.after(()=>server.close());
async function req(path,method='GET',body,token=adminToken){
  const headers={};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(token)headers.Authorization='Bearer '+token;
  const res=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,data:await res.json()};
}

const pngBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+QXcAAAAASUVORK5CYII=';
async function submitWithDocs(id,token=adminToken){
  for(let slot=1;slot<=3;slot++){
    const result=await req(`/expenses/${id}/documents`,'POST',{slot,name:`receipt-${slot}.png`,mimeType:'image/png',dataBase64:pngBase64},token);
    assert.equal(result.status,201,JSON.stringify(result.data));
  }
  assert.equal((await req(`/expenses/${id}/submit`,'POST',{},token)).status,200);
}
test('health open; unauthenticated routes forbidden; login validation',async()=>{
  assert.equal((await req('/health','GET',undefined,null)).status,200);
  assert.equal((await req('/expenses','GET',undefined,null)).status,401);
  assert.equal((await req('/users','GET',undefined,null)).status,401);
  assert.equal((await req('/auth/login','POST',{email:'admin@mea.test',password:'wrong'},null)).status,401);
  const me=await req('/auth/me');assert.equal(me.data.data.role,'Admin');
});
test('admin categories CRUD and employee is read-only',async()=>{
  assert.ok((await req('/categories')).data.data.length>=8);
  assert.equal((await req('/categories','POST',{name:'Employee Attempt'},employeeToken)).status,403);
  const c=await req('/categories','POST',{name:'Outdoor Signage'});
  assert.equal(c.status,201);
  assert.equal((await req('/categories','POST',{name:'Outdoor Signage'})).status,409);
});
test('employee creates only owned expenses; cannot forge owner or see others',async()=>{
  const created=await req('/expenses','POST',{title:'Employee marketing expense',category:'Printing & Branding',subcategory:'Printing',amount:1500,date:currentDate,owner:'Hacker'},employeeToken);
  assert.equal(created.status,201);
  const id=created.data.data.id;
  assert.equal(created.data.data.ownerId,employeeUser.id);
  assert.equal(created.data.data.owner,employeeUser.name);
  const other=await req('/expenses','POST',{title:'Admin created expense',category:'Printing & Branding',subcategory:'Printing',amount:900,date:currentDate});
  assert.equal(other.status,201);
  const visible=(await req('/expenses','GET',undefined,employeeToken)).data.data;
  assert.ok(visible.some(x=>x.id===id));
  assert.ok(!visible.some(x=>x.id===other.data.data.id));
  assert.equal((await req('/expenses/'+other.data.data.id,'GET',undefined,employeeToken)).status,404);
  assert.equal((await req('/audit/queue','GET',undefined,employeeToken)).status,403);
  assert.equal((await req('/budgets','GET',undefined,employeeToken)).status,403);
  assert.equal((await req('/budgets/employee-allocations','GET',undefined,employeeToken)).status,403);
  assert.equal((await req('/budgets/'+(await req('/budgets')).data.data.items[0].id,'PATCH',{limit:450000},employeeToken)).status,403);
  const summary=await req('/dashboard/summary','GET',undefined,employeeToken);
  assert.equal(summary.data.data.role,'Employee');assert.equal(summary.data.data.syncedAccountCount,0);
  assert.equal(summary.data.data.adAccountCount,0);
});
test('admin audit approval, budget limits, reports and ad accounts',async()=>{
  const created=await req('/expenses','POST',{title:'Audit marketing test',category:'Printing & Branding',subcategory:'Printing',amount:1500,date:currentDate});
  assert.equal(created.status,201);
  const id=created.data.data.id;
  await submitWithDocs(id);
  const approval=await req('/audit/'+id+'/decision','POST',{action:'approve',reviewer:'Forged'});
  assert.equal(approval.status,200);
  assert.equal(approval.data.data.event.reviewer,adminUser.name);
  const b=await req('/budgets');assert.equal(b.status,200);
  const big=await req('/expenses','POST',{title:'Too expensive podcast',category:'Podcast Marketing',subcategory:'Podcast Sponsorships',amount:180001,date:currentDate});
  assert.equal(big.status,409); // blocked on creation, not after review
  assert.equal((await req('/budgets/my?month='+currentMonth,'GET',undefined,employeeToken)).status,200);
  assert.equal((await req('/reports/overview')).status,200);
  assert.equal((await req('/reports/overview','GET',undefined,employeeToken)).status,403);
  assert.equal((await req('/ad-accounts','GET',undefined,employeeToken)).status,200);
  assert.deepEqual((await req('/ad-accounts','GET',undefined,employeeToken)).data.data,[]);
});
test('admin creates an account, user can log in, deactivate revokes the session',async()=>{
  assert.equal((await req('/users','GET',undefined,employeeToken)).status,403);
  assert.equal((await req('/users','POST',{name:'Test Employee',email:'test@mea.test',role:'Employee',password:'StrongDemo!2026'},employeeToken)).status,403);
  assert.equal((await req('/users','POST',{name:'Bad Employee',email:'bad@mea.test',role:'Employee',password:'short'})).status,400);
  const created=await req('/users','POST',{name:'Test Employee',email:'test@mea.test',role:'Employee',password:'StrongDemo!2026'});
  assert.equal(created.status,201);const id=created.data.data.id;
  assert.equal(created.data.data.password,undefined);
  const newLogin=await req('/auth/login','POST',{email:'test@mea.test',password:'StrongDemo!2026'},null);
  assert.equal(newLogin.status,200);const newToken=newLogin.data.data.token;
  assert.equal((await req('/auth/me','GET',undefined,newToken)).status,200);
  assert.equal((await req('/users/'+id+'/status','PATCH',{status:'Inactive'})).status,200);
  assert.equal((await req('/auth/me','GET',undefined,newToken)).status,401);
  assert.equal((await req('/auth/login','POST',{email:'test@mea.test',password:'StrongDemo!2026'},null)).status,401);
  assert.equal((await req('/users/'+id+'/status','PATCH',{status:'Active'})).status,200);
  assert.equal((await req('/auth/login','POST',{email:'test@mea.test',password:'StrongDemo!2026'},null)).status,200);
  assert.equal((await req('/users/'+adminUser.id+'/status','PATCH',{status:'Inactive'})).status,409);
});
test('logout invalidates session',async()=>{
  const l=await req('/auth/login','POST',{email:'employee@mea.test',password:'EmployeeDemo!2026'},null);
  const t=l.data.data.token;
  assert.equal((await req('/auth/logout','POST',undefined,t)).status,200);
  assert.equal((await req('/auth/me','GET',undefined,t)).status,401);
});
