const {randomUUID}=require('node:crypto');
const repo=require('../repositories');
const auth=require('./auth.service');
const {HttpError,requiredText}=require('../utils/http');
const {passwordError}=require('../utils/password-policy');
async function all(){return (await repo.users.list()).map(auth.publicUser);}
async function create(body){
  const name=requiredText(body?.name,'Name');
  if(typeof body?.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email))throw new HttpError(400,'Valid email required');
  const email=body.email.trim().toLowerCase();
  const users=await repo.users.list();
  if(users.some(u=>u.email===email))throw new HttpError(409,'Email already exists');
  if(!['Admin','Employee'].includes(body?.role))throw new HttpError(400,'Role must be Admin or Employee');
  // Validate the password BEFORE creating the user so we never persist a user without credentials.
  const pwError=passwordError(body?.password);
  if(pwError)throw new HttpError(400,pwError);
  const row={id:randomUUID(),name,email,role:body.role,status:'Active',initials:name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()};
  await repo.users.insert(row);
  await auth.setPassword(row.id,body.password);
  return auth.publicUser(row);
}
async function status(id,newStatus,actorId){
  const users=await repo.users.list();
  const user=users.find(u=>u.id===id);
  if(!user)throw new HttpError(404,'User not found');
  if(!['Active','Inactive'].includes(newStatus))throw new HttpError(400,'Status must be Active or Inactive');
  if(user.id===actorId && newStatus==='Inactive')throw new HttpError(409,'You cannot deactivate your own account');
  if(user.role==='Admin' && newStatus==='Inactive' && users.filter(u=>u.role==='Admin'&&u.status==='Active').length<=1)throw new HttpError(409,'Cannot deactivate the last active admin');
  await repo.users.setStatus(id,newStatus);
  user.status=newStatus;
  if(newStatus==='Inactive')await auth.revokeUser(user.id);
  return auth.publicUser(user);
}
module.exports={all,create,status};
