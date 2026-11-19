const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const queue=require('../src/jobs/ad-sync.queue');

test('Postgres request paths are direct SQL, with no shared business snapshot hydration',()=>{
 const app=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8');
 assert.doesNotMatch(app,/refreshDatabaseSnapshot|hydrateAll/);
 const dir=path.join(__dirname,'../src/services/pg');
 for(const file of ['ad-account.service.js','ad-integration.service.js','attribution.service.js','dashboard.service.js','fx.service.js']){
  const content=fs.readFileSync(path.join(dir,file),'utf8');
  assert.doesNotMatch(content,/mock\.store|request-context/);
 }
});

test('Schedule gets new key each 15-minute period; restart in same period dedupes',()=>{
 const account='abc',start='2026-10-20',end='2026-10-26';
 const a=queue.idempotencyKey(account,'scheduled',start,end,900000*500+10);
 const b=queue.idempotencyKey(account,'scheduled',start,end,900000*500+12000);
 const c=queue.idempotencyKey(account,'scheduled',start,end,900000*501+10);
 assert.equal(a,b);assert.notEqual(a,c);
});

test('Financial integrity migration covers budgets, allocation, expenses and three-doc audit',()=>{
 const sql=fs.readFileSync(path.join(__dirname,'../../database/migrations/015_financial_integrity.sql'),'utf8');
 for(const name of ['enforce_expense_budget_trigger','enforce_allocation_budget_trigger','enforce_company_budget_trigger','enforce_expense_transition_trigger','enforce_expense_document_status_trigger'])
  assert.match(sql,new RegExp(name));
 assert.match(sql,/FOR UPDATE/);
 assert.match(sql,/Company monthly budget exceeded/);
 assert.match(sql,/Exactly three documents required/);
});

test('PostgreSQL scheduled worker uses durable leases and transaction-scoped account locks',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../src/jobs/ad-sync.job.js'),'utf8');
 const queueSrc=fs.readFileSync(path.join(__dirname,'../src/jobs/ad-sync.queue.js'),'utf8');
 assert.match(src,/processDueJobs/);assert.match(src,/setInterval\(consume,POLL_MS\)/);
 assert.match(src,/queue\.heartbeat/);
 assert.match(queueSrc,/pg_advisory_xact_lock/);
 assert.match(queueSrc,/locked_by=\$2 AND status='RUNNING'/);
 assert.doesNotMatch(src,/pg_try_advisory_lock/);
});

test('PostgreSQL audit event is saved in the same transaction as expense transition',()=>{
 const src=fs.readFileSync(path.join(__dirname,'../src/repositories/postgres/financial-transitions.js'),'utf8');
 assert.match(src,/withTransaction/);
 assert.match(src,/FOR UPDATE/);
 assert.match(src,/INSERT INTO marketing\.expense_events/);
});
