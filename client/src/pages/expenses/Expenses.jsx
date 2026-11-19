import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Receipt, Users, Wallet, Landmark, Clock, Plus, Check, Layers, Repeat, Zap, CalendarClock, TrendingUp } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { qs } from '../../lib/api.js';
import { Badge, Button, Card, DataTable, DateRange, Kpi, Loader, Modal, Notice, Person } from '../../components/ui.jsx';
import { Donut, ShareList, SimpleBars, useColors } from '../../components/charts.jsx';
import { money, date, dateTime, monthEnd, monthStart, titleCase } from '../../lib/format.js';
import ExpenseForm from './ExpenseForm.jsx';
import { ExportButtons } from './shared.jsx';
import Constant from './Constant.jsx';
import Variable from './Variable.jsx';
import Approvals from './Approvals.jsx';
import Categories from './Categories.jsx';

const TITLES = {
  overview: ['Expenses', 'Constant (monthly) + variable (daily) expenses, salaries, petty cash and loans — all in one place.'],
  constant: ['Constant Expenses', 'Fixed costs entered once — every month’s cycle appears here for approval.'],
  variable: ['Variable Expenses', 'Daily and one-time spending with receipts.'],
  approvals: ['Approvals', 'Everything waiting for an approver, in one queue.'],
  salaries: ['Salary expense register', 'Approved and paid payroll from Salary & Workforce and legacy ERP records.'],
  loans: ['Loans', 'Loans and liabilities entered in Liabilities — repayments are expenses.'],
  categories: ['Expense Categories', 'The dropdown lists used in every expense and petty cash form.'],
};

export default function Expenses() {
  const { tab = 'overview' } = useParams();
  const { can, isAdmin } = useAuth();
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const [form, setForm] = useState(null);
  const [v, setV] = useState(0);
  const bump = () => setV(x => x + 1);
  if (tab === 'expenses') return <Navigate to="/expenses/variable" replace />; // old links
  if (!TITLES[tab]) return <Navigate to="/expenses" replace />;
  const edit = can('expenses', 'edit');
  const [t, sub] = TITLES[tab];
  const withRange = ['overview', 'variable', 'salaries', 'loans'].includes(tab);
  return (
    <>
      <div className="page-head">
        <div><h1>{t}</h1><p>{sub}</p></div>
        <div className="page-actions">
          {withRange && <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />}
          {edit && (tab === 'overview' || tab === 'constant') && <Button variant={tab === 'constant' ? 'primary' : undefined} icon={Repeat} onClick={() => setForm({ presetType: 'constant' })}>Add constant expense</Button>}
          {edit && (tab === 'overview' || tab === 'variable') && <Button variant="primary" icon={Plus} onClick={() => setForm({ presetType: 'variable' })}>Add variable expense</Button>}
        </div>
      </div>
      {tab === 'overview' && <Overview range={range} v={v} />}
      {tab === 'constant' && <Constant v={v} openForm={setForm} bump={bump} />}
      {tab === 'variable' && <Variable range={range} v={v} openForm={setForm} bump={bump} />}
      {tab === 'approvals' && (can('expense_approve', 'edit') ? <Approvals v={v} openForm={setForm} bump={bump} /> : <Notice type="warn">Only admins and managers with “Expense Approvals” access can open the approval queue.</Notice>)}
      {tab === 'salaries' && <Salaries range={range} v={v} />}
      {tab === 'loans' && <Loans range={range} v={v} />}
      {tab === 'categories' && (isAdmin ? <Categories /> : <Notice type="warn">Only admins can change the category lists.</Notice>)}
      {form && <ExpenseForm {...form} onClose={() => setForm(null)} onSaved={() => { setForm(null); bump(); }} />}
    </>
  );
}

