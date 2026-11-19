const { randomUUID } = require('node:crypto');
const repo = require('../repositories');
const { HttpError, requiredText, validAmount, validDate } = require('../utils/http');
const budgetService=require('./budget.service');
async function all({ status, search, month } = {}, user = null) {
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, 'Month must use YYYY-MM');
  const documents=require('./document.service');
  const rows = (await repo.expenses.list()).filter(e =>
    (!user || user.role === 'Admin' || e.ownerId === user.id) &&
    (!status || e.status === status) && (!month || e.date.startsWith(month)) &&
    (!search || `${e.title} ${e.category} ${e.vendor || ''} ${e.owner || ''} ${e.reference || ''}`.toLowerCase().includes(String(search).toLowerCase()))
  );
  const withCounts = await Promise.all(rows.map(async e=>({...e,documentCount:await documents.count(e.id)})));
  return withCounts.sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
async function byId(id) { const found = await repo.expenses.findById(id); if (!found) throw new HttpError(404, 'Expense not found'); return found; }
async function forUser(id, user) {
  const item = await byId(id);
  if (user.role !== 'Admin' && item.ownerId !== user.id) throw new HttpError(404, 'Expense not found');
  return item;
}
function optionalText(value, label, max) {
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, `${label} must be text up to ${max} characters`);
  return value.trim();
}
async function check(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'JSON object required');
  const out = {};
  if (!partial || body.title !== undefined) out.title = requiredText(body.title, 'Title', 200);
  if (!partial || body.category !== undefined) {
    const category = requiredText(body.category, 'Category');
    const categories = await repo.categories.list();
    if (!categories.some(c => c.name === category)) throw new HttpError(400, 'Category does not exist');
    out.category = category;
  }
  if (!partial || body.subcategory !== undefined) {
    const subcategory = requiredText(body.subcategory, 'Subcategory');
    out.subcategory = subcategory;
  }
  if (!partial || body.amount !== undefined) out.amount = validAmount(body.amount);
  if (!partial || body.date !== undefined) out.date = validDate(body.date);
  if (body.vendor !== undefined) out.vendor = optionalText(body.vendor, 'Vendor', 200);
  if (body.reference !== undefined) out.reference = optionalText(body.reference, 'Reference', 80);
  if (body.description !== undefined) out.description = optionalText(body.description, 'Description', 1000);
  return out;
}
async function create(body, user) {
  const fields = await check(body);
  const row = { id: randomUUID(), ...fields, vendor: fields.vendor || '', reference: fields.reference || '',
    description: fields.description || '', owner: user.name, ownerId: user.id, status: 'Pending',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const allocation=await budgetService.validateExpense(row);
  row.budgetAllocationId=allocation.id;
  await repo.expenses.insert(row);
  return row;
}
async function update(id, body, user) {
  const item = await forUser(id, user);
  if (item.status !== 'Pending') throw new HttpError(409, 'Only pending expenses can be edited before submitting documents');
  const fields = await check(body, true);
  if (Object.keys(fields).length === 0) throw new HttpError(400, 'Nothing to update');
  const proposed={...item,...fields};
  const allocation=await budgetService.validateExpense(proposed,item.id);
  const updatedAt=new Date().toISOString();
  // When either category or subcategory changes, pass BOTH so the DB driver can
  // resolve the subcategory FK; harmless for the memory driver.
  const patchFields={...fields,budgetAllocationId:allocation.id,updatedAt};
  if(fields.category!==undefined||fields.subcategory!==undefined){patchFields.category=proposed.category;patchFields.subcategory=proposed.subcategory;}
  await repo.expenses.patch(id, patchFields);
  return { ...item, ...fields, budgetAllocationId:allocation.id, updatedAt };
}
async function remove(id, user) {
  const item = await forUser(id, user);
  if (item.status !== 'Pending') throw new HttpError(409, 'Only pending expenses can be deleted');
  await require('./document.service').clear(id);
  await repo.expenses.remove(id);
}
module.exports = { all, byId, forUser, check, create, update, remove };
