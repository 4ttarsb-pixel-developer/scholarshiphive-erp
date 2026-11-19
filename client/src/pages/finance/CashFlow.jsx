import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, Scale, TrendingUp, Building2, Landmark, PiggyBank, Plus, Trash2, ExternalLink, Hourglass, CalendarRange, Clock3, Briefcase, Sigma, Wallet, ClipboardCheck, TriangleAlert } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { api, qs } from '../../lib/api.js';
import { Button, Card, DataTable, DateRange, ExportButtons, Field, Input, Kpi, Loader, Modal, MoneyInput, Notice, Segmented, Textarea, useConfirm, useToast, Legend, Badge } from '../../components/ui.jsx';
import { BarsLines, Donut, useColors } from '../../components/charts.jsx';
import { money, date, monthStart, monthEnd, todayStr, titleCase } from '../../lib/format.js';

const Runway = lazy(() => import('../cashflow/Runway.jsx'));
const Forecast = lazy(() => import('../cashflow/Forecast.jsx'));
const Timing = lazy(() => import('../cashflow/Timing.jsx'));
const WorkingCapital = lazy(() => import('../cashflow/WorkingCapital.jsx'));
const SurplusDeficit = lazy(() => import('../cashflow/SurplusDeficit.jsx'));
const Models = lazy(() => import('../cashflow/Models.jsx'));
const Treasury = lazy(() => import('../cashflow/Treasury.jsx'));
const Budgets = lazy(() => import('../cashflow/Budgets.jsx'));
const Payments = lazy(() => import('../cashflow/Payments.jsx'));

const TITLES = {
  overview: ['Cash Flow Manager', 'Revenue, expenses, liabilities, assets and capital — analysed together.'],
  runway: ['Cash Runway', 'How many months the cash lasts, and when it would run out.'],
  forecast: ['Cash Forecast (Cash Budget)', 'Expected inflow (fees, receivables, commissions) and outflow (payments, salaries, rent, taxes) month by month.'],
  timing: ['Inflow vs Outflow Timing', 'When money comes in and when it goes out — the gap days and the lowest point.'],
  'working-capital': ['Working Capital', 'Receivables (debtors), payables (creditors), inventory and the operating cash cycle.'],
  'surplus-deficit': ['Surplus & Deficit', 'Find shortfall months, fund them cheaply, and put idle cash to work.'],
  models: ['Cash Models', 'Baumol model, Miller–Orr model and cash discount vs interest cost.'],
  treasury: ['Treasury & Banking', 'Bank, cash, wallet and deposit balances, overdraft & running finance lines, reconciliation.'],
  budgets: ['Budget Allotment', 'Give employees a cash budget (limited access) and top up petty cash — all approvals in one place.'],
  payments: ['Payment Control', 'Approve, hold or release constant (and variable) expenses — one, selected, or all filtered.'],
  'profit-loss': ['Profit & Loss', 'Income statement and cash statement for the selected period.'],
  capital: ['Capital', 'Owner investment and drawings.'],
};
const PAGES = { runway: Runway, forecast: Forecast, timing: Timing, 'working-capital': WorkingCapital, 'surplus-deficit': SurplusDeficit, models: Models, treasury: Treasury, budgets: Budgets, payments: Payments };

export default function CashFlow() {
  const { tab = 'overview' } = useParams();
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  if (!TITLES[tab]) return <Navigate to="/cash-flow" replace />;
  const [t, sub] = TITLES[tab];
  const P = PAGES[tab];
  const ranged = tab === 'overview' || tab === 'profit-loss';
  return (
    <>
      <div className="page-head">
        <div><h1>{t}</h1><p>{sub}</p></div>
        <div className="page-actions">{ranged && <><DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} /><ExportButtons dataset="cashflow" params={range} /></>}</div>
      </div>
      {tab === 'overview' && <Overview range={range} />}
      {tab === 'profit-loss' && <ProfitLoss range={range} />}
      {tab === 'capital' && <Capital />}
      {P && <Suspense fallback={<Loader />}><P /></Suspense>}
    </>
  );
}

