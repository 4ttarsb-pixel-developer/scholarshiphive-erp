'use strict';
const {randomUUID}=require('node:crypto');
const {db,HttpError,kinds,account,accounts}=require('./common');
const {requiredText}=require('../../utils/http');
const integration=()=>require('./ad-integration.service');
async function assignedTo(id){
 const {rows}=await db.query(`SELECT u.id::text "userId",u.name "userName",u.email,u.status FROM marketing.ad_account_assignments x JOIN marketing.users u ON u.id=x.user_id WHERE x.ad_account_id=$1 AND x.revoked_at IS NULL ORDER BY u.name`,[id]);return rows;
}
async function sanitize(a,user,p={}){
 const s=await integration().status(a.id,user,p);
 if(user.role==='Admin')return {...a,...s,assignedEmployees:await assignedTo(a.id)};
 const {connectedBy,lastError,...safe}=a;
 return {...safe,...s,access:'read-only'};
}
async function all(user,p={}){return Promise.all((await accounts(user)).map(a=>sanitize(a,user,p)));}
async function get(id,user,p={}){return sanitize(await account(id,user),user,p);}
async function create(body,user){
 const name=requiredText(body?.name,'Account name');if(name.length>120)throw new HttpError(400,'Account name must be 120 characters or fewer');
 const platform=body?.platform;if(!kinds[platform])throw new HttpError(400,'Choose Meta Ads, Google Ads or TikTok Ads');
 const ext=typeof body?.externalAccountId==='string'?body.externalAccountId.trim():'';
 if(ext.length>100)throw new HttpError(400,'External account reference is too long');
 const id=randomUUID();
 // DB uniqueness enforces concurrent duplicate registrations. No local array check.
 const {rows}=await db.query(`INSERT INTO marketing.ad_accounts (id,platform,external_account_id,display_name,connected_by) VALUES ($1,$2,$3,$4,$5) RETURNING id::text id`,[id,kinds[platform],ext||('pending-'+id),name,user.id]);
 return get(rows[0].id,user);
}
async function update(id,body,user){
 await account(id,user);if(body?.name!==undefined){const name=requiredText(body.name,'Account name');if(name.length>120)throw new HttpError(400,'Account name is too long');await db.query(`UPDATE marketing.ad_accounts SET display_name=$2 WHERE id=$1`,[id,name]);}return get(id,user);
}
async function remove(id){
 await db.withTransaction(async client=>{
  const found=await client.query(`SELECT id FROM marketing.ad_accounts WHERE id=$1 FOR UPDATE`,[id]);if(!found.rowCount)throw new HttpError(404,'Ad account not found');
  for(const table of ['ad_campaigns','ad_groups','ads','ad_account_daily_metrics','ad_sync_jobs','ad_sync_runs','ad_sync_coverage','campaign_mappings','mapping_events']){
   const r=await client.query(`SELECT 1 FROM marketing.${table} WHERE account_id=$1 LIMIT 1`,[id]);
   if(r.rowCount)throw new HttpError(409,'Account has historical/sync/attribution records and cannot be deleted. Preserve its financial history.');
  }
  await client.query(`DELETE FROM marketing.ad_account_assignments WHERE ad_account_id=$1`,[id]);
  await client.query(`DELETE FROM marketing.ad_accounts WHERE id=$1`,[id]);
 });return {removed:true,id};
}
async function assign(id,userId,admin){
 await account(id,admin);
 const user=(await db.query(`SELECT id FROM marketing.users WHERE id=$1 AND role='Employee' AND status='Active'`,[userId])).rows[0];
 if(!user)throw new HttpError(400,'Select an active employee');
 const prev=await db.query(`SELECT revoked_at FROM marketing.ad_account_assignments WHERE ad_account_id=$1 AND user_id=$2`,[id,userId]);
 if(prev.rows[0] && !prev.rows[0].revoked_at)throw new HttpError(409,'Account already assigned to employee');
 await db.query(`INSERT INTO marketing.ad_account_assignments(ad_account_id,user_id,assigned_by,assigned_at) VALUES ($1,$2,$3,now()) ON CONFLICT (ad_account_id,user_id) DO UPDATE SET assigned_by=EXCLUDED.assigned_by,assigned_at=now(),revoked_at=NULL`,[id,userId,admin.id]);
 return get(id,admin);
}
async function unassign(id,userId,admin){await account(id,admin);
 const r=await db.query(`UPDATE marketing.ad_account_assignments SET revoked_at=now() WHERE ad_account_id=$1 AND user_id=$2 AND revoked_at IS NULL`,[id,userId]);
 if(!r.rowCount)throw new HttpError(404,'Assignment not found');return get(id,admin);
}
module.exports={all,get,create,update,remove,assign,unassign};
