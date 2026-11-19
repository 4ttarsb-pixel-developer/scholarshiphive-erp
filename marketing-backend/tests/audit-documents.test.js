const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const app=require('../src/app');
const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const currentDate = `${currentMonth}-13`;
const nextDate = new Date(now.getFullYear(),now.getMonth()+1,1);
const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth()+1).padStart(2,'0')}`;
const pastDate = new Date(now.getFullYear(),now.getMonth()-1,1);
const pastMonth = `${pastDate.getFullYear()}-${String(pastDate.getMonth()+1).padStart(2,'0')}`;

let server,base,admin,employee,expenseId;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+QXcAAAAASUVORK5CYII=';
async function request(path,method='GET',body,token=employee){
 const headers=token?{Authorization:`Bearer ${token}`}:{}, options={method,headers};
 if(body!==undefined){headers['Content-Type']='application/json';options.body=JSON.stringify(body)}
 const r=await fetch(base+path,options);
 return {status:r.status,data:await r.json()};
}
before(async()=>{
 server=app.listen(0);await new Promise(ok=>server.once('listening',ok));base=`http://127.0.0.1:${server.address().port}/api/v1`;
 admin=(await request('/auth/login','POST',{email:'admin@mea.test',password:'AdminDemo!2026'},null)).data.data.token;
 employee=(await request('/auth/login','POST',{email:'employee@mea.test',password:'EmployeeDemo!2026'},null)).data.data.token;
 const allocation=await request('/budgets','POST',{month:currentMonth,category:'Printing & Branding',subcategory:'Printing',limit:300000},admin);
 assert.equal(allocation.status,201);
 const currentUser=(await request('/auth/me')).data.data;
 assert.equal((await request('/budgets/employee-allocations','POST',{month:currentMonth,userId:currentUser.id,category:'Printing & Branding',subcategory:'Printing',limit:20000},admin)).status,201);
 const cr=await request('/expenses','POST',{title:'CA audit test entry',category:'Printing & Branding',subcategory:'Printing',amount:300,date:currentDate});
 assert.equal(cr.status,201);expenseId=cr.data.data.id;
});
after(()=>server.close());
test('only the owning employee/Admin can upload and access documents',async()=>{
 assert.equal((await request(`/expenses/${expenseId}/documents`,'GET',undefined,null)).status,401);
 const invalid=await request(`/expenses/${expenseId}/documents`,'POST',{slot:4,name:'invalid.png',mimeType:'image/png',dataBase64:png});
 assert.equal(invalid.status,400);
 assert.equal((await request(`/expenses/${expenseId}/documents`,'POST',{slot:1,name:'evil.exe',mimeType:'image/png',dataBase64:png})).status,415);
 assert.equal((await request(`/expenses/${expenseId}/documents`,'POST',{slot:1,name:'fake.png',mimeType:'image/png',dataBase64:Buffer.from('not png').toString('base64')})).status,415);
 const doc=await request(`/expenses/${expenseId}/documents`,'POST',{slot:1,name:'receipt-1.png',mimeType:'image/png',dataBase64:png});
 assert.equal(doc.status,201);
 assert.equal(doc.data.data.bytes,undefined);
 assert.equal((await request(`/expenses/${expenseId}/submit`,'POST',{})).status,409);
 assert.equal((await request(`/audit/${expenseId}/decision`,'POST',{action:'approve'})).status,403);
 const res=await fetch(base+`/expenses/${expenseId}/documents/1/download`,{headers:{Authorization:`Bearer ${employee}`}});
 assert.equal(res.status,200);assert.equal(res.headers.get('content-disposition').includes('attachment'),true);
 const bytes=Buffer.from(await res.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('base64'),Buffer.from(png,'base64').subarray(0,8).toString('base64'));
});
test('all three documents required for submission and reviewer-only approval',async()=>{
 for(let slot=2;slot<=3;slot++)assert.equal((await request(`/expenses/${expenseId}/documents`,'POST',{slot,name:`receipt-${slot}.png`,mimeType:'image/png',dataBase64:png})).status,201);
 assert.equal((await request(`/expenses/${expenseId}/submit`,'POST',{})).status,200);
 assert.equal((await request(`/expenses/${expenseId}`)).data.data.status,'In Review');
 assert.equal((await request(`/expenses/${expenseId}/documents`,'POST',{slot:1,name:'receipt.png',mimeType:'image/png',dataBase64:png})).status,409);
 assert.equal((await request(`/expenses/${expenseId}`,'PATCH',{amount:5})).status,409);
 assert.equal((await request(`/audit/${expenseId}/decision`,'POST',{action:'reject',note:'no'} ,admin)).status,400);
 assert.equal((await request(`/audit/${expenseId}/decision`,'POST',{action:'approve'},admin)).status,200);
 assert.equal((await request(`/expenses/${expenseId}`)).data.data.status,'Approved');
 const history=await request(`/expenses/${expenseId}/audit-history`);
 assert.ok(history.data.data.some(e=>e.action==='submitted'));
 assert.ok(history.data.data.some(e=>e.action==='approve'));
});
test('Admin can reject submitted expense with mandatory reason',async()=>{
 const exp=await request('/expenses','POST',{title:'Rejected advertising receipt',category:'Printing & Branding',subcategory:'Printing',amount:99,date:currentDate});
 const id=exp.data.data.id;
 for(let slot=1;slot<=3;slot++) assert.equal((await request(`/expenses/${id}/documents`,'POST',{slot,name:`r-${slot}.png`,mimeType:'image/png',dataBase64:png})).status,201);
 assert.equal((await request(`/expenses/${id}/submit`,'POST',{})).status,200);
 const rejected=await request(`/audit/${id}/decision`,'POST',{action:'reject',note:'Unclear vendor receipt'},admin);
 assert.equal(rejected.status,200);assert.equal(rejected.data.data.expense.status,'Rejected');assert.equal(rejected.data.data.event.note,'Unclear vendor receipt');
 assert.equal((await request(`/audit/${id}/decision`,'POST',{action:'approve'},admin)).status,409);
});