const TOOLS = [
  { to: '/cash-flow/runway', icon: Hourglass, label: 'Cash runway', note: 'Months of cash left', tone: 'purple' },
  { to: '/cash-flow/forecast', icon: CalendarRange, label: 'Cash forecast', note: 'Cash budget by month', tone: 'blue' },
  { to: '/cash-flow/timing', icon: Clock3, label: 'Inflow vs outflow timing', note: 'Gap days & low point', tone: 'cyan' },
  { to: '/cash-flow/surplus-deficit', icon: TriangleAlert, label: 'Surplus & deficit', note: 'Fund or invest', tone: 'orange' },
  { to: '/cash-flow/working-capital', icon: Briefcase, label: 'Working capital', note: 'Debtors, creditors, cycle', tone: 'green' },
  { to: '/cash-flow/models', icon: Sigma, label: 'Cash models', note: 'Baumol · Miller–Orr · discount', tone: 'purple' },
  { to: '/cash-flow/treasury', icon: Landmark, label: 'Treasury & banking', note: 'Accounts & credit lines', tone: 'blue' },
  { to: '/cash-flow/budgets', icon: Wallet, label: 'Budget allotment', note: 'Staff budgets & petty top-ups', tone: 'orange' },
  { to: '/cash-flow/payments', icon: ClipboardCheck, label: 'Payment control', note: 'Approve / hold in bulk', tone: 'red' },
];

function CashTools() {
  const { data: rw } = useLoad('/cashflow/runway');
  return (
    <Card title="Cash management" subtitle={rw ? `Cash today ${money(rw.position.cash)} · runway ${rw.runway.net === null ? 'cash positive' : `${Math.round(rw.runway.net * 10) / 10} months`}${rw.forecast.zeroDate ? ` · below zero on ${date(rw.forecast.zeroDate)}` : ''}` : 'Loading cash position…'}>
      <div className="tool-grid">{TOOLS.map(x => <Link key={x.to} to={x.to} className="tool-tile"><span className={`kpi-icon c-${x.tone}`}><x.icon /></span><span><b>{x.label}</b><small>{x.note}</small></span></Link>)}</div>
    </Card>
  );
}

const D = ({ to, children }) => <Link to={to} className="small row" style={{ gap: 3 }}>{children || 'Details'}<ExternalLink size={12} /></Link>;

function Overview({ range }) {
  const { data: d, loading, error } = useLoad(`/cashflow${qs(range)}`);
  const c = useColors();
  if (loading && !d) return <Loader />;
  if (error) return <Notice type="error">{error.message}</Notice>;
  const p = d.period;
  const pos = d.position;
  return (
    <div className="stack">
      <CashTools />
      <div className="grid grid-kpi">
        <Kpi icon={TrendingUp} color={p.profit.net >= 0 ? 'green' : 'red'} label={p.profit.net >= 0 ? 'Net profit' : 'Net loss'} value={money(p.profit.net)} sub={<>Margin {p.profit.margin}% · <D to="/cash-flow/profit-loss" /></>} />
        <Kpi icon={ArrowDownCircle} color="blue" label="Cash in" value={money(p.cash.inflow)} sub={<D to="/revenue/payments" />} />
        <Kpi icon={ArrowUpCircle} color="orange" label="Cash out" value={money(p.cash.outflow)} sub={<D to="/expenses" />} />
        <Kpi icon={Scale} color={p.cash.net >= 0 ? 'cyan' : 'red'} label="Net cash flow" value={money(p.cash.net)} />
      </div>
      <Card title="Cash in vs cash out" subtitle="Last 12 months" actions={<Legend items={[{ label: 'Cash in', color: c.c2 }, { label: 'Cash out', color: c.c5 }, { label: 'Profit / loss', color: c.c1 }]} />}>
        <BarsLines data={d.monthly} bars={[{ key: 'inflow', label: 'Cash in', color: c.c2 }, { key: 'outflow', label: 'Cash out', color: c.c5 }]} lines={[{ key: 'profit', label: 'Profit / loss', color: c.c1 }]} height={300} />
      </Card>
      <div className="grid grid-3">
        <Card title="Revenue" actions={<D to="/revenue" />}>
          <Row l="Sales booked" v={p.revenue.salesBooked} to="/revenue/sales" />
          <Row l="Collected" v={p.revenue.collected} to="/revenue/payments" />
          <Row l="Refunds" v={-p.revenue.refunds} to="/revenue/refunds" />
          <Row l="Net revenue" v={p.revenue.net} strong />
        </Card>
        <Card title="Expenses" actions={<D to="/expenses" />}>
          <Row l="Operating expenses" v={p.expenses.operating} to="/expenses/overview" />
          <Row l="Petty cash" v={p.expenses.petty} to="/petty-cash/cashbook" />
          <Row l="Salaries" v={p.expenses.salaries} to="/expenses/salaries" />
          <Row l="Loan interest" v={p.expenses.loanInterest} to="/liabilities" />
          <Row l="Total expenses" v={p.expenses.total} strong />
        </Card>
        <Card title="Where expenses went"><Donut height={200} data={[{ name: 'Operating', value: p.expenses.operating }, { name: 'Petty cash', value: p.expenses.petty }, { name: 'Salaries', value: p.expenses.salaries }, { name: 'Loan interest', value: p.expenses.loanInterest }].filter(x => x.value > 0)} center={money(p.expenses.total, { short: true })} centerSub="Expenses" /></Card>
      </div>
      <Card title="Financial position" subtitle={`As of ${date(range.to)}`}>
        <div className="grid grid-kpi">
          <Kpi icon={Building2} color="blue" label="Assets (current value)" value={money(pos.assets)} sub={<D to="/assets" />} />
          <Kpi icon={Landmark} color="red" label="Liabilities outstanding" value={money(pos.liabilities)} sub={<D to="/liabilities" />} />
          <Kpi icon={PiggyBank} color="purple" label="Owner capital (net)" value={money(pos.capital)} sub={<D to="/cash-flow/capital" />} />
          <Kpi icon={TrendingUp} color={pos.retained >= 0 ? 'green' : 'red'} label="Retained profit (all time)" value={money(pos.retained)} />
          <Kpi icon={Scale} color="cyan" label="Net worth (assets − liabilities)" value={money(pos.netWorth)} />
        </div>
      </Card>
    </div>
  );
}

