import React from 'react';
const pad=n=>String(n).padStart(2,'0');
export const monthNow=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}`};
export const isoLocal=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
export const today=()=>isoLocal(new Date());
export const defaultPeriod=()=>({mode:'month',month:monthNow()});
export function periodQuery(p){return p.mode==='month'?{month:p.month}:{startDate:p.startDate,endDate:p.endDate};}
export function periodLabel(p){return p.mode==='month'?new Date(`${p.month}-02T00:00:00`).toLocaleString('en-PK',{month:'long',year:'numeric'}):`${p.startDate} → ${p.endDate}`;}
function offset(days){const d=new Date();d.setDate(d.getDate()+days);return isoLocal(d)}
export function ReportingPeriodPicker({value,onChange}){
 const setPreset=key=>{
  if(key==='this-month'){onChange(defaultPeriod());return}
  if(key==='prev-month'){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);onChange({mode:'month',month:`${d.getFullYear()}-${pad(d.getMonth()+1)}`});return}
  const end=today();const start=key==='today'?end:key==='7'?offset(-6):offset(-29);onChange({mode:'custom',preset:key,startDate:start,endDate:end});
 };
 const mode=value.mode==='month'?'month':value.preset||'custom';
 const previous=()=>{const d=new Date(`${value.month}-02T00:00:00`);d.setMonth(d.getMonth()-1);onChange({mode:'month',month:`${d.getFullYear()}-${pad(d.getMonth()+1)}`})};
 const next=()=>{const d=new Date(`${value.month}-02T00:00:00`);d.setMonth(d.getMonth()+1);onChange({mode:'month',month:`${d.getFullYear()}-${pad(d.getMonth()+1)}`})};
 return <div className="mea-datebar" aria-label="Global reporting period">
  <div className="mea-date-label">📅 Reporting Period <strong>{periodLabel(value)}</strong></div>
  <div className="mea-date-controls">
   <select aria-label="Reporting preset" value={mode} onChange={e=>{if(e.target.value==='custom'){onChange({mode:'custom',preset:'custom',startDate:offset(-29),endDate:today()})}else if(e.target.value==='month'){onChange(defaultPeriod())}else setPreset(e.target.value)}}>
    <option value="month">Monthly Calendar</option><option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="prev-month">Previous Month</option><option value="custom">Custom dates</option>
   </select>
   {value.mode==='month'?<div className="mea-month-nav"><button aria-label="Previous month" onClick={previous}>‹</button><input aria-label="Report month" type="month" value={value.month} max={monthNow()} onChange={e=>e.target.value&&onChange({mode:'month',month:e.target.value})}/><button aria-label="Next month" disabled={value.month>=monthNow()} onClick={next}>›</button></div>:<div className="mea-day-nav"><input aria-label="Start date" type="date" value={value.startDate} max={value.endDate} onChange={e=>e.target.value&&onChange({...value,preset:'custom',startDate:e.target.value})}/><span>to</span><input aria-label="End date" type="date" value={value.endDate} min={value.startDate} max={today()} onChange={e=>e.target.value&&onChange({...value,preset:'custom',endDate:e.target.value})}/></div>}
  </div>
  <style>{`.mea-datebar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 18px;margin-bottom:20px;background:linear-gradient(115deg,#e9f6ff,#fff);border:1px solid #c9e3f7;border-radius:16px;box-shadow:0 5px 24px #1477a10b}.mea-date-label{display:flex;flex-direction:column;gap:3px;color:#507c9a;font-size:12px;font-weight:750}.mea-date-label strong{font-size:15px;color:#174d78}.mea-date-controls,.mea-month-nav,.mea-day-nav{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.mea-date-controls select,.mea-date-controls input,.mea-date-controls button{border:1px solid #bad9eb;background:#fff;color:#18577f;padding:9px;border-radius:9px;font:inherit;font-size:12px}.mea-date-controls button{font-size:17px;cursor:pointer;padding:4px 12px}.mea-date-controls button:disabled{opacity:.35;cursor:not-allowed}.mea-day-nav input{max-width:148px}@media(max-width:550px){.mea-date-controls{width:100%}.mea-date-controls select{width:100%}.mea-month-nav,.mea-day-nav{width:100%}.mea-month-nav input{flex:1}.mea-day-nav input{flex:1;min-width:120px}}`}</style>
 </div>;
}
