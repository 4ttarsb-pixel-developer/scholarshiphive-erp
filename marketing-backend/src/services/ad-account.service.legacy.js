// Ad account catalog. Reads stay synchronous off the in-memory mirror; writes
// persist via the catalog store (JSON on the memory driver, PostgreSQL on the
// postgres driver). No OAuth/platform tokens are stored here.
const { randomUUID } = require('node:crypto');
const store = require('../data/mock.store');
const { HttpError, requiredText } = require('../utils/http');
const catalog=require('./ad-account-catalog.store');
catalog.load();
const platforms = ['Meta Ads', 'Google Ads', 'TikTok Ads'];
const integration=()=>require('./ad-integration.service');
const find = id => store.accounts.find(a => a.id === id);
// Persist a mutation: targeted DB write on postgres, whole-file save on memory.
async function persistCreate(a){ if(catalog.IS_PG) await catalog.insertAccount(a); else catalog.save(); }
async function persistName(id,name){ if(catalog.IS_PG) await catalog.updateAccountName(id,name); else catalog.save(); }
async function persistRemove(id){ if(catalog.IS_PG) await catalog.removeAccount(id); else catalog.save(); }
async function persistAssign(accountId,userId,by,at){ if(catalog.IS_PG) await catalog.insertAssignment(accountId,userId,by,at); else catalog.save(); }
async function persistUnassign(accountId,userId){ if(catalog.IS_PG) await catalog.removeAssignment(accountId,userId); else catalog.save(); }
function assignedTo(accountId) {
  return store.adAccountAssignments.filter(a => a.accountId === accountId).map(a => {
    const user = store.users.find(u => u.id === a.userId);
    return user ? { userId:user.id, userName:user.name, email:user.email, status:user.status } : null;
  }).filter(Boolean);
}
function sanitize(account, user, period={}) {
  if (user.role === 'Admin') return { ...account, ...integration().status(account.id,user,period), assignedEmployees: assignedTo(account.id) };
  const {id, displayNumber, platform, name, externalAccountId, spend, leads, ads, integrationStatus} = account;
  return {id, displayNumber, platform, name, externalAccountId, spend, leads, ads, ...integration().status(id,user,period), access:'read-only'}; // Never expose management metadata or employee assignments.
}
function isVisible(account, user) {
  return user.role === 'Admin' || store.adAccountAssignments.some(a => a.accountId===account.id && a.userId===user.id && user.status==='Active');
}
function all(user,period={}) { return store.accounts.filter(a=>isVisible(a,user)).map(a=>sanitize(a,user,period)); }
function get(id, user) {
  const account=find(id);
  if(!account || !isVisible(account,user)) throw new HttpError(404,'Ad account not found');
  return sanitize(account,user);
}
async function create(body, user) {
  const name=requiredText(body?.name,'Account name');
  if(name.length>120)throw new HttpError(400,'Account name must be 120 characters or fewer');
  const platform=body?.platform;
  if(!platforms.includes(platform))throw new HttpError(400,'Choose Meta Ads, Google Ads or TikTok Ads');
  const ext=typeof body?.externalAccountId==='string'?body.externalAccountId.trim():'';
  if(ext.length>100)throw new HttpError(400,'External account reference is too long');
  if(ext && store.accounts.some(a=>a.platform===platform&&a.externalAccountId===ext))throw new HttpError(409,'External account reference already registered');
  const account={id:randomUUID(),platform,name,externalAccountId:ext || null,spend:null,leads:null,ads:null,integrationStatus:'Not connected',connectedBy:user.id};
  if(catalog.IS_PG){await persistCreate(account);await catalog.hydrate();return sanitize(find(account.id),user);}
  store.accounts.push(account);await persistCreate(account);
  return sanitize(account,user);
}
async function update(id, body, user) {
  const account=find(id);
  if(!account)throw new HttpError(404,'Ad account not found');
  if(body?.name!==undefined){const name=requiredText(body.name,'Account name');if(name.length>120)throw new HttpError(400,'Account name is too long'); if(catalog.IS_PG)await persistName(id,name);account.name=name;if(!catalog.IS_PG)await persistName(id,name);}
  return sanitize(account,user);
}
async function remove(id) {
  const index=store.accounts.findIndex(a=>a.id===id);
  if(index<0)throw new HttpError(404,'Ad account not found');
  if(catalog.IS_PG)await persistRemove(id);
  store.accounts.splice(index,1);
  for(let i=store.adAccountAssignments.length-1;i>=0;i--)if(store.adAccountAssignments[i].accountId===id)store.adAccountAssignments.splice(i,1);
  for(let i=store.campaignAllocations.length-1;i>=0;i--)if(store.campaignAllocations[i].accountId===id)store.campaignAllocations.splice(i,1);
  integration().purge(id);
  if(!catalog.IS_PG)await persistRemove(id);
  return { removed:true, id };
}
async function assign(id, userId, admin) {
  const account=find(id);
  if(!account)throw new HttpError(404,'Ad account not found');
  const user=store.users.find(u=>u.id===userId);
  if(!user || user.role!=='Employee' || user.status!=='Active')throw new HttpError(400,'Select an active employee');
  if(store.adAccountAssignments.some(a=>a.accountId===id&&a.userId===userId))throw new HttpError(409,'Account already assigned to employee');
  const assignedAt=new Date().toISOString();
  if(catalog.IS_PG)await persistAssign(id,userId,admin.id,assignedAt);
  store.adAccountAssignments.push({accountId:id,userId,assignedBy:admin.id,assignedAt});
  if(!catalog.IS_PG)await persistAssign(id,userId,admin.id,assignedAt);
  return sanitize(account,admin);
}
async function unassign(id,userId,admin) {
  if(!find(id))throw new HttpError(404,'Ad account not found');
  const index=store.adAccountAssignments.findIndex(a=>a.accountId===id&&a.userId===userId);
  if(index===-1)throw new HttpError(404,'Assignment not found');
  if(catalog.IS_PG)await persistUnassign(id,userId);
  store.adAccountAssignments.splice(index,1);
  if(!catalog.IS_PG)await persistUnassign(id,userId);
  return sanitize(find(id),admin);
}
module.exports={all,get,create,update,remove,assign,unassign};
