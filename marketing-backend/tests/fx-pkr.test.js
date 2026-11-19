process.env.NODE_ENV='test';
const test=require('node:test');
const assert=require('node:assert/strict');
const fx=require('../src/services/fx.service');
const admin={id:'admin-1',role:'Admin'};
const employee={id:'employee-1',role:'Employee'};
function newRate(currency,month,rate,source='Finance-approved monthly management FX'){
 return fx.set({currency,month,rate,source},admin);
}
test('no assumed PKR exchange rate',()=>{
 assert.equal(fx.convertDaily([{date:'2026-08-04',spend:10}],'USD',10).spendPKR,null);
 assert.deepEqual(fx.convertDaily([{date:'2026-08-04',spend:10}],'USD',10).missingRateMonths,['2026-08']);
});
test('monthly rates convert each day in its own month, preserving source',async()=>{
 await newRate('USD','2026-08',275);await newRate('USD','2026-09',280);
 const rows=[{date:'2026-08-31',spend:10},{date:'2026-09-01',spend:5}];
 const r=fx.convertDaily(rows,'USD',15);
 assert.equal(r.spendPKR,4150);assert.equal(r.fxStatus,'converted');
 assert.equal(rows[0].spend,10);
});
test('mixed month cannot be partially included as if complete',()=>{
 const r=fx.convertDaily([{date:'2026-09-10',spend:5},{date:'2026-10-10',spend:8}],'USD',13);
 assert.equal(r.spendPKR,null);assert.deepEqual(r.missingRateMonths,['2026-10']);
});
test('native PKR never changes',()=>{
 assert.equal(fx.convertDaily([],'PKR',1234.56).spendPKR,1234.56);
 assert.equal(fx.convertDaily([],'USD',0).spendPKR,0);
 assert.equal(fx.convertDaily([],'USD',null).spendPKR,null);
});
test('only admin may set an approved rate',async()=>{
 await assert.rejects(fx.set({currency:'USD',month:'2026-10',rate:270,source:'Finance-approved rate'},employee),e=>e.status===403);
 await assert.rejects(fx.set({currency:'USD',month:'2026-13',rate:270,source:'Finance-approved rate'},admin),e=>e.status===400);
 await assert.rejects(fx.set({currency:'USD',month:'2026-10',rate:0,source:'Finance-approved rate'},admin),e=>e.status===400);
});
test('rate updates replace current reference and preserve date/source history',async()=>{
 const a=await newRate('USD','2026-09',279,'Finance updated policy');
 assert.equal(fx.rate('USD','2026-09').rate,279);
 assert.ok(a.updatedBy);assert.ok(a.updatedAt);
 assert.equal(fx.rows().filter(x=>x.currency==='USD'&&x.month==='2026-09').length,1);
});
