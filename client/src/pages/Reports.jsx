import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileDown, FileSpreadsheet, TrendingUp, Receipt, Wallet, Users, Landmark, ShieldCheck, BadgeDollarSign, Scale, ArrowRight } from 'lucide-react';
import { useAuth, useLoad } from '../lib/auth.jsx';
import { useLang } from '../lib/i18n.jsx';
import { qs } from '../lib/api.js';
import { Card, DateRange, Kpi, Loader, Notice } from '../components/ui.jsx';
import { money, monthStart, monthEnd } from '../lib/format.js';

// Every downloadable report, grouped by module. `perm` decides who sees it; `dated` = uses the date range.
const GROUPS = [
  { title: 'Revenue', icon: TrendingUp, perm: 'revenue', link: '/revenue', items: [
    { ds: 'sales', label: 'Sales & deals (revenue report)', dated: true },
    { ds: 'payments', label: 'Payments received', dated: true },
    { ds: 'refunds', label: 'Refunds', dated: true },
    { ds: 'customers', label: 'Customers & balances' },
  ] },
  { title: 'Expenses', icon: Receipt, perm: 'expenses', link: '/expenses', items: [
    { ds: 'expenses', label: 'All expenses', dated: true },
    { ds: 'variable-expenses', label: 'Variable expenses', dated: true },
    { ds: 'recurring', label: 'Recurring constant expenses' },
    { ds: 'salaries', label: 'Salaries (approved & paid)', dated: true },
  ] },
  { title: 'Petty Cash', icon: Wallet, perm: 'petty_cash', link: '/petty-cash', items: [
    { ds: 'petty', label: 'Petty cash entries', dated: true },
    { ds: 'petty-ledger', label: 'Petty cash book (running balance)', dated: true },
    { ds: 'petty-topups', label: 'Petty cash top-ups', dated: true },
  ] },
  { title: 'Salary', icon: Users, perm: 'salary', link: '/salary', items: [
    { ds: 'salary', label: 'Salary manager (month)', dated: true },
  ] },
  { title: 'Accounts', icon: Landmark, perm: ['cashflow', 'assets', 'liabilities'], link: '/cash-flow', items: [
    { ds: 'cashflow', label: 'Profit / loss & cash flow', dated: true, perm: 'cashflow' },
    { ds: 'capital', label: 'Capital entries (investment / drawings)', perm: 'cashflow' },
    { ds: 'assets', label: 'Assets register', perm: 'assets' },
    { ds: 'liabilities', label: 'Loans & liabilities', dated: true, perm: 'liabilities' },
  ] },
  { title: 'Admin', icon: ShieldCheck, admin: true, link: '/settings/admin', items: [
    { ds: 'users', label: 'Users & employees' },
    { ds: 'audit', label: 'Activity log (last 2,000)' },
  ] },
  { title: 'Me', icon: BadgeDollarSign, link: '/my-salary', items: [
    { ds: 'my-salary', label: 'My salary history' },
  ] },
];

/** Reports centre: one place to download every report as PDF or CSV (Excel). */
export default function Reports() {
  const { can, isAdmin } = useAuth();
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const allowed = p => (!p ? true : (Array.isArray(p) ? p : [p]).some(x => can(x, 'view')));
  const groups = GROUPS.filter(g => (g.admin ? isAdmin : allowed(g.perm))).map(g => ({ ...g, items: g.items.filter(i => allowed(i.perm)) })).filter(g => g.items.length);
  const href = (i, format) => `/api/export/${i.ds}${qs({ ...(i.dated ? range : {}), ...(i.ds === 'salary' ? { month: range.to.slice(0, 7) } : {}), format })}`;
  return (
    <>
      <div className="page-head">
        <div><h1>Reports</h1><p>Download any report as a branded PDF or as CSV (opens in Excel / Google Sheets).</p></div>
        <div className="page-actions"><DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} /></div>
      </div>
      {can('cashflow', 'view') && <ProfitSnapshot range={range} />}
      <div className="report-grid">
        {groups.map(g => (
          <Card key={g.title} title={<span className="row" style={{ gap: 8 }}><g.icon size={17} />{g.title}</span>} actions={<Link className="small" to={g.link}>Open<ArrowRight size={13} /></Link>}>
            <ul className="report-list">
              {g.items.map(i => (
                <li key={i.ds}>
                  <span>{i.label}{i.dated && <small className="muted"> · date range</small>}</span>
                  <span className="row" style={{ gap: 6 }}>
                    <a className="btn btn-sm" href={href(i, 'pdf')} download><FileDown />PDF</a>
                    <a className="btn btn-sm" href={href(i, 'csv')} download><FileSpreadsheet />CSV</a>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      {!groups.length && <Notice>No reports are available for your access level. Ask an admin for module access.</Notice>}
    </>
  );
}

function ProfitSnapshot({ range }) {
  const { tx } = useLang();
  const { data, loading, error } = useLoad(`/cashflow${qs(range)}`, []);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (loading && !data) return <Loader />;
  const p = data?.period;
  if (!p) return null;
  return (
    <div className="grid grid-kpi" style={{ marginBottom: 18 }}>
      <Kpi icon={TrendingUp} color="green" label="Net revenue" value={money(p.revenue.net)} sub={tx('Collected {a} · refunds {b}', { a: money(p.revenue.collected, { short: true }), b: money(p.revenue.refunds, { short: true }) })} />
      <Kpi icon={Receipt} color="orange" label="Total expenses" value={money(p.expenses.total)} sub={tx('Salaries {a}', { a: money(p.expenses.salaries, { short: true }) })} />
      <Kpi icon={Scale} color={p.profit.net >= 0 ? 'blue' : 'red'} label="Net profit / loss" value={money(p.profit.net)} sub={tx('Margin {a}%', { a: p.profit.margin })} />
      <Kpi icon={Wallet} color="purple" label="Net cash flow" value={money(p.cash.net)} sub={tx('In {a} · out {b}', { a: money(p.cash.inflow, { short: true }), b: money(p.cash.outflow, { short: true }) })} />
    </div>
  );
}
