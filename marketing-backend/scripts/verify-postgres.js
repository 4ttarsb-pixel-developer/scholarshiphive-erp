// Read-only acceptance probe for user's own PostgreSQL 18 instance.
// Never displays passwords, tokens, lead details or document content.
require('dotenv').config();
if((process.env.PERSISTENCE_DRIVER||'').toLowerCase()!=='postgres'){
 console.error('Set PERSISTENCE_DRIVER=postgres in backend/.env first.');process.exit(1);
}
const db=require('../src/db/pool');
(async()=>{
 try{
  const identity=await db.query('SELECT current_database() db, current_user db_user');
  const active=identity.rows[0];
  if(active.db!==(process.env.DB_NAME||'mea_db'))throw new Error('Connected to unexpected database');
  const migrations=await db.query(`SELECT filename FROM marketing.schema_migrations ORDER BY filename`);
  const required=['014_public_reference_numbers.sql','015_financial_integrity.sql','016_sync_stats.sql','017_document_bytes.sql'];
  const missing=required.filter(x=>!migrations.rows.some(r=>r.filename===x));
  const triggers=await db.query(`SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='marketing' AND NOT t.tgisinternal`);
  const expected=['enforce_expense_budget_trigger','enforce_allocation_budget_trigger',
    'enforce_company_budget_trigger','enforce_expense_transition_trigger','enforce_expense_document_status_trigger'];
  const absent=expected.filter(x=>!triggers.rows.some(t=>t.tgname===x));
  const counts=await db.query(`SELECT
    (SELECT count(*)::int FROM marketing.users) users,
    (SELECT count(*)::int FROM marketing.ad_accounts) accounts,
    (SELECT count(*)::int FROM marketing.ads) ads,
    (SELECT count(*)::int FROM marketing.ad_sync_jobs) jobs,
    (SELECT count(*)::int FROM marketing.expenses) expenses`);
  const missingDocs=await db.query(`SELECT count(*)::int n FROM marketing.expense_documents WHERE content_bytes IS NULL`);
  const overs=await db.query(`SELECT count(*)::int n FROM marketing.monthly_budgets b
    WHERE b.amount_pkr < (SELECT COALESCE(sum(amount_pkr),0) FROM marketing.expenses e
      WHERE e.subcategory_id=b.subcategory_id AND e.occurred_on >= b.month
       AND e.occurred_on < b.month+interval '1 month'
       AND e.status IN ('Pending','In Review','Approved'))`);
  console.log('DB connection:',active.db,'as',active.db_user);
  console.log('Applied migration count:',migrations.rowCount);
  console.log('Required migrations:',missing.length?'MISSING '+missing.join(', '):'OK');
  console.log('Financial triggers:',absent.length?'MISSING '+absent.join(', '):'OK');
  console.log('Counts (no records shown):',counts.rows[0]);
  console.log('Existing company budget overcommit count:',overs.rows[0].n);
  console.log('Legacy documents missing DB payload:',missingDocs.rows[0].n);
  if(missing.length||absent.length||overs.rows[0].n||missingDocs.rows[0].n)process.exitCode=2;
 }catch(err){console.error('PostgreSQL verification failed:',err.message);process.exitCode=1;}
 finally{await db.close();}
})();