function Row({ l, v, to, strong }) {
  return (
    <div className="list-row" style={strong ? { fontWeight: 800, borderTop: '1px solid var(--border)' } : undefined}>
      <span>{to ? <Link to={to}>{l}</Link> : l}</span><span className="mono" style={{ color: v < 0 ? 'var(--red)' : undefined }}>{money(v)}</span>
    </div>
  );
}

function ProfitLoss({ range }) {
  const { data: d, loading, error } = useLoad(`/cashflow${qs(range)}`);
  if (!d) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  const p = d.period;
  const line = (l, v, to, cls) => <tr className={cls}><td>{to ? <Link to={to}>{l}</Link> : l}</td><td className="num" style={{ color: v < 0 ? 'var(--red)' : undefined }}>{money(v)}</td></tr>;
  return (
    <div className="grid grid-2">
      <Card title="Profit & Loss statement" subtitle={`${date(range.from)} – ${date(range.to)}`} pad={false}>
        <table className="tbl"><tbody>
          <tr><td colSpan={2} className="strong">Income</td></tr>
          {line('Collected from customers', p.revenue.collected, '/revenue/payments')}
          {line('Less: refunds', -p.revenue.refunds, '/revenue/refunds')}
          {line('Net revenue', p.revenue.net, null, 'strong')}
          <tr><td colSpan={2} className="strong">Expenses</td></tr>
          {line('Operating expenses', p.expenses.operating, '/expenses/overview')}
          {line('Petty cash spent', p.expenses.petty, '/petty-cash/entries')}
          {line('Salaries (approved + paid)', p.expenses.salaries, '/expenses/salaries')}
          {line('Loan interest', p.expenses.loanInterest, '/liabilities')}
          {line('Total expenses', p.expenses.total, null, 'strong')}
        </tbody><tfoot><tr><td>{p.profit.net >= 0 ? 'NET PROFIT' : 'NET LOSS'} (margin {p.profit.margin}%)</td><td className="num" style={{ color: p.profit.net < 0 ? 'var(--red)' : 'var(--green)' }}>{money(p.profit.net)}</td></tr></tfoot></table>
      </Card>
      <Card title="Cash statement" subtitle="Actual money in and out" pad={false}>
        <table className="tbl"><tbody>
          <tr><td colSpan={2} className="strong">Cash in</td></tr>
          {line('Customer payments', p.cash.in.collected, '/revenue/payments')}
          {line('Owner investment', p.cash.in.investment, '/cash-flow/capital')}
          {line('Loans received', p.cash.in.loansReceived, '/liabilities')}
          <tr><td colSpan={2} className="strong">Cash out</td></tr>
          {line('Refunds', p.cash.out.refunds, '/revenue/refunds')}
          {line('Operating expenses', p.cash.out.operating, '/expenses/overview')}
          {line('Petty cash', p.cash.out.petty, '/petty-cash/entries')}
          {line('Salaries paid', p.cash.out.salariesPaid, '/expenses/salaries')}
          {line('Loan repayments', p.cash.out.loanRepayments, '/expenses/loans')}
          {line('Asset purchases', p.cash.out.assetPurchases, '/assets')}
          {line('Owner drawings', p.cash.out.drawing, '/cash-flow/capital')}
        </tbody><tfoot><tr><td>NET CASH FLOW</td><td className="num" style={{ color: p.cash.net < 0 ? 'var(--red)' : 'var(--green)' }}>{money(p.cash.net)}</td></tr></tfoot></table>
      </Card>
    </div>
  );
}

