const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const currentDate = `${currentMonth}-13`;
const nextDate = new Date(now.getFullYear(),now.getMonth()+1,1);
const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,'0')}`;
const pastDate = new Date(now.getFullYear(),now.getMonth()-1,1);
const pastMonth = `${pastDate.getFullYear()}-${String(pastDate.getMonth()+1).padStart(2,'0')}`;

let server, base, adminToken, employeeToken;
const request = async (path, method = 'GET', body, token = adminToken) => {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return {status: res.status, json: await res.json()};
};
test.before(async () => {
  server = app.listen(0);
  await new Promise(ok => server.once('listening', ok));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const admin = await request('/auth/login','POST',{email:'admin@mea.test',password:'AdminDemo!2026'},null);
  const employee = await request('/auth/login','POST',{email:'employee@mea.test',password:'EmployeeDemo!2026'},null);
  adminToken=admin.json.data.token; employeeToken=employee.json.data.token;
  const initial=await request('/budgets?month='+currentMonth);
  assert.equal(initial.json.data.items.length,0);
  assert.equal((await request('/budgets','POST',{month:pastMonth,category:'Podcast Marketing',subcategory:'Podcast Sponsorships',limit:2000})).status,409);
  const creative=await request('/budgets','POST',{month:currentMonth,category:'Printing & Branding',subcategory:'Printing',limit:200000});
  assert.equal(creative.status,201);
  const au=(await request('/auth/me')).json.data;
  const eu=(await request('/auth/me','GET',undefined,employeeToken)).json.data;
  for(const user of [au,eu]){
    assert.equal((await request('/budgets/employee-allocations','POST',{month:currentMonth,userId:user.id,category:'Printing & Branding',subcategory:'Printing',limit:50000})).status,201);
  }

});
test.after(() => server.close());

const pngBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+QXcAAAAASUVORK5CYII=';
async function submitWithDocs(id,token=adminToken){
 for(let slot=1;slot<=3;slot++)assert.equal((await request(`/expenses/${id}/documents`,'POST',{slot,name:`receipt-${slot}.png`,mimeType:'image/png',dataBase64:pngBase64},token)).status,201);
 assert.equal((await request(`/expenses/${id}/submit`,'POST',{},token)).status,200);
}
test('expense edit validates fields and respects employee ownership', async () => {
  const body = {title:'Editable event expense',category:'Printing & Branding',subcategory:'Printing',amount:350,date:currentDate,reference:'INV-113',description:'Initial purchase'};
  const created = await request('/expenses','POST',body,employeeToken);
  assert.equal(created.status,201);
  const id = created.json.data.id;
  const edit = await request('/expenses/'+id,'PATCH',{amount:450,reference:'INV-114',description:'Revised quote'},employeeToken);
  assert.equal(edit.status,200);
  assert.equal(edit.json.data.amount,450);
  assert.equal(edit.json.data.reference,'INV-114');
  assert.equal((await request('/expenses/'+id,'PATCH',{amount:-3},employeeToken)).status,400);
  assert.equal((await request('/expenses/'+id,'PATCH',{date:'2027-02-31'},employeeToken)).status,400);
  const others = await request('/expenses','POST',body);
  assert.equal((await request('/expenses/'+others.json.data.id,'PATCH',{title:'Unauthorized edit'},employeeToken)).status,404);
  assert.equal((await request('/expenses/'+others.json.data.id,'DELETE',undefined,employeeToken)).status,404);
});
test('pending expense may be deleted; approved expense may not be altered', async () => {
  const draft = await request('/expenses','POST',{title:'Disposable expense',category:'Printing & Branding',subcategory:'Printing',amount:125,date:currentDate});
  const draftId = draft.json.data.id;
  assert.equal((await request('/expenses/'+draftId,'DELETE')).status,200);
  assert.equal((await request('/expenses/'+draftId)).status,404);
  const approved = await request('/expenses','POST',{title:'Locked approved expense',category:'Printing & Branding',subcategory:'Printing',amount:125,date:currentDate});
  const id = approved.json.data.id;
  await submitWithDocs(id);
  assert.equal((await request('/audit/'+id+'/decision','POST',{action:'approve'})).status,200);
  assert.equal((await request('/expenses/'+id,'PATCH',{amount:1})).status,409);
  assert.equal((await request('/expenses/'+id,'DELETE')).status,409);
});
test('monthly allocation creation and approval cap work without PostgreSQL',async () => {
  const month = nextMonth;
  assert.equal((await request('/budgets','POST',{month:'2027-13',category:'Digital Advertising',subcategory:'Meta Ads',limit:1000})).status,400);
  assert.equal((await request('/budgets','POST',{month,category:'Digital Advertising',subcategory:'Meta Ads',limit:1000},employeeToken)).status,403);
  const add = await request('/budgets','POST',{month,category:'Digital Advertising',subcategory:'Meta Ads',limit:1000});
  assert.equal(add.status,201);
  const budgetId = add.json.data.id;
  assert.equal((await request('/budgets','POST',{month,category:'Digital Advertising',subcategory:'Meta Ads',limit:1000})).status,409);
  const au=(await request('/auth/me')).json.data;
  assert.equal((await request('/budgets/employee-allocations','POST',{month,userId:au.id,category:'Digital Advertising',subcategory:'Meta Ads',limit:1000})).status,201);
  const first = await request('/expenses','POST',{title:'Next month demo ad expense',category:'Digital Advertising',subcategory:'Meta Ads',amount:950,date:`${nextMonth}-10`});
  const second = await request('/expenses','POST',{title:'More demo ad expense',category:'Digital Advertising',subcategory:'Meta Ads',amount:100,date:`${nextMonth}-11`});
  assert.equal(first.status,201);
  assert.equal(second.status,409); // pending 950 reserves the 1000 limit
  const preliminary = await request('/budgets?month='+month);
  assert.equal(preliminary.json.data.items[0].pending,950);
  await submitWithDocs(first.json.data.id);
  assert.equal((await request('/audit/'+first.json.data.id+'/decision','POST',{action:'approve'})).status,200);
  const result = await request('/budgets?month='+month);
  assert.equal(result.json.data.items[0].used,950);
  assert.equal(result.json.data.items[0].remaining,50);
  assert.equal((await request('/budgets/'+budgetId,'PATCH',{limit:500})).status,409);
  assert.equal((await request('/budgets/'+budgetId,'PATCH',{limit:1100})).status,200);
  const allocation=(await request('/budgets/employee-allocations?month='+month)).json.data.items[0];
  assert.equal((await request('/budgets/employee-allocations/'+allocation.id,'PATCH',{limit:1100})).status,200);
  assert.equal((await request('/expenses','POST',{title:'More demo ad expense',category:'Digital Advertising',subcategory:'Meta Ads',amount:100,date:`${nextMonth}-11`})).status,201);
  assert.equal((await request('/budgets?month=bad-month')).status,400);
});