function Overview({ range, v }) {
  const { data: d, loading, error } = useLoad(`/expenses/summary${qs(range)}`, [v]);
  const { data: recent } = useLoad('/expenses?all=1&limit=7&sort=created&dir=desc', [v]);
  const c = useColors();
  const nav = useNavigate();
  const { can } = useAuth();
  if (loading && !d) return <Loader />;
  if (error) return <Notice type="error">{error.message}</Notice>;
  const parts = [
    { name: 'Constant (approved)', value: d.constant, to: '/expenses/constant?view=monthly', icon: Repeat, color: 'purple' },
    { name: 'Variable (approved)', value: d.variable, to: '/expenses/variable', icon: Receipt, color: 'cyan' },
    { name: 'Salaries', value: d.salaries, to: '/expenses/salaries', icon: Users, color: 'blue' },
    ...(can('marketing') ? [{ name: 'Marketing spend', value: d.marketing || 0, to: '/expenses/marketing', icon: TrendingUp, color: 'cyan' }] : []),
    { name: 'Petty cash spent', value: d.pettySpent, to: '/petty-cash', icon: Wallet, color: 'orange' },
    { name: 'Loan repayments', value: d.loanPayments, to: '/expenses/loans', icon: Landmark, color: 'green' },
  ];
  const open = item => {
    if (item.type === 'constant' || item.type === 'variable') nav(`/expenses/${item.type}${item.id ? `?category_id=${item.id}` : ''}`);
    else if (item.type === 'marketing' && can('marketing')) nav('/expenses/marketing');
    else if (item.type === 'salary') nav('/expenses/salaries');
    else if (item.type === 'petty') nav('/petty-cash');
    else if (item.type === 'loan') nav('/expenses/loans');
  };
  const coreOperating = Number(d.constant || 0) + Number(d.variable || 0);
  const split = coreOperating > 0 ? Math.round((d.constant / coreOperating) * 100) : 0;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi icon={Layers} color="red" label="Total expenses" value={money(d.total)} sub="Constant + variable + marketing + salaries + petty + loans" />
        {parts.map(p => <Kpi key={p.name} icon={p.icon} color={p.color} label={p.name} value={money(p.value)} sub={<Link to={p.to}>Details →</Link>} />)}
        <Kpi icon={Clock} color="orange" label="Waiting approval" value={money(d.pending.amount)} sub={can('expense_approve', 'edit') ? <Link to="/expenses/approvals">{d.pending.count} expense(s) · review →</Link> : `${d.pending.count} expense(s)`} />
      </div>
      <div className="grid grid-main">
        <Card title="Monthly spending" subtitle="Last 12 months · approved expenses, marketing spend, petty cash and salaries">
          <SimpleBars data={d.monthly} stacked height={330} keys={[{ key: 'constant', label: 'Constant', color: c.c4 }, { key: 'variable', label: 'Variable', color: c.c6 }, { key: 'marketing', label: 'Marketing', color: c.c5 }, { key: 'petty', label: 'Petty cash', color: c.c3 }, { key: 'salaries', label: 'Salaries', color: c.c1 }]} />
          <div className="legend" style={{ marginTop: 8 }}>{[['Constant', c.c4], ['Variable', c.c6], ['Marketing', c.c5], ['Petty cash', c.c3], ['Salaries', c.c1]].map(([l, col]) => <span key={l}><i style={{ background: col }} />{l}</span>)}</div>
        </Card>
        <Card title="Where the money went" subtitle="Click a slice to open it">
          <Donut data={d.byCategory.slice(0, 8)} center={money(d.total, { short: true })} centerSub="Total" onSelect={open} />
          <ShareList items={d.byCategory.slice(0, 4)} onSelect={open} />
        </Card>
      </div>
      <div className="grid grid-3">
        <Card title="Constant vs variable" subtitle="Approved operating expenses">
          <div className="split-bar"><span style={{ width: `${split}%`, background: c.c4 }} /><span style={{ width: `${100 - split}%`, background: c.c6 }} /></div>
          <div className="slip-row"><span><Badge tone="purple">Constant</Badge> {split}%</span><b>{money(d.constant)}</b></div>
          <div className="slip-row"><span><Badge tone="cyan">Variable</Badge> {100 - split}%</span><b>{money(d.variable)}</b></div>
          <div className="slip-row"><span><Badge tone="blue">Marketing</Badge></span><b>{money(d.marketing || 0)}</b></div>
          <div className="slip-row"><span className="row" style={{ gap: 6 }}><CalendarClock size={15} />Monthly commitment ({d.recurring.active} active)</span><b>{money(d.recurring.per_month)}</b></div>
          {d.recurring.pending > 0 && <div className="small" style={{ marginTop: 6 }}><Zap size={13} style={{ verticalAlign: -2 }} /> {d.recurring.pending} new constant expense(s) waiting for approval.</div>}
        </Card>
        <Card title="Top expense items"><ShareList items={d.bySubCategory} colorIndex={2} /></Card>
        <Card title="By department"><ShareList items={d.byDepartment} colorIndex={4} /></Card>
      </div>
      <Card title="Recent entries" subtitle="Latest expenses entered across constant and variable spending" pad={false} actions={<Link className="btn btn-sm" to="/expenses/variable">Open expense register</Link>}>
        {recent?.rows?.length ? <div className="recent-expense-list">
          {recent.rows.map(row => <Link key={`${row.expense_type}-${row.id}`} to={row.expense_type === 'constant' ? '/expenses/constant?view=monthly' : '/expenses/variable'} className="recent-expense-row">
            <span className={`recent-expense-icon ${row.expense_type === 'constant' ? 'constant' : 'variable'}`}>{row.expense_type === 'constant' ? <Repeat size={16} /> : <Receipt size={16} />}</span>
            <span className="recent-expense-main"><b>{row.title || row.sub_category || row.category}</b><small>{row.paid_to || 'No vendor'} · {row.ref_no} · {date(row.expense_date)}</small></span>
            <span className="recent-expense-meta"><b>{money(row.amount)}</b><Badge status={row.status}>{row.status === 'pending' ? 'Not approved' : titleCase(row.status)}</Badge></span>
          </Link>)}
        </div> : <div className="card-body muted small">No expense entries have been recorded yet.</div>}
      </Card>
      <Card title="Summary" pad={false} actions={<ExportButtons dataset="expenses" params={{ ...range }} />}>
        <table className="tbl"><tbody>
          {parts.map(p => <tr key={p.name}><td><Link to={p.to}>{p.name}</Link></td><td className="num">{money(p.value)}</td></tr>)}
          {can('marketing') && <tr><td><Link to="/expenses/marketing">Marketing Analyzer spend</Link></td><td className="num">{money(d.marketing || 0)}</td></tr>}
          <tr><td className="muted">Petty cash top-ups given (moved into petty cash, not counted twice)</td><td className="num muted">{money(d.pettyTopups)}</td></tr>
          <tr><td className="muted">Salaries already paid</td><td className="num muted">{money(d.salariesPaid)}</td></tr>
          <tr><td className="muted">Not approved yet (not counted)</td><td className="num muted">{money(d.pending.amount)}</td></tr>
          <tr><td className="muted">Rejected expenses (not counted)</td><td className="num muted">{money(d.rejected)}</td></tr>
        </tbody><tfoot><tr><td>Total expenses</td><td className="num">{money(d.total)}</td></tr></tfoot></table>
      </Card>
    </div>
  );
}

