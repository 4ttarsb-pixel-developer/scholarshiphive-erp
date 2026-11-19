// Company-approved monthly reference rates for management reporting, NOT a market FX feed.
//   memory driver  -> dev-only JSON file (var/fx-rates.json), preserved behavior.
//   postgres driver-> fx_rates + fx_rate_events. An in-memory cache (getDB().rates) is
//     hydrated at startup and kept write-through on set(), so rate()/rows()/
//     convertDaily() stay synchronous (no change for the ad-history slice()).
const fs = require('node:fs');
const path = require('node:path');
const {HttpError} = require('../utils/http');
const repo = require('../repositories');
const IS_PG = (process.env.PERSISTENCE_DRIVER || 'memory').toLowerCase() === 'postgres';
const file = process.env.MEA_FX_RATES_PATH || path.join(__dirname,'../../var/fx-rates.json');
let memoryDB={version:1,rates:{},history:[]};
function getDB(){if(IS_PG){const ctx=require('../db/request-context').current();if(ctx)return ctx.fx;}return memoryDB;}
function setDB(value){if(IS_PG){const ctx=require('../db/request-context').current();if(ctx){ctx.fx=value;return;}}memoryDB=value;}
if (!IS_PG) {
  try {
   if(!['test','production'].includes(process.env.NODE_ENV) && fs.existsSync(file)) {
    const stored=JSON.parse(fs.readFileSync(file,'utf8'));
    if(stored.version!==1 || !stored.rates || !Array.isArray(stored.history))throw Error('invalid format');
    setDB(stored);
   }
  } catch(e){throw Error(`Cannot read FX rate file at ${file}; refusing to overwrite: ${e.message}`)}
}
const round=v=>Math.round((v+Number.EPSILON)*100)/100;
function save(){
 if(IS_PG || ['test','production'].includes(process.env.NODE_ENV))return;
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const tmp=`${file}.${process.pid}.tmp`;
 fs.writeFileSync(tmp,JSON.stringify(getDB(),null,2),{mode:0o600});
 try{fs.renameSync(tmp,file)}catch(e){fs.rmSync(tmp,{force:true});throw e}
}
// postgres only: load approved rates into the in-memory cache at startup.
async function init(){
 if(!IS_PG)return;
 const rates=await repo.fx.loadAll();
 setDB({version:1,rates:{},history:[]});
 for(const r of rates)getDB().rates[`${r.currency}:${r.month}`]=r;
}
function rows(){return Object.values(getDB().rates).sort((a,b)=>a.month.localeCompare(b.month)||a.currency.localeCompare(b.currency));}
function rate(currency,month){return getDB().rates[`${currency}:${month}`]||null;}
async function set(body,user){
 if(user?.role!=='Admin')throw new HttpError(403,'Admin access required');
 const currency=String(body?.currency||'').toUpperCase().trim();
 const month=String(body?.month||'').trim();
 const value=Number(body?.rate);
 const source=String(body?.source||'').trim();
 if(!/^[A-Z]{3}$/.test(currency)||currency==='PKR')throw new HttpError(400,'Source currency must be a valid non-PKR three-letter currency code');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new HttpError(400,'Rate month must be YYYY-MM');
 if(body?.rate===undefined||body?.rate===null||body?.rate===''||!Number.isFinite(value)||value<=0||value>1000000||Math.abs(value*1e6-Math.round(value*1e6))>0.0001)throw new HttpError(400,'PKR rate must be positive with at most six decimal places');
 if(source.length<3||source.length>180)throw new HttpError(400,'Enter the approved rate source (3-180 characters)');
 const key=`${currency}:${month}`;
 const old=getDB().rates[key];
 const item={currency,month,rate:value,source,updatedAt:new Date().toISOString(),updatedBy:user.id};
 if(IS_PG){
  await repo.fx.upsert({currency,month,rate:value,source,oldRate:old?.rate??null,userId:user.id});
 }
 getDB().rates[key]=item;
 getDB().history.push({at:item.updatedAt,by:user.id,currency,month,oldRate:old?.rate??null,rate:value,source});
 save();return item;
}
// Every recorded daily spend is converted using its corresponding calendar month's
// company-approved rate. No rate => PKR value is null, not an invented number.
function convertDaily(entries,currency,nativeSpend,dates=()=>true){
 const curr=String(currency||'').toUpperCase();
 const selected=entries.filter(r=>dates(r.date)&&typeof r.spend==='number'&&Number.isFinite(r.spend));
 if(nativeSpend==null)return {spendPKR:null,fxStatus:'source_unavailable',missingRateMonths:[],currency:'PKR',ratePolicy:'company_monthly_reference'};
 if(curr==='PKR')return {spendPKR:round(nativeSpend),fxStatus:'native_pkr',missingRateMonths:[],currency:'PKR',ratePolicy:'native'};
 if(!/^[A-Z]{3}$/.test(curr))return {spendPKR:null,fxStatus:'currency_unknown',missingRateMonths:[],currency:'PKR',ratePolicy:'company_monthly_reference'};
 if(nativeSpend===0)return {spendPKR:0,fxStatus:'zero_spend',missingRateMonths:[],currency:'PKR',ratePolicy:'company_monthly_reference'};
 if(!selected.length)return {spendPKR:null,fxStatus:'daily_data_unavailable',missingRateMonths:[],currency:'PKR',ratePolicy:'company_monthly_reference'};
 const missing=new Set();let total=0;
 for(const item of selected){const month=item.date.slice(0,7),r=rate(curr,month);
  if(!r)missing.add(month); else total+=item.spend*r.rate;
 }
 return {spendPKR:missing.size?null:round(total),fxStatus:missing.size?'rate_missing':'converted',missingRateMonths:[...missing].sort(),currency:'PKR',ratePolicy:'company_monthly_reference'};
}
module.exports={rows,rate,set,convertDaily,init,file};
