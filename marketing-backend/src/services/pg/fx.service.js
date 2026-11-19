'use strict';
const {db,HttpError}=require('./common');
async function rows(){const r=await db.query(`SELECT currency,to_char(month,'YYYY-MM') AS "month",rate_pkr::float8 rate,source,updated_at "updatedAt",approved_by::text "updatedBy" FROM marketing.fx_rates ORDER BY month,currency`);return r.rows;}
async function set(body,user){if(user?.role!=='Admin')throw new HttpError(403,'Admin access required');const currency=String(body?.currency||'').toUpperCase().trim(),month=String(body?.month||'').trim(),rate=Number(body?.rate),source=String(body?.source||'').trim();
 if(!/^[A-Z]{3}$/.test(currency)||currency==='PKR')throw new HttpError(400,'Source currency must be a valid non-PKR three-letter code');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new HttpError(400,'Rate month must be YYYY-MM');
 if(body?.rate==null||body?.rate===''||!Number.isFinite(rate)||rate<=0||rate>1000000||Math.abs(rate*1e6-Math.round(rate*1e6))>0.0001)throw new HttpError(400,'PKR rate must be positive with at most six decimal places');
 if(source.length<3||source.length>180)throw new HttpError(400,'Enter approved rate source');
 await db.withTransaction(async client=>{
  const before=(await client.query(`SELECT rate_pkr FROM marketing.fx_rates WHERE currency=$1 AND month=($2||'-01')::date FOR UPDATE`,[currency,month])).rows[0];
  await client.query(`INSERT INTO marketing.fx_rates(currency,month,rate_pkr,source,approved_by) VALUES ($1,($2||'-01')::date,$3,$4,$5) ON CONFLICT(currency,month) DO UPDATE SET rate_pkr=EXCLUDED.rate_pkr,source=EXCLUDED.source,approved_by=EXCLUDED.approved_by,updated_at=now(),version=marketing.fx_rates.version+1`,[currency,month,rate,source,user.id]);
  await client.query(`INSERT INTO marketing.fx_rate_events(currency,month,old_rate,new_rate,source,actor_id) VALUES ($1,($2||'-01')::date,$3,$4,$5,$6)`,[currency,month,before?.rate_pkr??null,rate,source,user.id]);
 });return {currency,month,rate,source,updatedBy:user.id,updatedAt:new Date().toISOString()};}
module.exports={rows,set};
