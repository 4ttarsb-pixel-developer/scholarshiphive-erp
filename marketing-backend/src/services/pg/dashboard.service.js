'use strict';
const budget=require('../budget.service');
const expenses=require('../expense.service');
const accounts=require('./ad-account.service');
const ads=require('./ad-integration.service');
const {parsePeriod}=require('../../utils/report-period');
const {db,money}=require('./common');
async function liveSnapshot(user,periodInput={}){
 const accessible=await accounts.all(user,periodInput),period=parsePeriod(periodInput);
 const snapshots=await Promise.all(accessible.map(async a=>({account:a,report:await ads.performance(a.id,user,period)})));
 const complete=snapshots.filter(x=>x.report.coverage?.complete&&x.report.source==='live_api');
 const knownLeads=complete.filter(x=>typeof x.report.metrics.leads==='number');
 const groups=new Map();for(const {account,report} of complete){const currency=report.metrics.currency||account.currency||'UNKNOWN',spend=report.metrics.spend;if(typeof spend!=='number')continue;const prev=groups.get(currency)||{currency,spend:0,accountCount:0};prev.spend=money(prev.spend+spend);prev.accountCount++;groups.set(currency,prev);}
 const pending=complete.filter(x=>x.report.metrics.spendPKR==null);
 const adSpendPKR=complete.length&&!pending.length?money(complete.reduce((n,x)=>n+x.report.metrics.spendPKR,0)):null;
 return {adSpendPKR,fxPendingAccountCount:pending.length,reportingCurrency:'PKR',adsSpendSeparateFromManual:true,reportingPeriod:period,reportingWindow:period.label,syncedAccountCount:complete.length,liveLeads:knownLeads.length?knownLeads.reduce((n,x)=>n+x.report.metrics.leads,0):null,leadCoverage:`${knownLeads.length}/${complete.length} complete account report(s) provide leads`,adAccountCount:accessible.length,byCurrency:[...groups.values()],accountsCoverage:snapshots.map(x=>({id:x.account.id,platform:x.account.platform,coverage:x.report.coverage,currency:x.report.metrics.currency,spend:x.report.metrics.spend,spendPKR:x.report.metrics.spendPKR,fxStatus:x.report.metrics.fxStatus,lastSyncedAt:x.report.lastSyncedAt})),lastSyncAt:complete.length?complete.map(x=>x.report.lastSyncedAt).sort().at(-1):null};
}
async function summary(month=budget.currentMonth(),periodInput={month}){
 const [result,allExpenses,live]=await Promise.all([budget.snapshot(month),expenses.all(),liveSnapshot({role:'Admin'},periodInput)]);
 const range=parsePeriod(periodInput),approvedSpend=allExpenses.filter(e=>e.status==='Approved'&&e.date>=range.startDate&&e.date<=range.endDate).reduce((n,e)=>n+e.amount,0);
 return {month,monthlyBudgetContext:month,manualSpendPeriod:range,totalMarketingSpend:approvedSpend,manualApprovedSpend:approvedSpend,remainingBudget:result.overall.remaining,monthlyBudget:result.overall.limit,...live,expenseCount:allExpenses.length,pendingApprovals:allExpenses.filter(e=>['Pending','In Review'].includes(e.status)).length};
}
async function summaryForUser(user,month=budget.currentMonth(),periodInput={month}){
 if(user.role==='Admin')return summary(month,periodInput);
 const [mineRaw,myBudget,live]=await Promise.all([expenses.all({},user),budget.myAllocations(user,month),liveSnapshot(user,periodInput)]);
 const range=parsePeriod(periodInput),mine=mineRaw.filter(e=>e.date>=range.startDate&&e.date<=range.endDate),approved=mine.filter(e=>e.status==='Approved');
 return {month,manualSpendPeriod:range,monthlyBudgetContext:month,role:'Employee',mySpend:approved.reduce((n,e)=>n+e.amount,0),myExpenseCount:mine.length,myPending:mine.filter(e=>['Pending','In Review'].includes(e.status)).length,myApproved:approved.length,myBudget:myBudget.overall,myAllocations:myBudget.items,...live,assignedAdAccountCount:live.adAccountCount};
}
async function report(periodInput={}){
 const user={role:'Admin'},period=parsePeriod(periodInput);
 const data=await accounts.all(user,period);
 const summaries=await Promise.all(data.map(async a=>{
  const v=await ads.performance(a.id,user,period),m=v.metrics;
  return {...a,spend:v.coverage.complete?m.spend:null,leads:v.coverage.complete?m.leads:null,metrics:v.coverage.complete?m:null,coverage:v.coverage,costPerLead:v.coverage.complete&&m.leads>0&&m.spend!=null?money(m.spend/m.leads):null,costPerLeadPKR:v.coverage.complete&&m.leads>0&&m.spendPKR!=null?money(m.spendPKR/m.leads):null};
 }));
 const {chartSeries,applyAdvertisingDailyFacts}=require('../../utils/chart-series');
 const {data:chartData,granularity}=chartSeries(period,await expenses.all());
 const rows=await db.query(`SELECT to_char(m.report_date,'YYYY-MM-DD') date,a.currency_code currency,m.spend_original::float8 spend,fx.rate_pkr::float8 fx_rate FROM marketing.ad_account_daily_metrics m JOIN marketing.ad_accounts a ON a.id=m.account_id LEFT JOIN marketing.fx_rates fx ON fx.currency=a.currency_code AND fx.month=date_trunc('month',m.report_date)::date WHERE m.report_date BETWEEN $1::date AND $2::date`,[period.startDate,period.endDate]);
 const haveAdSeries=applyAdvertisingDailyFacts(chartData,rows.rows,granularity==='month');
 return {accounts:summaries,chartData,chartGranularity:granularity,chartSource:'approved_manual_expenses_and_verified_ad_daily_facts',haveAdSeries,adMetricsWindow:period.label,reportingPeriod:period,adsSource:'verified_api_snapshots_only'};
}
module.exports={liveSnapshot,summary,summaryForUser,report};
