// Local-development storage. No fabricated budgets, spending, leads or advertising accounts.
const {randomUUID}=require('node:crypto');
const {definitions}=require('./taxonomy');
const categories=definitions.map(([name,subs])=>({id:randomUUID(),name,subcategories:subs.map(s=>({id:randomUUID(),name:s}))}));
const expenses=[];
const accounts=[]; // No synthetic Meta/Google/TikTok accounts: Admin may register references; live OAuth is pending.
const adAccountAssignments=[];
const budgets=[]; // Company monthly budgets by exact category + subcategory.
const employeeBudgets=[];
// Development test users only; replace with central identity/DB integration later.
const users=[]; // Seeded only by the local authentication bootstrap for testing.
const auditEvents=[];
// Campaign-counsellor attribution: distinct from employee expense-budget allocations.
const counsellors=[]; // Temporary vetted directory; Calling team becomes source of truth later.
const campaignAllocations=[]; // One confirmed mapping per (account,campaign). No imported financial spend.
const attributionEvents=[]; // Development audit history, PostgreSQL later.

const memory={categories,expenses,accounts,adAccountAssignments,budgets,employeeBudgets,users,auditEvents,counsellors,campaignAllocations,attributionEvents};
// Development-only store; PostgreSQL runtime never imports or queries this module.
module.exports = memory;
