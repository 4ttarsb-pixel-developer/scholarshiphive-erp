// Every page/module that admin can grant. "view" = read only, "edit" = read + add/change.
export const MODULES = [
  { key: 'revenue', label: 'Revenue', note: 'Sales, deals, invoices, payments, refunds, forecast' },
  { key: 'expenses', label: 'Expenses', note: 'Constant & variable expenses, salaries total, loans view' },
  { key: 'marketing', label: 'Marketing Expense Analyzer', note: 'Marketing expenses, ad accounts, budgets, attribution and reports' },
  { key: 'petty_cash', label: 'Petty Cash', note: 'Separate access – petty cash entries, top-ups and cash book' },
  { key: 'expense_approve', label: 'Expense Approvals (Manager)', note: 'Edit = approve / reject expenses, recurring cycles, petty receipts & top-ups' },
  { key: 'salary', label: 'Salary & Workforce', note: 'Employees, attendance, leave, payroll and commission' },
  { key: 'assets', label: 'Assets', note: 'Company assets register' },
  { key: 'liabilities', label: 'Liabilities', note: 'Loans and payables' },
  { key: 'cashflow', label: 'Cash Flow Manager', note: 'Profit / loss and cash position' },
  { key: 'announcements', label: 'Announcements (post)', note: 'Everyone can read & reply; this allows posting' },
  { key: 'users', label: 'User Management', note: 'View employees; edit = approve, block, delete employees' },
];
export const MODULE_KEYS = MODULES.map(m => m.key);

export const isAdmin = u => u && (u.role === 'admin' || u.role === 'super_admin');
export const isSuper = u => u && u.role === 'super_admin';

/** Admins, or managers given "Expense Approvals: edit", may approve expenses / petty cash. */
export const canApprove = u => isAdmin(u) || can(u, 'expense_approve', 'edit');

/** user.perms is { module: 'view'|'edit' } */
export function can(user, module, level = 'view') {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const p = user.perms?.[module];
  if (!p) return false;
  return level === 'view' ? (p === 'view' || p === 'edit') : p === 'edit';
}
