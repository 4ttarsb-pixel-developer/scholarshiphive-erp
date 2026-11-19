// Same-origin client. Authentication is ScholarshipHive ERP's HttpOnly session cookie.
const BASE_URL = '/api/v1'; // same-origin ERP route; no VITE_MEA_API_URL / localhost fallback
const currentMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; };
export function setToken() { /* legacy call compatibility; ERP cookies are HttpOnly */ }
export function hasSession() { return true; }
export async function apiRequest(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.rawBody ? {} : { 'Content-Type': 'application/json' }),
        'X-Requested-With': 'ScholarshipHive',
        ...(options.headers || {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.message || `Request failed (${response.status})`), { status: response.status });
    return payload.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Marketing API timed out. Check the ScholarshipHive server and database.');
    if (error instanceof TypeError) throw new Error('Cannot reach the ScholarshipHive API.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export const api={
  health:()=>apiRequest('/health'),
  categories:()=>apiRequest('/categories'),
  createCategory:name=>apiRequest('/categories',{method:'POST',body:JSON.stringify({name})}),
  createSubcategory:(id,name)=>apiRequest(`/categories/${encodeURIComponent(id)}/subcategories`,{method:'POST',body:JSON.stringify({name})}),
  expenses:()=>apiRequest('/expenses'),
  expense:id=>apiRequest(`/expenses/${encodeURIComponent(id)}`),
  expenseDocuments:id=>apiRequest(`/expenses/${encodeURIComponent(id)}/documents`),
  uploadDocument:(id,body)=>apiRequest(`/expenses/${encodeURIComponent(id)}/documents`,{method:'POST',body:JSON.stringify(body)}),
  removeDocument:(id,slot)=>apiRequest(`/expenses/${encodeURIComponent(id)}/documents/${slot}`,{method:'DELETE'}),
  submitExpense:id=>apiRequest(`/expenses/${encodeURIComponent(id)}/submit`,{method:'POST'}),
  expenseHistory:id=>apiRequest(`/expenses/${encodeURIComponent(id)}/audit-history`),
  updateExpense:(id,body)=>apiRequest(`/expenses/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}),
  deleteExpense:id=>apiRequest(`/expenses/${encodeURIComponent(id)}`,{method:'DELETE'}),
  createExpense:body=>apiRequest('/expenses',{method:'POST',body:JSON.stringify(body)}),
  myBudgets:month=>apiRequest(`/budgets/my?month=${encodeURIComponent(month||currentMonth())}`),
  employeeBudgets:month=>apiRequest(`/budgets/employee-allocations?month=${encodeURIComponent(month||currentMonth())}`),
  allocateEmployee:body=>apiRequest('/budgets/employee-allocations',{method:'POST',body:JSON.stringify(body)}),
  updateEmployeeBudget:(id,limit)=>apiRequest(`/budgets/employee-allocations/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({limit})}),
  budgets:month=>apiRequest(`/budgets?month=${encodeURIComponent(month||currentMonth())}`),
  createBudget:body=>apiRequest('/budgets',{method:'POST',body:JSON.stringify(body)}),
  updateBudget:(id,limit)=>apiRequest(`/budgets/${id}`,{method:'PATCH',body:JSON.stringify({limit})}),
  auditQueue:()=>apiRequest('/audit/queue'),
  auditHistory:id=>apiRequest(`/audit/history?expenseId=${encodeURIComponent(id)}`),
  auditDecision:(id,action,note='')=>apiRequest(`/audit/${id}/decision`,{method:'POST',body:JSON.stringify({action,note})}),
  dashboard:(month,period={})=>apiRequest(`/dashboard/summary?${new URLSearchParams({month:month||currentMonth(),...period})}`),
  accounts:(period={})=>apiRequest(`/ad-accounts?${new URLSearchParams(period)}`),
  adAccount:id=>apiRequest(`/ad-accounts/${encodeURIComponent(id)}`),
  createAdAccount:body=>apiRequest('/ad-accounts',{method:'POST',body:JSON.stringify(body)}),
  updateAdAccount:(id,body)=>apiRequest(`/ad-accounts/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)}),
  removeAdAccount:id=>apiRequest(`/ad-accounts/${encodeURIComponent(id)}`,{method:'DELETE'}),
  assignAdAccount:(id,userId)=>apiRequest(`/ad-accounts/${encodeURIComponent(id)}/assignments`,{method:'POST',body:JSON.stringify({userId})}),
  unassignAdAccount:(id,userId)=>apiRequest(`/ad-accounts/${encodeURIComponent(id)}/assignments/${encodeURIComponent(userId)}`,{method:'DELETE'}),
  adStatus:(id,period={})=>apiRequest(`/ad-integrations/${encodeURIComponent(id)}/status?${new URLSearchParams(period)}`),
  verifyAdAccount:id=>apiRequest(`/ad-integrations/${encodeURIComponent(id)}/verify`,{method:'POST'}),
  refreshAdAccount:(id,period={})=>apiRequest(`/ad-integrations/${encodeURIComponent(id)}/refresh`,{method:'POST',body:JSON.stringify(period)}),
  adCampaigns:(id,period={})=>apiRequest(`/ad-integrations/${encodeURIComponent(id)}/campaigns?${new URLSearchParams(period)}`),
  adHierarchy:(id,period={})=>apiRequest(`/ad-integrations/${encodeURIComponent(id)}/hierarchy?${new URLSearchParams(period)}`),
  adGroups:(id,campaignId)=>apiRequest(`/ad-integrations/${encodeURIComponent(id)}/ad-groups${campaignId?'?campaignId='+encodeURIComponent(campaignId):''}`),
  adAds:(id,filters={})=>apiRequest(`/ad-integrations/${encodeURIComponent(id)}/ads?${new URLSearchParams(filters)}`),
  adDetail:(id,adId)=>apiRequest(`/ad-integrations/${encodeURIComponent(id)}/ads/${encodeURIComponent(adId)}`),
  adPerformance:(id,period={})=>apiRequest(`/ad-integrations/${encodeURIComponent(id)}/performance?${new URLSearchParams(period)}`),
  fxRates:()=>apiRequest('/fx/rates'),
  saveFxRate:body=>apiRequest('/fx/rates',{method:'POST',body:JSON.stringify(body)}),
  counsellors:()=>apiRequest('/attribution/counsellors'),
  createCounsellor:body=>apiRequest('/attribution/counsellors',{method:'POST',body:JSON.stringify(body)}),
  counsellorStatus:(id,status)=>apiRequest(`/attribution/counsellors/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({status})}),
  attributedCampaigns:(id,period={})=>apiRequest(`/attribution/accounts/${encodeURIComponent(id)}/campaigns?${new URLSearchParams(period)}`),
  saveCampaignMapping:(id,body)=>apiRequest(`/attribution/accounts/${encodeURIComponent(id)}/mappings`,{method:'PUT',body:JSON.stringify(body)}),
  deleteCampaignMapping:(id,campaignId)=>apiRequest(`/attribution/accounts/${encodeURIComponent(id)}/mappings/${encodeURIComponent(campaignId)}`,{method:'DELETE'}),
  campaignMappingHistory:id=>apiRequest(`/attribution/accounts/${encodeURIComponent(id)}/history`),
  attributionReport:(period={})=>apiRequest(`/attribution/report?${new URLSearchParams(period)}`),
  users:()=>apiRequest('/users'),
  reports:(period={})=>apiRequest(`/reports/overview?${new URLSearchParams(period)}`)
};

export async function downloadDocument(expenseId,slot){
  const response=await fetch(`${BASE_URL}/expenses/${encodeURIComponent(expenseId)}/documents/${slot}/download`,{
    headers:{'X-Requested-With':'ScholarshipHive'},credentials:'same-origin',cache:'no-store'
  });
  if(!response.ok){const p=await response.json().catch(()=>({}));throw new Error(p.message||'Document download failed')}
  const blob=await response.blob();
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=`expense-${expenseId.slice(0,8)}-document-${slot}.${blob.type==='application/pdf'?'pdf':blob.type==='image/png'?'png':'jpg'}`;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
