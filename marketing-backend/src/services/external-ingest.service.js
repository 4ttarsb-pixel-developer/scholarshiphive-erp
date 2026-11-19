// Calling + Revenue read-only ingestion into MEA-owned shadow tables.
// MEA never writes to the external teams' systems; it upserts copies keyed by
// (source_system, external_id). This is the adapter layer only — it is NOT a live
// connector. A real connector (or central-DB read-only view) calls these methods
// once the data contract is agreed; until then status() reports NOT CONNECTED.
// Postgres-only: external data has no meaning on the dev memory driver.
const pg=()=>require('../db/pool');
const IS_PG=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres';
function requirePg(){ if(!IS_PG) throw new Error('External ingestion requires the postgres driver'); }

async function registerSource(name,{apiContractVersion=null,authReference=null,pollingIntervalSeconds=null,enabled=false}={}){
 requirePg();
 await pg().query(
  `INSERT INTO marketing.integration_sources (source_name, api_contract_version, auth_reference, polling_interval_seconds, enabled)
     VALUES ($1,$2,$3,$4,$5)
   ON CONFLICT (source_name) DO UPDATE SET api_contract_version=EXCLUDED.api_contract_version,
     auth_reference=EXCLUDED.auth_reference, polling_interval_seconds=EXCLUDED.polling_interval_seconds, enabled=EXCLUDED.enabled`,
  [name,apiContractVersion,authReference,pollingIntervalSeconds,enabled]);
}
async function upsertCounsellorRef(source,c){
 requirePg();
 const status=String(c.status||'Active').toLowerCase()==='inactive'?'Inactive':'Active';
 const r=await pg().query(
  `INSERT INTO marketing.counsellor_refs (source_system, external_id, name, department, status, manual_mapping_flag, updated_at)
     VALUES ($1,$2,$3,$4,$5,false,now())
   ON CONFLICT (source_system, external_id) DO UPDATE SET name=EXCLUDED.name, department=EXCLUDED.department,
     status=EXCLUDED.status, manual_mapping_flag=false, updated_at=now()
   RETURNING id::text id`,
  [source,c.external_id,c.name,c.department||'Calling',status]);
 await linkExternal(source,c.external_id,'counsellor',r.rows[0].id);
 return r.rows[0].id;
}
async function upsertLead(source,lead){
 requirePg();
 // Resolve the counsellor shadow row if one exists (never guessed).
 let counsellorRefId=null;
 if(lead.counsellor_id){const cr=await pg().query(`SELECT id FROM marketing.counsellor_refs WHERE source_system=$1 AND external_id=$2`,[source,lead.counsellor_id]);counsellorRefId=cr.rows[0]?.id||null;}
 const r=await pg().query(
  `INSERT INTO marketing.external_leads (source_system, external_lead_id, external_campaign_id, source_platform, source_account_id, counsellor_ref_id, status, qualified_at, created_at, updated_at, ingested_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
   ON CONFLICT (source_system, external_lead_id) DO UPDATE SET external_campaign_id=EXCLUDED.external_campaign_id,
     source_platform=EXCLUDED.source_platform, source_account_id=EXCLUDED.source_account_id,
     counsellor_ref_id=EXCLUDED.counsellor_ref_id, status=EXCLUDED.status, qualified_at=EXCLUDED.qualified_at,
     updated_at=EXCLUDED.updated_at, ingested_at=now()
   RETURNING id::text id`,
  [source,lead.external_lead_id,lead.campaign_id||lead.external_campaign_id||null,lead.source_platform||null,lead.source_account_id||null,counsellorRefId,lead.status||null,lead.qualified_at||null,lead.created_at||null,lead.updated_at||null]);
 await linkExternal(source,lead.external_lead_id,'lead',r.rows[0].id);
 return r.rows[0].id;
}
async function upsertSale(source,sale){
 requirePg();
 const r=await pg().query(
  `INSERT INTO marketing.external_sales (source_system, external_sale_id, external_lead_id, counsellor_external_id, amount_original, currency, status, sold_at, updated_at, ingested_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
   ON CONFLICT (source_system, external_sale_id) DO UPDATE SET external_lead_id=EXCLUDED.external_lead_id,
     counsellor_external_id=EXCLUDED.counsellor_external_id, amount_original=EXCLUDED.amount_original,
     currency=EXCLUDED.currency, status=EXCLUDED.status, sold_at=EXCLUDED.sold_at, updated_at=EXCLUDED.updated_at, ingested_at=now()
   RETURNING id::text id`,
  [source,sale.external_sale_id,sale.lead_id||sale.external_lead_id||null,sale.counsellor_id||null,sale.amount??null,sale.currency||null,sale.status||null,sale.sold_at||null,sale.updated_at||null]);
 await linkExternal(source,sale.external_sale_id,'sale',r.rows[0].id);
 return r.rows[0].id;
}
async function linkExternal(source,externalId,entityType,localId){
 await pg().query(
  `INSERT INTO marketing.external_id_links (source_system, external_id, entity_type, local_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT (source_system, external_id, entity_type) DO UPDATE SET local_id=EXCLUDED.local_id`,
  [source,externalId,entityType,localId]);
}
async function recordRun(source,{cursor=null,rowCount=0,failureCount=0,payloadHash=null,error=null,startedAt=null,completedAt=null}={}){
 requirePg();
 await pg().query(
  `INSERT INTO marketing.ingest_runs (source_system, cursor, row_count, failure_count, payload_hash, error, started_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7::timestamptz, now()), $8)`,
  [source,cursor,rowCount,failureCount,payloadHash,error,startedAt,completedAt]);
}
// Reporting status for the dashboard/attribution: connected only when the source
// is registered AND enabled. Counts come from the shadow tables.
async function status(){
 if(!IS_PG) return {calling:{connected:false,status:'Memory driver — external ingestion not available'},revenue:{connected:false,status:'Memory driver — external ingestion not available'}};
 const src=Object.fromEntries((await pg().query(`SELECT source_name, enabled FROM marketing.integration_sources`)).rows.map(r=>[r.source_name,r.enabled]));
 const leads=(await pg().query(`SELECT count(*)::int n FROM marketing.external_leads`)).rows[0].n;
 const sales=(await pg().query(`SELECT count(*)::int n FROM marketing.external_sales`)).rows[0].n;
 return {
  calling:{connected:!!src.calling,status:src.calling?'Connected (contract agreed)':'NOT CONNECTED — pending Calling Team API/contract',leadRecords:leads},
  revenue:{connected:!!src.revenue,status:src.revenue?'Connected (contract agreed)':'NOT CONNECTED — pending Revenue Team API/contract',saleRecords:sales},
 };
}
module.exports={IS_PG,registerSource,upsertCounsellorRef,upsertLead,upsertSale,recordRun,status};
