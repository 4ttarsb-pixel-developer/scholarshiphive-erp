// Ad account registry persistence.
//   memory driver  -> JSON file (var/ad-accounts.json), preserved behavior.
//   postgres driver-> marketing.ad_accounts + ad_account_assignments. The store
//     arrays are the working cache (hydrated at startup); write-through happens
//     via the async methods below (called from the ad-account service write ops).
const fs=require('node:fs');const path=require('node:path');
const store=require('../data/mock.store');
const IS_PG=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres';
const file=process.env.MEA_ACCOUNT_CATALOG_PATH||path.join(__dirname,'../../var/ad-accounts.json');
const PLATFORM_TO_DB={'Meta Ads':'meta','Google Ads':'google','TikTok Ads':'tiktok'};
const PLATFORM_FROM_DB={meta:'Meta Ads',google:'Google Ads',tiktok:'TikTok Ads'};
const pg=()=>require('../db/pool');

function enabled(){return !IS_PG && !['test','production'].includes(process.env.NODE_ENV)}
function load(){
 if(!enabled()||!fs.existsSync(file))return;
 let rows;try{rows=JSON.parse(fs.readFileSync(file,'utf8'))}catch(e){throw new Error(`Invalid account registry at ${file}: ${e.message}`)}
 for(const x of rows.accounts||[]){
  if(!x.id||!x.externalAccountId||!['Meta Ads','Google Ads','TikTok Ads'].includes(x.platform))continue;
  if(store.accounts.some(a=>a.id===x.id))continue;
  store.accounts.push({id:x.id,platform:x.platform,name:x.name,externalAccountId:x.externalAccountId,spend:null,leads:null,ads:null,integrationStatus:'Not connected',connectedBy:store.users.find(u=>u.role==='Admin')?.id||null});
 }
 for(const x of rows.assignments||[]){const employee=store.users.find(u=>u.email===x.userEmail&&u.role==='Employee');
  if(employee&&store.accounts.some(a=>a.id===x.accountId)&&!store.adAccountAssignments.some(a=>a.accountId===x.accountId&&a.userId===employee.id))store.adAccountAssignments.push({accountId:x.accountId,userId:employee.id,assignedBy:'previous-session',assignedAt:x.assignedAt||null});
 }
}
function save(){
 if(IS_PG||!enabled())return;const obj={version:1,accounts:store.accounts.map(a=>({id:a.id,platform:a.platform,name:a.name,externalAccountId:a.externalAccountId})),assignments:store.adAccountAssignments.map(a=>({accountId:a.accountId,userEmail:store.users.find(u=>u.id===a.userId)?.email||null,assignedAt:a.assignedAt})).filter(x=>x.userEmail)};
 fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(obj),{mode:0o600});fs.renameSync(tmp,file);
}

// ---- postgres: startup hydrate + write-through -----------------------------
async function hydrate(){
 if(!IS_PG)return;
 const {rows:accs}=await pg().query(
  `SELECT id::text AS id, display_number AS "displayNumber", platform, display_name AS name, external_account_id AS "externalAccountId",
          integration_status AS "integrationStatus", connected_by::text AS "connectedBy"
     FROM marketing.ad_accounts ORDER BY created_at`);
 store.accounts.splice(0,store.accounts.length,...accs.map(a=>({id:a.id,platform:PLATFORM_FROM_DB[a.platform]||a.platform,name:a.name,externalAccountId:a.externalAccountId,spend:null,leads:null,ads:null,integrationStatus:a.integrationStatus||'Not connected',connectedBy:a.connectedBy})));
 const {rows:asg}=await pg().query(
  `SELECT ad_account_id::text AS "accountId", user_id::text AS "userId", assigned_by::text AS "assignedBy",
          to_char(assigned_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "assignedAt"
     FROM marketing.ad_account_assignments WHERE revoked_at IS NULL`);
 store.adAccountAssignments.splice(0,store.adAccountAssignments.length,...asg);
}
async function insertAccount(a){
 await pg().query(
  `INSERT INTO marketing.ad_accounts (id, platform, external_account_id, display_name, integration_status, connected_by)
     VALUES ($1,$2,$3,$4,$5,$6)`,
  [a.id, PLATFORM_TO_DB[a.platform]||a.platform, a.externalAccountId||('pending-'+a.id), a.name, a.integrationStatus||'Not connected', a.connectedBy||null]);
}
async function updateAccountName(id,name){await pg().query(`UPDATE marketing.ad_accounts SET display_name=$2 WHERE id=$1`,[id,name]);}
async function setIntegrationStatus(id,status){await pg().query(`UPDATE marketing.ad_accounts SET integration_status=$2 WHERE id=$1`,[id,status]);}
async function removeAccount(id){
 // Never delete mapping events or ad history to make a hard delete succeed.
 // This is atomic: blocked account deletion leaves assignments/mappings intact.
 const {withTransaction}=pg();
 await withTransaction(async client=>{
   await client.query('SELECT id FROM marketing.ad_accounts WHERE id=$1 FOR UPDATE',[id]);
   const history=await client.query(`SELECT 1 FROM marketing.ad_campaigns WHERE account_id=$1 LIMIT 1`,[id]);
   const mappings=await client.query(`SELECT 1 FROM marketing.campaign_mappings WHERE account_id=$1 LIMIT 1`,[id]);
   if(history.rowCount || mappings.rowCount){
     const {HttpError}=require('../utils/http');
     throw new HttpError(409,'Account has historical ads or counsellor mappings and cannot be deleted. Preserve financial history.');
   }
   await client.query('DELETE FROM marketing.ad_account_assignments WHERE ad_account_id=$1',[id]);
   await client.query('DELETE FROM marketing.ad_accounts WHERE id=$1',[id]);
 });
}
async function insertAssignment(accountId,userId,assignedBy,assignedAt){
 await pg().query(
  `INSERT INTO marketing.ad_account_assignments (ad_account_id, user_id, assigned_by, assigned_at)
     VALUES ($1,$2,$3,$4)
   ON CONFLICT (ad_account_id, user_id) DO UPDATE SET revoked_at=NULL, assigned_by=EXCLUDED.assigned_by, assigned_at=EXCLUDED.assigned_at`,
  [accountId,userId,assignedBy||null,assignedAt||new Date().toISOString()]);
}
async function removeAssignment(accountId,userId){await pg().query(`DELETE FROM marketing.ad_account_assignments WHERE ad_account_id=$1 AND user_id=$2`,[accountId,userId]);}

module.exports={load,save,hydrate,file,IS_PG,insertAccount,updateAccountName,setIntegrationStatus,removeAccount,insertAssignment,removeAssignment};
