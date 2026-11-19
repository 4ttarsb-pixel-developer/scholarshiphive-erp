'use strict';
// PostgreSQL-mode services never read the development mock.store or request snapshots.
const db = require('../../db/pool');
const {HttpError} = require('../../utils/http');
const {parsePeriod} = require('../../utils/report-period');
const labels = {meta:'Meta Ads',google:'Google Ads',tiktok:'TikTok Ads'};
const kinds = {'Meta Ads':'meta','Google Ads':'google','TikTok Ads':'tiktok'};
const formatDate = "to_char(%s, 'YYYY-MM-DD')";
const fmtTs = col => `to_char(${col} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const num = v => v == null ? null : Number(v);
const money = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const configStatus = platform => Boolean(platform==='Meta Ads'?process.env.META_ACCESS_TOKEN:platform==='Google Ads'?(process.env.GOOGLE_ADS_ACCESS_TOKEN || (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN)):platform==='TikTok Ads'?process.env.TIKTOK_ACCESS_TOKEN:false);
const accountCols = `a.id::text id, a.display_number "displayNumber", a.platform, a.display_name name, a.external_account_id "externalAccountId", a.currency_code currency, a.integration_status "integrationStatus", a.connected_by::text "connectedBy", ${fmtTs('a.verified_at')} "lastVerifiedAt", ${fmtTs('a.last_synced_at')} "lastSyncedAt", a.last_error "lastError", a.new_ads_detected "newAdsDetected", a.new_campaigns_detected "newCampaignsDetected"`;
function shape(row){return {...row,platform:labels[row.platform]||row.platform,spend:null,leads:null,ads:null};}
async function account(id,user,{allowUnassigned=false}={}){
 if(!user)throw new HttpError(401,'Please sign in again');
 const {rows}=await db.query(`SELECT ${accountCols} FROM marketing.ad_accounts a WHERE a.id=$1 AND ($2='Admin' OR EXISTS (SELECT 1 FROM marketing.ad_account_assignments x WHERE x.ad_account_id=a.id AND x.user_id=$3 AND x.revoked_at IS NULL))`,[id,user.role,user.id||null]);
 if(!rows[0])throw new HttpError(404,'Ad account not found');return shape(rows[0]);
}
async function accounts(user){
 if(!user)throw new HttpError(401,'Please sign in again');
 const {rows}=await db.query(`SELECT ${accountCols} FROM marketing.ad_accounts a WHERE $1='Admin' OR EXISTS (SELECT 1 FROM marketing.ad_account_assignments x WHERE x.ad_account_id=a.id AND x.user_id=$2 AND x.revoked_at IS NULL) ORDER BY a.created_at,a.id`,[user.role,user.id||null]);
 return rows.map(shape);
}
async function approvedFX(currency,day){
 if(currency==='PKR')return 1;
 if(!currency)return null;
 const {rows}=await db.query(`SELECT rate_pkr::float8 rate FROM marketing.fx_rates WHERE currency=$1 AND month=date_trunc('month',$2::date)::date`,[currency,day]);
 return rows[0]?.rate??null;
}
const sameDate=(day,start,end)=>day>=start&&day<=end;
module.exports={db,HttpError,parsePeriod,labels,kinds,fmtTs,num,money,configStatus,accountCols,account,accounts,approvedFX,sameDate};
