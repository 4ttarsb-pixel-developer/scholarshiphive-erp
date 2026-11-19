// Expense time series: no synthetic trend from an aggregate total.
const round = value => Math.round((value+Number.EPSILON)*100)/100;
function chartSeries(period, entries) {
  const monthly=period.days>93;
  const amounts=new Map();
  for(const e of entries){
    if(e.status!=='Approved'||e.date<period.startDate||e.date>period.endDate)continue;
    const key=monthly?e.date.slice(0,7):e.date;
    amounts.set(key,round((amounts.get(key)||0)+Number(e.amount||0)));
  }
  const output=[];
  if(monthly){
    let y=Number(period.startDate.slice(0,4)),m=Number(period.startDate.slice(5,7));const end=period.endDate.slice(0,7);
    while(`${y}-${String(m).padStart(2,'0')}`<=end){
      const month=`${y}-${String(m).padStart(2,'0')}`;
      output.push({month,spend:amounts.get(month)||0,adSpend:null});
      m++;if(m===13){y++;m=1;}
    }
  } else {
    let date=Date.parse(period.startDate+'T00:00:00Z');const end=Date.parse(period.endDate+'T00:00:00Z');
    while(date<=end){const day=new Date(date).toISOString().slice(0,10);
      output.push({month:day,spend:amounts.get(day)||0,adSpend:null});date+=86400000;}
  }
  return {data:output,granularity:monthly?'month':'day'};
}
// Never convert unknown FX amounts to zero or to guessed PKR.
function applyAdvertisingDailyFacts(chartData,rows,monthly=false){
  const daily=new Map();
  for(const r of rows){
    const value=daily.get(r.date)||{amount:0,valid:true};
    const curr=String(r.currency||'').trim().toUpperCase();
    const fx=curr==='PKR'?1:(r.fx_rate==null?null:Number(r.fx_rate));
    if(r.spend==null||fx==null)value.valid=false;
    else value.amount+=Number(r.spend)*fx;
    daily.set(r.date,value);
  }
  const grouped=new Map();
  for(const [day,value] of daily){
    const key=monthly?day.slice(0,7):day,entry=grouped.get(key)||{amount:0,valid:true};
    entry.amount+=value.amount;entry.valid=entry.valid&&value.valid;grouped.set(key,entry);
  }
  for(const row of chartData){const metric=grouped.get(row.month);
    row.adSpend=metric?(metric.valid?round(metric.amount):null):null;
  }
  return grouped.size>0;
}
module.exports={chartSeries,applyAdvertisingDailyFacts};
