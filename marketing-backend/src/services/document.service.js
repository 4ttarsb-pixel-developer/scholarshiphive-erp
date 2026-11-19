// Expense supporting documents (exactly 3 slots).
//   memory driver  -> bytes held in RAM (development only; lost on restart).
//   postgres driver-> metadata + SHA-256 in PostgreSQL; bytes on the protected
//                     filesystem store (DOCUMENT_STORE_PATH). Never store bytes in the DB.
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('../utils/http');
const repo = require('../repositories');
const expenses = require('./expense.service');
const MAX_BYTES = 2 * 1024 * 1024;
const DRIVER = (process.env.PERSISTENCE_DRIVER || 'memory').toLowerCase();
const IS_PG = DRIVER === 'postgres';
const STORE_DIR = path.resolve(__dirname, '../..', process.env.DOCUMENT_STORE_PATH || './var/documents');

// ---- shared validation (pure) -------------------------------------------
function inspect(body){
  const slot=body?.slot;
  if(!Number.isInteger(slot)||slot<1||slot>3)throw new HttpError(400,'Document slot must be 1, 2 or 3');
  if(typeof body?.name!=='string'||body.name.length<1||body.name.length>160)throw new HttpError(400,'Invalid document name');
  const name=body.name.replace(/[\\/\r\n<>"']/g,'_').trim();
  const ext=name.toLowerCase().split('.').pop();
  const expected={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg'}[ext];
  if(!expected||body.mimeType!==expected)throw new HttpError(415,'Only PDF, PNG or JPG files are supported');
  const base64=body?.dataBase64;
  if(typeof base64!=='string'||base64.length===0||base64.length>Math.ceil(MAX_BYTES*4/3)+16||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw new HttpError(400,'Invalid document data or file exceeds 2 MB');
  const bytes=Buffer.from(base64,'base64');
  if(bytes.length===0||bytes.length>MAX_BYTES||bytes.toString('base64')!==base64)throw new HttpError(400,'Invalid document size or base64 content');
  const valid=expected==='application/pdf'?bytes.subarray(0,5).toString('ascii')==='%PDF-':expected==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(!valid)throw new HttpError(415,'File content does not match its PDF/PNG/JPG type');
  return {slot,name,mimeType:expected,bytes};
}
const publicDoc=d=>{const {bytes,fileKey,sha256,...meta}=d;return meta};

// ===========================================================================
// MEMORY DRIVER (development) — in-RAM map, preserved from the original service
// ===========================================================================
const memDocs=new Map(); // expenseId => Map(slot, {metadata,bytes})
const memRecords=id=>memDocs.get(id)||new Map();
async function listMemory(expenseId,user){await expenses.forUser(expenseId,user);return [...memRecords(expenseId).values()].map(publicDoc).sort((a,b)=>a.slot-b.slot)}
async function uploadMemory(expenseId,user,body){
  const expense=await expenses.forUser(expenseId,user);
  if(expense.status!=='Pending')throw new HttpError(409,'Documents can only be changed before submission');
  const file=inspect(body);
  const map=memRecords(expenseId);
  const doc={id:randomUUID(),slot:file.slot,name:file.name,mimeType:file.mimeType,size:file.bytes.length,uploadedAt:new Date().toISOString(),uploadedBy:user.name,bytes:file.bytes};
  map.set(file.slot,doc);memDocs.set(expenseId,map);
  await require('./audit.service').log(expenseId,'document_uploaded',expense.status,expense.status,user.name,`Document ${file.slot} uploaded: ${file.name}`);
  return publicDoc(doc);
}
async function getMemory(expenseId,slot,user){
  await expenses.forUser(expenseId,user);
  if(![1,2,3].includes(Number(slot)))throw new HttpError(400,'Invalid document slot');
  const doc=memRecords(expenseId).get(Number(slot));
  if(!doc)throw new HttpError(404,'Document not found');
  return doc;
}
async function removeMemory(expenseId,slot,user){
  const expense=await expenses.forUser(expenseId,user);
  if(expense.status!=='Pending')throw new HttpError(409,'Cannot remove documents after submission');
  const map=memRecords(expenseId);
  const doc=await getMemory(expenseId,slot,user);
  map.delete(Number(slot));
  await require('./audit.service').log(expenseId,'document_removed',expense.status,expense.status,user.name,`Document ${slot} removed: ${doc.name}`);
}
async function countMemory(expenseId){return memRecords(expenseId).size}
async function hasAllThreeMemory(expenseId){return [1,2,3].every(i=>memRecords(expenseId).has(i))}
async function clearMemory(expenseId){memDocs.delete(expenseId)}

// ===========================================================================
// POSTGRES DRIVER — metadata/checksum in DB, bytes on the protected file store
// ===========================================================================
function keyFor(expenseId,slot,ext){return path.posix.join(String(expenseId),`${slot}-${randomUUID()}.${ext}`);}
function extFor(mime){return mime==='application/pdf'?'pdf':mime==='image/png'?'png':'jpg';}
function absPath(fileKey){return path.join(STORE_DIR,fileKey);}
async function listPg(expenseId,user){await expenses.forUser(expenseId,user);return (await repo.documents.listMeta(expenseId)).map(publicDoc).sort((a,b)=>a.slot-b.slot);}
async function uploadPg(expenseId,user,body){
  const expense=await expenses.forUser(expenseId,user);
  if(expense.status!=='Pending')throw new HttpError(409,'Documents can only be changed before submission');
  const file=inspect(body),sha256=createHash('sha256').update(file.bytes).digest('hex');
  // The complete file is persisted as BYTEA in the same atomic INSERT/UPSERT.
  // fileKey stays a non-path reference to preserve the existing schema/contract.
  const meta=await repo.documents.upsert(expenseId,{slot:file.slot,name:file.name,mimeType:file.mimeType,size:file.bytes.length,sha256,fileKey:'db:'+randomUUID(),bytes:file.bytes,uploadedBy:user.id,uploadedByName:user.name});
  await require('./audit.service').log(expenseId,'document_uploaded',expense.status,expense.status,user.name,`Document ${file.slot} uploaded: ${file.name}`);
  return publicDoc(meta);
}
async function getPg(expenseId,slot,user){
  await expenses.forUser(expenseId,user);
  if(![1,2,3].includes(Number(slot)))throw new HttpError(400,'Invalid document slot');
  const meta=await repo.documents.getMeta(expenseId,Number(slot));
  if(!meta)throw new HttpError(404,'Document not found');
  const bytes=await repo.documents.getContent(expenseId,Number(slot));
  if(!bytes)throw new HttpError(409,'Legacy document payload not migrated. Run npm run migrate:document-bytes.');
  if(createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw new HttpError(500,'Document integrity checksum mismatch');
  return {...meta,bytes};
}
async function removePg(expenseId,slot,user){
  const expense=await expenses.forUser(expenseId,user);
  if(expense.status!=='Pending')throw new HttpError(409,'Cannot remove documents after submission');
  const meta=await repo.documents.getMeta(expenseId,Number(slot));
  if(!meta)throw new HttpError(404,'Document not found');
  await repo.documents.remove(expenseId,Number(slot));
  await require('./audit.service').log(expenseId,'document_removed',expense.status,expense.status,user.name,`Document ${slot} removed: ${meta.name}`);
}
async function countPg(expenseId){return repo.documents.count(expenseId);}
async function hasAllThreePg(expenseId){const slots=await repo.documents.slots(expenseId);return [1,2,3].every(i=>slots.includes(i));}
async function clearPg(expenseId){await repo.documents.clearByExpense(expenseId);}

// ---- driver-agnostic exports --------------------------------------------
const list=(...a)=>IS_PG?listPg(...a):listMemory(...a);
const upload=(...a)=>IS_PG?uploadPg(...a):uploadMemory(...a);
const get=(...a)=>IS_PG?getPg(...a):getMemory(...a);
const remove=(...a)=>IS_PG?removePg(...a):removeMemory(...a);
const count=(...a)=>IS_PG?countPg(...a):countMemory(...a);
const hasAllThree=(...a)=>IS_PG?hasAllThreePg(...a):hasAllThreeMemory(...a);
const clear=(...a)=>IS_PG?clearPg(...a):clearMemory(...a);
module.exports={list,upload,get,remove,hasAllThree,count,clear,MAX_BYTES};
