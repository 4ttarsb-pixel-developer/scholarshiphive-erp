// Attribution persistence (postgres driver only). On the memory driver the
// attribution service keeps its in-memory arrays exactly as before (dev-only,
// non-persistent). On postgres these write-through to counsellor_refs,
// campaign_mappings, campaign_mapping_shares and mapping_events, and the store
// arrays are hydrated from them at startup so reads stay synchronous.
const store=require('../data/mock.store');
const IS_PG=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres';
const pg=()=>require('../db/pool');
const TS=`to_char({c} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const isoCol=(c)=>TS.replace('{c}',c);

async function hydrate(){
 if(!IS_PG)return;
 const {rows:cs}=await pg().query(
  `SELECT id::text AS id, display_number AS "displayNumber", external_id AS "externalId", name, department, work_contact_number AS "workContactNumber",
          status, source_system AS source, created_by::text AS "createdBy", ${isoCol('created_at')} AS "createdAt"
     FROM marketing.counsellor_refs ORDER BY created_at`);
 store.counsellors.splice(0,store.counsellors.length,...cs);

 const {rows:maps}=await pg().query(
  `SELECT m.id::text AS id, m.account_id::text AS "accountId", m.campaign_id AS "campaignId",
          m.campaign_label AS "campaignLabel", m.campaign_tracking_number AS "campaignTrackingNumber",
          ${isoCol('m.created_at')} AS "createdAt", ${isoCol('m.updated_at')} AS "updatedAt",
          m.mapped_by::text AS "updatedBy",
          COALESCE(json_agg(json_build_object('counsellorId', s.counsellor_ref_id::text, 'basisPoints', s.basis_points))
                   FILTER (WHERE s.counsellor_ref_id IS NOT NULL), '[]') AS shares
     FROM marketing.campaign_mappings m
     LEFT JOIN marketing.campaign_mapping_shares s ON s.mapping_id = m.id
    GROUP BY m.id ORDER BY m.created_at`);
 store.campaignAllocations.splice(0,store.campaignAllocations.length,...maps);

 const {rows:ev}=await pg().query(
  `SELECT id::text AS id, account_id::text AS "accountId", campaign_id AS "campaignId",
          counsellor_ref_id::text AS "counsellorId", actor_id::text AS "actorId", action,
          before_after, ${isoCol('happened_at')} AS at
     FROM marketing.mapping_events ORDER BY happened_at`);
 store.attributionEvents.splice(0,store.attributionEvents.length,...ev.map(e=>({...e,...(e.before_after||{})})));
}

async function writeEvent(client,e){
 const {id,accountId,campaignId,counsellorId,actorId,action,at,...rest}=e;
 await client.query(
  `INSERT INTO marketing.mapping_events (account_id, campaign_id, counsellor_ref_id, actor_id, action, before_after, happened_at)
     VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, now()))`,
  [accountId||null, campaignId||null, counsellorId||null, actorId||null, action, JSON.stringify(rest||{}), at||null]);
}
async function insertCounsellor(c,event=null){
 await pg().withTransaction(async client=>{
  await client.query(
   `INSERT INTO marketing.counsellor_refs (id, source_system, external_id, name, department, work_contact_number, status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
   [c.id, c.source||'manual_pending_calling_sync', c.externalId, c.name, c.department, c.workContactNumber||null, c.status||'Active', c.createdBy||null]);
  if(event)await writeEvent(client,event);
 });
}
async function updateCounsellorStatus(id,status,event=null){
 await pg().withTransaction(async client=>{
  await client.query(`UPDATE marketing.counsellor_refs SET status=$2, updated_at=now() WHERE id=$1`,[id,status]);
  if(event)await writeEvent(client,event);
 });
}
async function saveMapping(m,event=null){
 const {withTransaction}=pg();
 await withTransaction(async client=>{
  const r=await client.query(
   `INSERT INTO marketing.campaign_mappings (id, account_id, campaign_id, campaign_label, campaign_tracking_number, status, mapped_by)
      VALUES ($1,$2,$3,$4,$5,'Confirmed',$6)
    ON CONFLICT (account_id, campaign_id) DO UPDATE SET
      campaign_label=EXCLUDED.campaign_label, campaign_tracking_number=EXCLUDED.campaign_tracking_number,
      mapping_version=marketing.campaign_mappings.mapping_version+1, mapped_by=EXCLUDED.mapped_by, updated_at=now()
    RETURNING id`,
   [m.id, m.accountId, m.campaignId, m.campaignLabel||null, m.campaignTrackingNumber||null, m.updatedBy||null]);
  const mappingId=r.rows[0].id;
  await client.query(`DELETE FROM marketing.campaign_mapping_shares WHERE mapping_id=$1`,[mappingId]);
  for(const s of m.shares)await client.query(
   `INSERT INTO marketing.campaign_mapping_shares (mapping_id, counsellor_ref_id, basis_points) VALUES ($1,$2,$3)`,
   [mappingId, s.counsellorId, s.basisPoints]);
  if(event)await writeEvent(client,event);
 });
}
async function removeMapping(accountId,campaignId,event=null){
 const {withTransaction}=pg();
 await withTransaction(async client=>{
  const r=await client.query(`SELECT id FROM marketing.campaign_mappings WHERE account_id=$1 AND campaign_id=$2`,[accountId,campaignId]);
  if(r.rowCount){await client.query(`DELETE FROM marketing.campaign_mapping_shares WHERE mapping_id=$1`,[r.rows[0].id]);
   await client.query(`DELETE FROM marketing.campaign_mappings WHERE id=$1`,[r.rows[0].id]);}
  if(event)await writeEvent(client,event);
 });
}
async function insertEvent(e){await pg().withTransaction(client=>writeEvent(client,e));}
module.exports={IS_PG,hydrate,insertCounsellor,updateCounsellorStatus,saveMapping,removeMapping,insertEvent};
