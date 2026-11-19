const {randomUUID}=require('node:crypto');
const repo=require('../repositories');
const {HttpError,requiredText}=require('../utils/http');
const all=()=>repo.categories.list();
async function byId(id){const cats=await repo.categories.list();const c=cats.find(x=>x.id===id);if(!c)throw new HttpError(404,'Category not found');return c;}
async function usesCategory(name){const [budgets,allocs,expenses]=await Promise.all([repo.budgets.list(),repo.allocations.list(),repo.expenses.list()]);return budgets.some(x=>x.category===name)||allocs.some(x=>x.category===name)||expenses.some(x=>x.category===name);}
async function usesSubcategory(name,sub){const [budgets,allocs,expenses]=await Promise.all([repo.budgets.list(),repo.allocations.list(),repo.expenses.list()]);return [...budgets,...allocs,...expenses].some(x=>x.category===name&&x.subcategory===sub);}
async function create(body){const name=requiredText(body?.name,'Name',120);const cats=await repo.categories.list();if(cats.some(x=>x.name.toLowerCase()===name.toLowerCase()))throw new HttpError(409,'Category already exists');const c={id:randomUUID(),name,subcategories:[]};await repo.categories.insert(c);return c;}
async function update(id,body){const c=await byId(id),name=requiredText(body?.name,'Name',120);const cats=await repo.categories.list();if(cats.some(x=>x.id!==id&&x.name.toLowerCase()===name.toLowerCase()))throw new HttpError(409,'Category already exists');if(await usesCategory(c.name))throw new HttpError(409,'Category with budget or expense records cannot be renamed');await repo.categories.rename(id,name);c.name=name;return c;}
async function remove(id){const c=await byId(id);if(await usesCategory(c.name))throw new HttpError(409,'Category is used by financial records');await repo.categories.remove(id);}
async function addSubcategory(id,body){const c=await byId(id),name=requiredText(body?.name,'Subcategory',120);if(c.subcategories.some(x=>x.name.toLowerCase()===name.toLowerCase()))throw new HttpError(409,'Subcategory already exists');const sub={id:randomUUID(),name};await repo.categories.addSubcategory(id,sub);return sub;}
async function removeSubcategory(id,subId){const c=await byId(id),sub=c.subcategories.find(x=>x.id===subId);if(!sub)throw new HttpError(404,'Subcategory not found');if(await usesSubcategory(c.name,sub.name))throw new HttpError(409,'Subcategory is used by financial records');await repo.categories.removeSubcategory(id,subId);}
module.exports={all,byId,create,update,remove,addSubcategory,removeSubcategory};
