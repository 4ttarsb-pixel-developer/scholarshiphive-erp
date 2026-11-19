// Reports only recorded local expenses and successfully synchronized ad API snapshots.
// Advertising spend and monthly budget are different measures; never double-count them.
const budget=require('./budget.service');
const expenses=require('./expense.service');
const adAccounts=require('./ad-account.service');
const integrations=require('./ad-integration.service');
const {parsePeriod}=require('../utils/report-period');
const round=v=>Math.round((v+Number.EPSILON)*100)/100;
// Ad snapshot is read from the (synchronous) ad layer; unchanged.
function liveSnapshot(user,periodInput={}){
 const accessible=adAccounts.all(user);const period=parsePeriod(periodInput);
 const snapshots=accessible.map(a=>({account:a,report:integrations.performance(a.id,user,period)}));
 const complete=snapshots.filter(x=>x.report.coverage?.complete&&x.report.source==='live_api');
 const knownLeads=complete.filter(x=>typeof x.report.metrics.leads==='number');
 const byCurrency=Object.values(complete.reduce((result,{account,report})=>{
  const currency=report.metrics.currency||account.currency||'UNKNOWN';const spend=report.metrics.spend;
  if(typeof spend!=='number')return result;
  if(!result[currency])result[currency]={currency,spend:0,accountCount:0};
  result[currency].spend=Math.round((result[currency].spend+spend)*100)/100;result[currency].accountCount++;return result;
 },{}));
 const fxPending=complete.filter(x=>x.report.metrics.spendPKR==null);
 const adSpendPKR=complete.length>0&&!fxPending.length?round(complete.reduce((n,x)=>n+x.report.metrics.spendPKR,0)):null;
 return {adSpendPKR,fxPendingAccountCount:fxPending.length,reportingCurrency:'PKR',adsSpendSeparateFromManual:true,reportingPeriod:period,reportingWindow:period.label,syncedAccountCount:complete.length,liveLeads:knownLeads.length?knownLeads.reduce((n,x)=>n+x.report.metrics.leads,0):null,leadCoverage:`${knownLeads.length}/${complete.length} complete account report(s) provide leads`,adAccountCount:accessible.length,byCurrency,accountsCoverage:snapshots.map(x=>({id:x.account.id,platform:x.account.platform,coverage:x.report.coverage,currency:x.report.metrics.currency,spend:x.report.metrics.spend,spendPKR:x.report.metrics.spendPKR,fxStatus:x.report.metrics.fxStatus,lastSyncedAt:x.report.lastSyncedAt})),lastSyncAt:complete.length?complete.map(x=>x.report.lastSyncedAt).sort().at(-1):null};
}
async function summary(month=budget.currentMonth(),periodInput={month}){
  const result=await budget.snapshot(month);
  const range=parsePeriod(periodInput);
  const allExpenses=await expenses.all();
  const approvedSpend=allExpenses.filter(e=>e.status==='Approved'&&e.date>=range.startDate&&e.date<=range.endDate).reduce((n,e)=>n+e.amount,0);
  return {month,monthlyBudgetContext:month,manualSpendPeriod:range,totalMarketingSpend:approvedSpend,manualApprovedSpend:approvedSpend,remainingBudget:result.overall.remaining,monthlyBudget:result.overall.limit,...liveSnapshot({role:'Admin'},periodInput),expenseCount:allExpenses.length,pendingApprovals:allExpenses.filter(e=>['Pending','In Review'].includes(e.status)).length};
}
async function summaryForUser(user,month=budget.currentMonth(),periodInput={month}){
 if(user.role==='Admin')return summary(month,periodInput);
 const range=parsePeriod(periodInput);
 const mine=(await expenses.all({},user)).filter(e=>e.date>=range.startDate&&e.date<=range.endDate);
 const myBudget=await budget.myAllocations(user,month);
 const approved=mine.filter(e=>e.status==='Approved');
 return {month,manualSpendPeriod:range,monthlyBudgetContext:month,role:'Employee',mySpend:approved.reduce((n,e)=>n+e.amount,0),myExpenseCount:mine.length,myPending:mine.filter(e=>['Pending','In Review'].includes(e.status)).length,myApproved:approved.length,myBudget:myBudget.overall,myAllocations:myBudget.items,...liveSnapshot(user,periodInput),assignedAdAccountCount:adAccounts.all(user).length};
}
async function report(periodInput={}){
  const user={role:'Admin'};const period=parsePeriod(periodInput);const accounts=adAccounts.all(user,period).map(a=>{const v=integrations.performance(a.id,user,period);const m=v.metrics;return {...a,spend:v.coverage.complete?m.spend:null,leads:v.coverage.complete?m.leads:null,metrics:v.coverage.complete?m:null,coverage:v.coverage,costPerLead:v.coverage.complete&&m.leads>0&&m.spend!==null?Math.round(m.spend/m.leads*100)/100:null,costPerLeadPKR:v.coverage.complete&&m.leads>0&&m.spendPKR!==null?Math.round(m.spendPKR/m.leads*100)/100:null};});
  const s=await summary(budget.currentMonth(),periodInput);
  // Historical line data: real approved expense transactions grouped by actual
  // reporting date (or calendar month for very long ranges). No invented trend.
  const {chartSeries,applyAdvertisingDailyFacts}=require('../utils/chart-series');
  const {data:chartData,granularity}=chartSeries(period,await expenses.all());
  const monthly=granularity==='month';
  // Query verified platform daily facts directly from PostgreSQL, NOT from
  // platform snapshots or hand-entered totals. Missing FX is null (never 0).
  let haveAdSeries=false;
  if((process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres'){
   const {rows}=await require('../db/pool').query(`
    SELECT to_char(m.report_date,'YYYY-MM-DD') date, a.currency_code currency,
           m.spend_original::float8 spend, fx.rate_pkr::float8 fx_rate
      FROM marketing.ad_account_daily_metrics m
      JOIN marketing.ad_accounts a ON a.id=m.account_id
      LEFT JOIN marketing.fx_rates fx ON fx.currency=a.currency_code
               AND fx.month=date_trunc('month',m.report_date)::date
     WHERE m.report_date BETWEEN $1::date AND $2::date`,[period.startDate,period.endDate]);
   haveAdSeries=applyAdvertisingDailyFacts(chartData,rows,monthly);
  }
  return {accounts,chartData,chartGranularity:monthly?'month':'day',chartSource:'approved_manual_expenses_and_verified_ad_daily_facts',haveAdSeries,adMetricsWindow:period.label,reportingPeriod:period,adsSource:'verified_api_snapshots_only'};
}
module.exports={summary,summaryForUser,report,liveSnapshot};