function Capital() {
  const { isAdmin } = useAuth();
  const [v, setV] = useState(0);
  const [form, setForm] = useState(false);
  const { data: d, loading, error } = useLoad('/capital', [v]);
  const toast = useToast();
  const confirm = useConfirm();
  if (!d) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  const del = async r => {
    if (!(await confirm({ title: 'Delete capital entry?', message: `${titleCase(r.type)} of ${money(r.amount)}`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/capital/${r.id}`); toast.success('Deleted.'); setV(x => x + 1); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi icon={ArrowDownCircle} color="green" label="Owner investment" value={money(d.totals.investment)} />
        <Kpi icon={ArrowUpCircle} color="orange" label="Owner drawings" value={money(d.totals.drawing)} />
        <Kpi icon={PiggyBank} color="purple" label="Net capital" value={money(d.totals.net)} />
      </div>
      <Card pad={false} title="Capital entries" actions={<><ExportButtons dataset="capital" />{isAdmin && <Button size="sm" variant="primary" icon={Plus} onClick={() => setForm(true)}>Add entry</Button>}</>}>
        <DataTable rows={d.rows} empty="No capital entries. Admin can add owner investment or drawings." columns={[
          { key: 'entry_date', label: 'Date', render: r => date(r.entry_date) }, { key: 'type', label: 'Type', render: r => <Badge tone={r.type === 'investment' ? 'green' : 'orange'}>{titleCase(r.type)}</Badge> },
          { key: 'party', label: 'Owner / partner' }, { key: 'note', wrap: true, label: 'Note', render: r => r.note || '—' }, { key: 'amount', label: 'Amount', money: true },
          ...(isAdmin ? [{ key: 'x', label: '', sortable: false, render: r => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del(r)} aria-label="Delete" /> }] : [])]} />
      </Card>
      {form && <CapitalForm onClose={() => setForm(false)} onSaved={() => { setForm(false); setV(x => x + 1); }} />}
    </div>
  );
}

function CapitalForm({ onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ type: 'investment', amount: '', entry_date: todayStr(), party: '', note: '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.post('/capital', f); toast.success('Saved.'); onSaved(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add capital entry" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        <Field label="Type"><Segmented value={f.type} onChange={v => setF(x => ({ ...x, type: v }))} options={[{ value: 'investment', label: 'Investment (money put in)' }, { value: 'drawing', label: 'Drawing (money taken out)' }]} /></Field>
        <div className="form-grid">
          <Field label="Amount (PKR)" required><MoneyInput value={f.amount} onChange={v => setF(x => ({ ...x, amount: v }))} /></Field>
          <Field label="Date" required><Input type="date" value={f.entry_date} onChange={e => setF(x => ({ ...x, entry_date: e.target.value }))} /></Field>
          <Field label="Owner / partner" required full><Input value={f.party} onChange={e => setF(x => ({ ...x, party: e.target.value }))} /></Field>
          <Field label="Note" full><Textarea rows={2} value={f.note} onChange={e => setF(x => ({ ...x, note: e.target.value }))} /></Field>
        </div>
      </div>
    </Modal>
  );
}
