const test=require('node:test');
const assert=require('node:assert/strict');
const {chartSeries,applyAdvertisingDailyFacts}=require('../src/utils/chart-series');
test('daily line chart contains true dates instead of one aggregate point',()=>{
 const period={startDate:'2026-10-01',endDate:'2026-10-04',days:4};
 const {data,granularity}=chartSeries(period,[
  {status:'Approved',date:'2026-10-01',amount:150},{status:'Approved',date:'2026-10-01',amount:50},
  {status:'Pending',date:'2026-10-02',amount:900},{status:'Approved',date:'2026-10-03',amount:100},
  {status:'Approved',date:'2026-09-30',amount:300}]);
 assert.equal(granularity,'day');assert.deepEqual(data.map(x=>x.spend),[200,0,100,0]);
});
test('monthly long-span chart groups by actual months',()=>{
 const {data,granularity}=chartSeries({startDate:'2026-01-01',endDate:'2026-06-30',days:181},[
 {status:'Approved',date:'2026-02-01',amount:500},{status:'Approved',date:'2026-02-18',amount:250}]);
 assert.equal(granularity,'month');assert.equal(data.length,6);assert.equal(data[1].spend,750);
});
test('advertising data converts native PKR and known FX without mixing amounts',()=>{
 const data=[{month:'2026-10-01',spend:55,adSpend:null}];
 applyAdvertisingDailyFacts(data,[{date:'2026-10-01',currency:'PKR',spend:300,fx_rate:null},{date:'2026-10-01',currency:'USD',spend:2,fx_rate:280}],false);
 assert.equal(data[0].adSpend,860);assert.equal(data[0].spend,55);
});
test('missing approved FX is not silently counted as zero or converted',()=>{
 const data=[{month:'2026-10-01',spend:0,adSpend:null}];
 applyAdvertisingDailyFacts(data,[{date:'2026-10-01',currency:'USD',spend:12,fx_rate:null}],false);
 assert.equal(data[0].adSpend,null);
});
