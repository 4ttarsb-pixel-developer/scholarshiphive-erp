// One-time migration of legacy protected filesystem audit bytes into PostgreSQL.
// Safe to rerun; never removes files. Rejects path escape, checksum mismatch,
// and incomplete payloads. Do not remove var/documents until verification passes.
require('dotenv').config();
const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');
if((process.env.PERSISTENCE_DRIVER||'').toLowerCase()!=='postgres')throw new Error('PostgreSQL mode required');
const db=require('../src/db/pool');
const BASE=path.resolve(__dirname,'..',process.env.DOCUMENT_STORE_PATH||'./var/documents');
(async()=>{let moved=0,unavailable=0;
 try{
  const {rows}=await db.query(`SELECT id::text id,file_key,sha256,bytes_size FROM marketing.expense_documents WHERE content_bytes IS NULL`);
  for(const r of rows){
   const name=String(r.file_key||'');const full=path.resolve(BASE,name);
   if(!name||name.startsWith('db:')||(!full.startsWith(BASE+path.sep)))throw new Error('Unsafe or missing legacy document path');
   if(!fs.existsSync(full)){unavailable++;console.error('Missing legacy payload for record:',r.id);continue;}
   const bytes=fs.readFileSync(full);const sha=createHash('sha256').update(bytes).digest('hex');
   if(bytes.length!==Number(r.bytes_size)||sha!==r.sha256)throw new Error(`Payload integrity check failed for document ID ${r.id}`);
   await db.query(`UPDATE marketing.expense_documents SET content_bytes=$2 WHERE id=$1 AND content_bytes IS NULL`,[r.id,bytes]);moved++;
  }
  const pending=await db.query(`SELECT count(*)::int n FROM marketing.expense_documents WHERE content_bytes IS NULL`);
  console.log('Imported:',moved,'unavailable:',unavailable,'remaining without DB bytes:',pending.rows[0].n);
  if(pending.rows[0].n)process.exitCode=2;
 }catch(err){console.error('Document migration failed:',err.message);process.exitCode=1;}finally{await db.close();}
})();
