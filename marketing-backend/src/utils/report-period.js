// Platform reporting dates are ISO local-calendar dates, not UTC timestamps.
const {HttpError}=require('./http');
const iso=/^\d{4}-\d{2}-\d{2}$/;
function checked(value){
 if(typeof value!== 'string'||!iso.test(value))throw new HttpError(400,'Date must be YYYY-MM-DD');
 const date=new Date(`${value}T00:00:00Z`);
 if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)throw new HttpError(400,'Invalid reporting date');
 return date;
}
const fmt=d=>d.toISOString().slice(0,10);
function parsePeriod(input={},now=new Date()){
 const today=fmt(now);
 let startDate=input.startDate,endDate=input.endDate;
 if((startDate&&!endDate)||(!startDate&&endDate))throw new HttpError(400,'Both startDate and endDate are required');
 if(!startDate){
  if(input.month){
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))throw new HttpError(400,'Month must be YYYY-MM');
   startDate=`${input.month}-01`;
   const last=new Date(`${startDate}T00:00:00Z`);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
   endDate=fmt(last);
  } else {
   const start=new Date(`${today}T00:00:00Z`);start.setUTCDate(start.getUTCDate()-29);
   startDate=fmt(start);endDate=today;
  }
 }
 const start=checked(startDate),end=checked(endDate);
 if(start>end)throw new HttpError(400,'Start date must be before end date');
 const dayCount=Math.round((end-start)/86400000)+1;
 if(dayCount>366)throw new HttpError(400,'Maximum single reporting range is 366 days. Import older history in separate ranges.');
 if(start>new Date(`${today}T00:00:00Z`))throw new HttpError(400,'Cannot fetch future reporting dates');
 if(endDate>today)endDate=today;
 const actualDays=Math.round((checked(endDate)-start)/86400000)+1;
 return {startDate,endDate,days:actualDays,label:`${startDate} to ${endDate}`};
}
function chunks(period,maxDays=30){
 const rows=[];const end=new Date(`${period.endDate}T00:00:00Z`);
 let cur=new Date(`${period.startDate}T00:00:00Z`);
 while(cur<=end){const to=new Date(cur);to.setUTCDate(to.getUTCDate()+maxDays-1);if(to>end)to.setTime(end.getTime());rows.push({startDate:fmt(cur),endDate:fmt(to)});cur=new Date(to);cur.setUTCDate(cur.getUTCDate()+1)}
 return rows;
}
module.exports={parsePeriod,chunks};
