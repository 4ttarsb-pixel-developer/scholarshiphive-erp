const test=require('node:test');
const assert=require('node:assert/strict');
const store=require('../src/data/mock.store');
const service=require('../src/services/attribution.service');
const accountService=require('../src/services/ad-account.service');
const integration=require('../src/services/ad-integration.service');
const admin={id:'attribution-admin-test',name:'Admin Test',role:'Admin',status:'Active'};
const employee={id:'attribution-employee-test',name:'Employee Test',role:'Employee',status:'Active'};
let account,a,b,c;
test('A: empty directory and reporting data are not fabricated',()=>{
 assert.deepEqual(service.report(admin).rows,[]);
 assert.equal(service.report(admin).revenue.records,null);
 assert.deepEqual(service.directory(employee),[]);
});
test('B: Calling counsellor references and campaign mapping are explicit Admin actions',async()=>{
 store.users.push(admin,employee);
 account=await accountService.create({name:'Company Real Reference',platform:'Meta Ads',externalAccountId:'attribution-test-ads-5'},admin);
 a=await service.createCounsellor({externalId:'CALL-10',name:'Counsellor A'},admin);
 b=await service.createCounsellor({externalId:'CALL-20',name:'Counsellor B'},admin);
 c=await service.createCounsellor({externalId:'CALL-30',name:'Counsellor C'},admin);
 assert.equal(service.directory(admin).length,3);
 await assert.rejects(service.createCounsellor({externalId:'CALL-10',name:'Duplicate'},admin),{status:409});
 await assert.rejects(service.createCounsellor({externalId:'CALL-11',name:'Not Allowed'},employee),{status:403});
 assert.equal(service.campaignOverview(account.id,admin).items.length,0);
 await assert.rejects(service.saveMapping(account.id,{campaignId:'camp-2026',campaignLabel:'Italy Scholarship',shares:[{counsellorId:a.id,percent:60},{counsellorId:b.id,percent:35}]},admin),{status:400});
 const mapped=await service.saveMapping(account.id,{campaignId:'camp-2026',campaignLabel:'Italy Scholarship',shares:[{counsellorId:a.id,percent:50},{counsellorId:b.id,percent:50}]},admin);
 assert.equal(mapped.verifiedByApi,false);
 assert.equal(store.expenses.length,0,'Campaign reporting must not create additional financial expenses');
 const report=service.report(admin);
 assert.equal(report.rows.length,2);assert.equal(report.rows[0].attributedSpend,null);
 assert.equal(report.rows[1].attributedSpend,null);
 assert.equal(report.rows[0].percent,50);
 assert.equal(service.campaignOverview(account.id,admin).items[0].mappingStatus,'Confirmed');
});
test('C: assigned employee has read-only scope and restricted Calling directory',async()=>{
 assert.throws(()=>service.campaignOverview(account.id,employee),{status:404});
 await assert.rejects(service.saveMapping(account.id,{campaignId:'test'},employee),{status:403});
 await accountService.assign(account.id,employee.id,admin);
 assert.equal(service.campaignOverview(account.id,employee).items.length,1);
 assert.equal(service.directory(employee).length,2);
 assert.equal(service.report(employee).rows.length,2);
 assert.throws(()=>service.history(account.id,employee),{status:403});
 await assert.rejects(service.removeMapping(account.id,'camp-2026',employee),{status:403});
});
test('D: ad spend split rounds exactly to platform reported cents and never double counts',async()=>{
 const old=integration.hierarchy;
 integration.hierarchy=()=>({source:'live_api',lastSyncedAt:new Date().toISOString(),campaigns:[{id:'camp-2026',name:'Italy Scholarship',status:'ACTIVE',metrics:{spend:0.01,clicks:6,leads:null}}],adGroups:[],ads:[]});
 try {
  await service.saveMapping(account.id,{campaignId:'camp-2026',shares:[{counsellorId:a.id,percent:33.33},{counsellorId:b.id,percent:33.33},{counsellorId:c.id,percent:33.34}]},admin);
  const rows=service.campaignOverview(account.id,admin).items[0].allocation;
  assert.deepEqual(rows.map(x=>x.attributedSpend),[0,0,0.01]);
  assert.equal(rows.reduce((n,x)=>n+x.attributedSpend,0),0.01);
  assert.equal(service.report(admin).rows.length,3);
  assert.equal(store.expenses.length,0);
 } finally {integration.hierarchy=old;}
});
test('E: attribution records audit history, blocks duplicates and deactivation',async()=>{
 await assert.rejects(service.saveMapping(account.id,{campaignId:'camp-2026',shares:[{counsellorId:a.id,percent:50},{counsellorId:a.id,percent:50}]},admin),{status:400});
 assert.ok(service.history(account.id,admin).some(e=>e.action==='mapping_updated'));
 await service.setCounsellorStatus(a.id,'Inactive',admin);
 await assert.rejects(service.saveMapping(account.id,{campaignId:'camp-2026',shares:[{counsellorId:a.id,percent:100}]},admin),{status:400});
 assert.equal((await service.removeMapping(account.id,'camp-2026',admin)).removed,true);
 assert.equal(service.campaignOverview(account.id,admin).items.length,0);
 await accountService.remove(account.id);
});
