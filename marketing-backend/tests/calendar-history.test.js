const test=require('node:test');
const assert=require('node:assert/strict');
const {parsePeriod,chunks}=require('../src/utils/report-period');
const archive=require('../src/services/ad-history.store');
const store=require('../src/data/mock.store');
const service=require('../src/services/ad-integration.service');
const {randomUUID}=require('node:crypto');
const p={startDate:'2026-09-01',endDate:'2026-09-30',days:30};
function account(){return {id:randomUUID(),platform:'Meta Ads',name:'Real test reference',externalAccountId:String(Math.floor(100000000000+Math.random()*1000000)),connectedBy:'dev'};}
const daily=(adId,date,spend)=>({id:adId,name:'Campaign A - historical ad',campaignId:'c1',adGroupId:'g1',status:'ACTIVE',effectiveStatus:'ACTIVE',daily:[{date,metrics:{spend,clicks:20,impressions:200,leads:2,conversions:null}}]});
test('calendar dates and 30-day chunking',()=>{
  const x=parsePeriod({month:'2026-09'},new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(x,pWithLabel(x));
  const y=parsePeriod({startDate:'2026-01-01',endDate:'2026-03-01'},new Date('2026-10-20T00:00:00Z'));
  assert.deepEqual(chunks(y).map(z=>z.startDate),['2026-01-01','2026-01-31']);
  assert.throws(()=>parsePeriod({startDate:'2026-01-32',endDate:'2026-02-01'}));
  assert.throws(()=>parsePeriod({startDate:'2024-01-01',endDate:'2026-01-01'}));
});
function pWithLabel(x){return {...p,label:'2026-09-01 to 2026-09-30'};}
test('history remains after ad disappears from upstream inventory twice',()=>{
 const a=account();store.accounts.push(a);
 const c=[{id:'c1',name:'Campaign A',status:'ACTIVE'}],g=[{id:'g1',campaignId:'c1',name:'Group',status:'ACTIVE'}];
 archive.verify(a,{externalName:a.name,currency:'PKR'});
 archive.commit(a,{campaigns:c,adGroups:g,ads:[daily('ad1','2026-09-05',1240)],performance:{daily:[{date:'2026-09-05',metrics:{spend:1240,impressions:200,clicks:20,leads:2,conversions:null}}]}},p);
 assert.equal(archive.slice(a,p).ads[0].metrics.spend,1240);
 const p2={startDate:'2026-10-01',endDate:'2026-10-10',days:10};
 for(let i=0;i<2;i++)archive.commit(a,{campaigns:[],adGroups:[],ads:[],performance:{daily:[]}},p2);
 const older=archive.slice(a,p);
 assert.equal(older.ads.length,1);assert.equal(older.ads[0].effectiveStatus,'UNAVAILABLE');
 assert.equal(older.ads[0].lastKnownPlatformStatus,'ACTIVE');
 assert.equal(older.ads[0].metrics.spend,1240);
 assert.equal(older.coverage.complete,true);
 assert.equal(archive.slice(a,p2).metrics.spend,0); // successful empty API report means zero
 const future=archive.slice(a,{startDate:'2026-08-01',endDate:'2026-08-31',days:31});
 assert.equal(future.coverage.complete,false);
 const user={role:'Admin'};assert.equal(service.hierarchy(a.id,user,p).ads.length,1);
 store.accounts.splice(store.accounts.findIndex(x=>x.id===a.id),1);
});
test('upsert daily metrics corrects spend and does not duplicate it',()=>{
 const a=account();const snap=value=>({campaigns:[],adGroups:[],ads:[daily('ad2','2026-09-05',value)],performance:{daily:[{date:'2026-09-05',metrics:{spend:value,impressions:200,clicks:20,leads:null,conversions:null}}]}});
 archive.commit(a,snap(120),p);archive.commit(a,snap(85),p);
 assert.equal(archive.slice(a,p).ads[0].metrics.spend,85);
 assert.equal(archive.slice(a,p).metrics.spend,85);
});
