const repo=require('../repositories');
const {randomUUID}=require('node:crypto');
const {HttpError}=require('../utils/http');
const expenseService=require('./expense.service');
const budgetService=require('./budget.service');
async function queue(){return (await repo.expenses.list()).filter(e=>e.status==='Pending'||e.status==='In Review');}
async function history(id){return repo.audit.list(id);}
async function log(expenseId,action,previousStatus,newStatus,reviewer,note=''){
  const evt={id:randomUUID(),expenseId,action,previousStatus,newStatus,reviewer,note,at:new Date().toISOString(),demo:true};
  await repo.audit.insert(evt);return evt;
}
async function submit(id,user){
  const exp=await expenseService.forUser(id,user);
  if(exp.status!=='Pending')throw new HttpError(409,'Only pending expenses can be submitted');
  const docs=require('./document.service');
  if(!await docs.hasAllThree(id))throw new HttpError(409,'Upload all 3 documents before submitting for review');
  if(repo.driver==='postgres'){
    const {event}=await require('../repositories/postgres/financial-transitions').transition({
      id,expected:'Pending',next:'In Review',actor:user,action:'submitted',note:'Three supporting documents submitted'});
    return {expense:await expenseService.byId(id),event};
  }
  const previous=exp.status;
  const updatedAt=new Date().toISOString();
  await repo.expenses.patch(id,{status:'In Review',updatedAt});
  const updated={...exp,status:'In Review',updatedAt};
  return {expense:updated,event:await log(id,'submitted',previous,updated.status,user.name,'Three supporting documents submitted')};
}
async function decide(id,body,user){
  const exp=await expenseService.byId(id);
  if(exp.status!=='In Review')throw new HttpError(409,'Only submitted (In Review) expenses can be approved or rejected');
  const action=body?.action;
  if(!['approve','reject'].includes(action))throw new HttpError(400,'Action must be approve or reject');
  const note=typeof body?.note==='string'?body.note.trim():'';
  if(action==='reject'&&(note.length<3||note.length>500))throw new HttpError(400,'Rejection reason must be 3-500 characters');
  if(action==='approve'){
    if(!await require('./document.service').hasAllThree(id))throw new HttpError(409,'All 3 supporting documents required');
    await budgetService.checkApprove(exp);
  }
  if(repo.driver==='postgres'){
    const next=action==='approve'?'Approved':'Rejected';
    const {event}=await require('../repositories/postgres/financial-transitions').transition({
      id,expected:'In Review',next,actor:user,action,note});
    return {expense:await expenseService.byId(id),event};
  }
  const previous=exp.status;
  const newStatus=action==='approve'?'Approved':'Rejected';
  const updatedAt=new Date().toISOString();
  await repo.expenses.patch(id,{status:newStatus,updatedAt});
  const updated={...exp,status:newStatus,updatedAt};
  return {expense:updated,event:await log(id,action,previous,newStatus,user.name,note)};
}
module.exports={queue,history,submit,decide,log};
