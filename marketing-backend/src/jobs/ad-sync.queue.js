// Durable ad-sync job queue (postgres). Replaces per-request/in-process scheduling
// with persisted, de-duplicated, leased jobs so multiple workers cannot process
// the same work twice (plan test DB-10). The claim uses FOR UPDATE SKIP LOCKED
// plus a lease (locked_until); stale leases are reclaimed automatically.
const pg=()=>require('../db/pool');
const IS_PG=(process.env.PERSISTENCE_DRIVER||'memory').toLowerCase()==='postgres';
const MAX_ATTEMPTS=3;

function idempotencyKey(accountId,reason,startDate,endDate,now=Date.now()){
 // Each scheduled 15-minute interval is a NEW job, but retry/restart within
 // the same interval must not enqueue a duplicate.
 const bucket=reason==='scheduled'?Math.floor(now/900000):Math.floor(now/30000);
 return `${accountId}|${reason}|${startDate}|${endDate}|${bucket}`;
}

// Enqueue a job; identical in-flight work is de-duplicated by idempotency_key.
async function enqueue(accountId,{startDate,endDate,reason='scheduled',dueAt=null}={}){
 if(!IS_PG)return null;
 const key=idempotencyKey(accountId,reason,startDate,endDate);
 const r=await pg().query(
  `INSERT INTO marketing.ad_sync_jobs (account_id,start_date,end_date,reason,status,due_at,idempotency_key)
     VALUES ($1,$2,$3,$4,'PENDING', COALESCE($5::timestamptz, now()), $6)
   ON CONFLICT (idempotency_key) DO NOTHING
   RETURNING id::text id`,
  [accountId,startDate,endDate,reason,dueAt,key]);
 return r.rows[0]?.id||null;
}

// Atomically claim one due job (PENDING, or RUNNING with an expired lease).
async function claim(workerId,leaseSeconds=180){
 if(!IS_PG)return null;
 return pg().withTransaction(async client=>{
  // Skip accounts with a live lease. Two workers may still choose different
  // queued jobs for one account concurrently, so the transaction-scoped
  // advisory lock below serializes the final claim decision (pooler-safe).
  const candidate=await client.query(
   `SELECT j.id, j.account_id::text AS "accountId"
      FROM marketing.ad_sync_jobs j
     WHERE (j.status='PENDING' OR (j.status='RUNNING' AND j.locked_until < now()))
       AND j.due_at <= now()
       AND NOT EXISTS (
         SELECT 1 FROM marketing.ad_sync_jobs active
          WHERE active.account_id=j.account_id AND active.id<>j.id
            AND active.status='RUNNING' AND active.locked_until > now()
       )
     ORDER BY j.due_at, j.created_at
     LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
  const picked=candidate.rows[0];
  if(!picked)return null;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[picked.accountId]);
  const active=await client.query(
   `SELECT 1 FROM marketing.ad_sync_jobs
     WHERE account_id=$1 AND id<>$2 AND status='RUNNING' AND locked_until > now()
     LIMIT 1`,[picked.accountId,picked.id]);
  if(active.rowCount)return null;
  const updated=await client.query(
   `UPDATE marketing.ad_sync_jobs
       SET status='RUNNING', locked_until=now()+($1 || ' seconds')::interval,
           locked_by=$2, attempt_count=attempt_count+1, updated_at=now()
     WHERE id=$3
     RETURNING id::text id, account_id::text "accountId", to_char(start_date,'YYYY-MM-DD') "startDate",
               to_char(end_date,'YYYY-MM-DD') "endDate", reason, attempt_count "attemptCount"`,
   [String(leaseSeconds),workerId,picked.id]);
  return updated.rows[0]||null;
 });
}

async function accountSyncState(accountId){
 if(!IS_PG)return {inProgress:false};
 const {rows}=await pg().query(`SELECT status FROM marketing.ad_sync_jobs
    WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1`,[accountId]);
 const status=rows[0]?.status||null;
 return {status,inProgress:status==='PENDING'||status==='RUNNING'};
}
async function heartbeat(jobId,workerId,leaseSeconds=180){
 if(!IS_PG)return;
 await pg().query(`UPDATE marketing.ad_sync_jobs SET locked_until=now()+($3 || ' seconds')::interval,
      updated_at=now() WHERE id=$1 AND locked_by=$2 AND status='RUNNING'`,
      [jobId,workerId,String(leaseSeconds)]);
}
async function complete(jobId,workerId){
 if(!IS_PG)return;
 const r=await pg().query(`UPDATE marketing.ad_sync_jobs SET status='SUCCEEDED', locked_until=NULL, locked_by=NULL, last_error=NULL, updated_at=now() WHERE id=$1 AND locked_by=$2 AND status='RUNNING'`,[jobId,workerId]);
 return r.rowCount===1;
}

// Retry with linear backoff until MAX_ATTEMPTS, then mark FAILED.
async function fail(jobId,error,workerId){
 if(!IS_PG)return;
 const r=await pg().query(
  `UPDATE marketing.ad_sync_jobs
      SET status = CASE WHEN attempt_count >= $3 THEN 'FAILED' ELSE 'PENDING' END,
          due_at = CASE WHEN attempt_count >= $3 THEN due_at ELSE now() + (attempt_count || ' minutes')::interval END,
          locked_until=NULL, locked_by=NULL, last_error=$4, updated_at=now()
    WHERE id=$1 AND locked_by=$2 AND status='RUNNING'`,
  [jobId,workerId,MAX_ATTEMPTS,String(error||'').slice(0,500)]);
 return r.rowCount===1;
}

module.exports={IS_PG,enqueue,claim,accountSyncState,heartbeat,complete,fail,idempotencyKey,MAX_ATTEMPTS};