function Salaries({ range, v }) {
  const { data, loading } = useLoad(`/expenses/salaries${qs(range)}`, [v]);
  const { can } = useAuth();
  const [open, setOpen] = useState(null);
  return (
    <div className="stack">
      {data && <div className="grid grid-kpi">
        <Kpi icon={Users} color="blue" label="Total salaries (approved + paid)" value={money(data.total)} sub={`${data.rows.length} salary record(s)`} />
        <Kpi icon={Check} color="green" label="Paid" value={money(data.paid)} />
        <Kpi icon={Clock} color="orange" label="Approved, not yet paid" value={money(data.approvedUnpaid)} />
      </div>}
      <Card pad={false}>
        <DataTable loading={loading} rows={data?.rows || []} onRowClick={setOpen} tools={<ExportButtons dataset="salaries" params={range} />} empty="No approved salaries for these months yet. Review and approve payroll in Salary & Workforce." columns={[
          { key: 'month', label: 'Month', render: r => r.month_label }, { key: 'full_name', label: 'Employee', render: r => <Person name={r.full_name} sub={r.employee_code} fileId={r.photo_file_id} size={30} /> },
          { key: 'base_salary', label: 'Base', money: true }, { key: 'commission', label: 'Commission', money: true }, { key: 'bonus', label: 'Bonus', money: true }, { key: 'deductions', label: 'Deductions', money: true },
          { key: 'net_salary', label: 'Net salary', money: true }, { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }]}
          footer={list => <tr><td colSpan={6}>Total ({list.length})</td><td className="num">{money(list.reduce((a, r) => a + r.net_salary, 0))}</td><td /></tr>} />
      </Card>
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${open.full_name} · ${open.month_label}`} subtitle={`${open.employee_code} · Slip ${open.slip_no}`}
          footer={<>{open.source !== 'workforce' && <a className="btn" href={`/api/salary/slip/${open.id}`} download>Download slip (PDF)</a>}{can('salary') && <Link className="btn btn-primary" to="/expenses/workforce">Open Salary & Workforce</Link>}</>}>
          <div className="slip-row"><span>Base salary</span><b>{money(open.base_salary)}</b></div>
          <div className="slip-row"><span>{open.source === 'workforce' ? 'Commission earned' : `Commission (${open.commission_pct}% of ${money(open.sales)})`}</span><b>{money(open.commission)}</b></div>
          <div className="slip-row"><span>Bonus</span><b>{money(open.bonus)}</b></div>
          <div className="slip-row"><span>Deductions</span><b>− {money(open.deductions)}</b></div>
          <div className="slip-row total"><span>Net salary</span><span>{money(open.net_salary)}</span></div>
          <p className="small muted">Status: {titleCase(open.status)}{open.paid_at ? ` on ${dateTime(open.paid_at)} (${open.payment_method || 'Payment recorded'})` : ''}{open.payment_reference ? ` · Ref: ${open.payment_reference}` : ''}</p>
        </Modal>
      )}
    </div>
  );
}

export function Loans({ range, v }) {
  const { data, loading, error } = useLoad(`/expenses/loans${qs(range)}`, [v]);
  const { can } = useAuth();
  if (!data) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi icon={Landmark} color="purple" label="Repaid in this period" value={money(data.paidInRange)} sub={`Interest part ≈ ${money(data.interestInRange)}`} />
        <Kpi icon={Clock} color="orange" label="Total outstanding" value={money(data.totals.outstanding)} sub={`${data.totals.active} active`} />
        <Kpi icon={Receipt} color="blue" label="Total principal" value={money(data.totals.principal)} />
      </div>
      <Card title="Loans & liabilities" subtitle="Entered in Liabilities — shown here automatically" pad={false} actions={can('liabilities') && <Link className="btn btn-sm" to="/liabilities">Open Liabilities</Link>}>
        <DataTable rows={data.rows} tools={<ExportButtons dataset="loans" params={range} />} empty="No loans entered. Add them in Liabilities." columns={[
          { key: 'title', label: 'Title' }, { key: 'lender', label: 'Lender' }, { key: 'interest_type', label: 'Interest', render: r => r.interest_type === 'none' ? 'None' : `${titleCase(r.interest_type)} ${r.annual_rate}%` },
          { key: 'installment', label: 'Monthly installment', money: true }, { key: 'next_due', label: 'Next due', render: r => date(r.next_due) },
          { key: 'total_payable', label: 'Payable', money: true }, { key: 'paid', label: 'Paid', money: true }, { key: 'outstanding', label: 'Outstanding', money: true }, { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }]} />
      </Card>
      <Card title="Repayments in this period" pad={false}>
        <DataTable search={false} rows={data.payments} empty="No loan repayments in this period." columns={[{ key: 'payment_date', label: 'Date', render: r => date(r.payment_date) }, { key: 'title', label: 'Loan' }, { key: 'lender', label: 'Lender' }, { key: 'method', label: 'Method' }, { key: 'amount', label: 'Amount', money: true }]} />
      </Card>
    </div>
  );
}
