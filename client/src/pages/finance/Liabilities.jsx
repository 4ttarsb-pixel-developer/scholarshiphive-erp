import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Landmark, Clock, Percent, CheckCircle2, Plus, Pencil, Trash2, Banknote, Hourglass, CalendarRange, HandCoins } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { api, qs } from '../../lib/api.js';
import { useFormDef, CustomValues } from '../../lib/forms.jsx';
import { Badge, Button, Card, DataTable, ExportButtons, Field, Input, Kpi, Loader, Modal, MoneyInput, Notice, Select, useConfirm, useToast } from '../../components/ui.jsx';
import { Donut } from '../../components/charts.jsx';
import { money, date, titleCase, todayStr, monthStart, monthEnd } from '../../lib/format.js';
import { AnalyticsToolbar, ChartCard, Delta, PeriodTable, useAnalyticsState, useOverview } from './shared.jsx';

const TITLES = {
  overview: ['Liabilities', 'Loans and money ScholarshipHive owes — split into current (due within 12 months) and long-term.'],
  all: ['All liabilities', 'Every loan and payable. Every repayment also appears in Expenses → Loans.'],
  current: ['Current liabilities', 'Amounts due within the next 12 months.'],
  'non-current': ['Non-current liabilities', 'Long-term amounts due after 12 months.'],
};

export default function Liabilities() {
  const { tab = 'overview' } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const [t, s] = TITLES[tab] || TITLES.overview;
  return (
    <>
      <div className="page-head">
        <div><h1>{t}</h1><p>{s}</p></div>
        <div className="page-actions">{can('liabilities', 'edit') && <Button variant="primary" icon={Plus} onClick={() => nav('/liabilities/new')}>Add liability / loan</Button>}</div>
      </div>
      {tab === 'overview' && <Overview />}
      {['all', 'current', 'non-current'].includes(tab) && <List term={tab === 'all' ? '' : tab.replace('-', '_')} key={tab} />}
      {!TITLES[tab] && <Notice type="warn">Page not found.</Notice>}
    </>
  );
}

function Overview() {
  const [st, set] = useAnalyticsState('liabilities', { chart: 'stacked' });
  const { data: d, loading, error } = useOverview(st);
  const { data: list } = useLoad(`/liabilities${qs({ from: st.from, to: st.to })}`, [st.from, st.to]);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const p = d.position; const ch = d.change; const f = d.flows;
  return (
    <div className="stack" style={{ gap: 16, position: 'relative' }}>
      {loading && <div className="soft-loading" />}
      <AnalyticsToolbar state={st} set={set} right={<ExportButtons dataset="liabilities" params={{ from: st.from, to: st.to }} />} />
      <div className="grid grid-kpi">
        <Kpi icon={Landmark} color="red" label="Total outstanding" value={money(p.liabilities.total)} sub={<><Delta pct={ch.liabilities.pct} invert amount={ch.liabilities.change} /> vs start of period</>} />
        <Kpi icon={Hourglass} color="orange" label="Current (within 12 months)" value={money(p.liabilities.current)} sub={<Link to="/liabilities/current">Open list</Link>} />
        <Kpi icon={CalendarRange} color="purple" label="Non-current (long-term)" value={money(p.liabilities.nonCurrent)} sub={<Link to="/liabilities/non-current">Open list</Link>} />
        <Kpi icon={HandCoins} color="blue" label="New borrowing in period" value={money(f.liabilitiesTaken)} sub={`${f.liabilitiesTakenCount} new`} />
        <Kpi icon={CheckCircle2} color="green" label="Repaid in period" value={money(f.repayments)} />
      </div>
      <div className="grid grid-main">
        <ChartCard title="Liabilities over time" subtitle="Outstanding at the end of each period" data={d.series}
          series={[{ key: 'currentLiab', label: 'Current', color: 'var(--chart-3)' }, { key: 'nonCurrentLiab', label: 'Non-current', color: 'var(--chart-5)' }]} type={st.chart} />
        <Card title="Outstanding by category"><Donut data={p.liabilities.byCategory} center={money(p.liabilities.total, { short: true })} centerSub="Outstanding" /></Card>
      </div>
      <div className="grid grid-2">
        <ChartCard title="New borrowing vs repayments (ups & downs)" data={d.series} series={[{ key: 'liabilitiesTaken', label: 'New borrowing', color: 'var(--chart-5)' }, { key: 'repayments', label: 'Repaid', color: 'var(--chart-2)' }]} type={st.chart === 'stacked' ? 'column' : st.chart} height={260} />
        <Card title="Debt ratios" subtitle="Health check from the balance sheet">
          <Ratio label="Current ratio" sub="Current assets ÷ current liabilities (above 1 is healthy)" v={p.ratios.current} />
          <Ratio label="Quick ratio" sub="High liquid assets ÷ current liabilities" v={p.ratios.quick} />
          <Ratio label="Debt-to-equity" sub="Liabilities ÷ owner's equity (lower is safer)" v={p.ratios.debtToEquity} />
          <Ratio label="Debt ratio" sub="Liabilities as % of assets" v={p.ratios.debtRatio} pct />
        </Card>
      </div>
      {list && <Card pad={false} title="Active liabilities" actions={<Link className="small" to="/liabilities/all">See all</Link>}>
        <DataTable search={false} pageSize={8} rows={list.rows.filter(r => r.status === 'active')} empty="No active liabilities." columns={[
          { key: 'title', label: 'Title', render: r => <b data-no-translate>{r.title}</b> }, { key: 'category', label: 'Category' }, { key: 'lender', label: 'Lender', render: r => <span data-no-translate>{r.lender}</span> },
          { key: 'current_portion', label: 'Current', money: true }, { key: 'non_current_portion', label: 'Non-current', money: true }, { key: 'next_due', label: 'Next due', render: r => (r.next_due ? date(r.next_due) : '—') }]} />
      </Card>}
      <Card pad={false} title="Period breakdown" subtitle="Up / down = change of total liabilities vs the previous period (↑ red = owing more)">
        <PeriodTable series={d.series} cols={[{ key: 'currentLiab', label: 'Current' }, { key: 'nonCurrentLiab', label: 'Non-current' }, { key: 'liabilities', label: 'Total' }, { key: 'liabilitiesTaken', label: 'New borrowing' }, { key: 'repayments', label: 'Repaid' }]} changeKey="liabilitiesChange" invert />
      </Card>
    </div>
  );
}

export function Ratio({ label, sub, v, pct }) {
  return <div className="ratio-row"><div><b>{label}</b><small>{sub}</small></div><b className="mono">{v === null || v === undefined ? '—' : pct ? `${v}%` : v}</b></div>;
}

function List({ term }) {
  const { can, isAdmin } = useAuth();
  const nav = useNavigate();
  const [v, setV] = useState(0);
  const [open, setOpen] = useState(null);
  const [f, setF] = useState({ category: '', status: '' });
  const { def } = useFormDef('liabilities');
  const params = { from: monthStart(), to: monthEnd(), term, category: f.category, status: f.status };
  const { data: d, loading, error } = useLoad(`/liabilities${qs(params)}`, [v]);
  const cats = useMemo(() => [{ value: '', label: 'All categories' }, ...(def?.lists?.category?.options || []).map(o => ({ value: o.value, label: o.label }))], [def]);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const t = d.totals;
  return (
    <div className="stack" style={{ gap: 16, position: 'relative' }}>
      {loading && <div className="soft-loading" />}
      <div className="grid grid-kpi">
        <Kpi icon={Landmark} color="blue" label="Total principal" value={money(t.principal)} sub={`${t.active} active`} />
        <Kpi icon={Percent} color="purple" label="Total interest" value={money(t.interest)} />
        <Kpi icon={CheckCircle2} color="green" label="Repaid so far" value={money(t.paid)} />
        <Kpi icon={Clock} color="red" label="Outstanding" value={money(t.outstanding)} sub={`This month repaid ${money(d.paidInRange)}`} />
        <Kpi icon={Hourglass} color="orange" label="Current / non-current" value={money(t.current)} sub={`Long-term ${money(t.nonCurrent)}`} />
      </div>
      <div className="grid grid-main">
        <Card pad={false} title={term ? TITLES[term.replace('_', '-')][0] : 'All liabilities'} actions={<ExportButtons dataset="liabilities" params={{ from: monthStart(), to: monthEnd() }} />}>
          <div className="card-toolbar">
            <div style={{ width: 220 }}><Select value={f.category} onChange={x => setF(o => ({ ...o, category: x }))} options={cats} ariaLabel="Category" /></div>
            <div style={{ width: 150 }}><Select value={f.status} onChange={x => setF(o => ({ ...o, status: x }))} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }]} ariaLabel="Status" /></div>
            <span className="small muted">{d.filtered.count} shown · {money(d.filtered.outstanding)} outstanding</span>
          </div>
          <DataTable rows={d.rows} onRowClick={r => setOpen(r.id)} empty="No liabilities match these filters." searchKeys={['title', 'lender', 'category', 'sub_category', 'reference_no']} columns={[
            { key: 'title', label: 'Title', render: r => <b data-no-translate>{r.title}</b> },
            { key: 'category', label: 'Category', render: r => <span>{r.category || titleCase(r.type)}{r.sub_category ? <span className="muted"> › {r.sub_category}</span> : ''}</span> },
            { key: 'lender', label: 'Lender', render: r => <span data-no-translate>{r.lender}</span> },
            { key: 'interest_type', label: 'Interest', render: r => r.interest_type === 'none' ? 'None' : `${titleCase(r.interest_type)} ${r.annual_rate}%` },
            { key: 'installment', label: 'Installment', money: true },
            ...(term === 'non_current' ? [] : [{ key: 'current_portion', label: 'Current', money: true }]),
            ...(term === 'current' ? [] : [{ key: 'non_current_portion', label: 'Non-current', money: true }]),
            { key: 'outstanding', label: 'Outstanding', money: true },
            { key: 'progress', label: 'Paid', render: r => <div style={{ minWidth: 90 }}><div className="small">{r.progress}%</div><div className="bar"><span style={{ width: `${r.progress}%`, background: 'var(--green)', color: 'var(--green)' }} /></div></div> },
            { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }]} />
        </Card>
        <Card title="Outstanding by category"><Donut data={d.byCategory} center={money(d.filtered.outstanding, { short: true })} centerSub="Outstanding" /></Card>
      </div>
      {open && <Detail id={open} def={def} canEdit={can('liabilities', 'edit')} isAdmin={isAdmin} onClose={() => setOpen(null)} onEdit={l => nav(`/liabilities/${l.id}/edit`)} onChanged={() => setV(x => x + 1)} />}
    </div>
  );
}

function Detail({ id, def, canEdit, isAdmin, onClose, onEdit, onChanged }) {
  const { data: l, error, reload } = useLoad(`/liabilities/${id}`);
  const [pay, setPay] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const del = async () => {
    if (!(await confirm({ title: 'Delete liability?', message: 'All its repayments are deleted too.', danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/liabilities/${id}`); toast.success('Deleted.'); onChanged(); onClose(); } catch (e) { toast.error(e.message); }
  };
  const delPay = async p => {
    if (!(await confirm({ title: 'Delete repayment?', message: `${money(p.amount)} on ${date(p.payment_date)}`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/liabilities/payments/${p.id}`); toast.success('Deleted.'); reload(); onChanged(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open onClose={onClose} drawer title={l ? l.title : 'Liability'} subtitle={l ? `${l.category || titleCase(l.type)} · ${l.lender}` : ''}
      footer={l && <>{isAdmin && <Button variant="danger" icon={Trash2} onClick={del}>Delete</Button>}{canEdit && <Button icon={Pencil} onClick={() => onEdit(l)}>Edit</Button>}{canEdit && l.outstanding > 0 && <Button variant="primary" icon={Banknote} onClick={() => setPay(true)}>Record repayment</Button>}</>}>
      {!l ? (error ? <Notice type="error">{error.message}</Notice> : <Loader />) : (
        <div className="stack">
          <div className="grid grid-kpi" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <Kpi icon={Landmark} color="blue" label="Principal" value={money(l.principal)} />
            <Kpi icon={Percent} color="purple" label="Total interest" value={money(l.total_interest)} />
            <Kpi icon={Clock} color="red" label="Outstanding" value={money(l.outstanding)} sub={`${l.progress}% paid`} />
          </div>
          <dl className="dl">
            <dt>Category</dt><dd>{l.category || '—'}{l.sub_category ? ` › ${l.sub_category}` : ''} · {titleCase(l.type)}</dd>
            <dt>Interest</dt><dd>{l.interest_type === 'none' ? 'No interest' : `${titleCase(l.interest_type)} · ${l.annual_rate}% per year${l.interest_type === 'compound' ? ` · compounded ${l.compounding}` : ''}`}</dd>
            <dt>Total payable</dt><dd>{money(l.total_payable)}</dd>
            <dt>Monthly installment</dt><dd>{money(l.installment)} × {l.term_months} months</dd>
            <dt>Start → end</dt><dd>{date(l.start_date)} → {date(l.end_date)}</dd>
            <dt>Next due</dt><dd>{l.next_due ? date(l.next_due) : 'Fully paid'}</dd>
            <dt>Lender phone</dt><dd data-no-translate>{l.contact_phone || '—'}</dd>
            <dt>Account / reference no.</dt><dd data-no-translate>{l.reference_no || '—'}</dd>
            <dt>Purpose</dt><dd data-no-translate>{l.purpose || '—'}</dd>
            <dt>Collateral / security</dt><dd data-no-translate>{l.collateral || '—'}</dd>
            <CustomValues def={def} values={l.custom_fields} />
            <dt>Notes</dt><dd data-no-translate>{l.notes || '—'}</dd>
          </dl>
          <Card title="Repayments" pad={false}>
            <DataTable search={false} rows={l.payments} empty="No repayments yet." columns={[{ key: 'payment_date', label: 'Date', render: r => date(r.payment_date) }, { key: 'method', label: 'Method' }, { key: 'note', wrap: true, label: 'Note', render: r => r.note || '—' }, { key: 'amount', label: 'Amount', money: true }, ...(isAdmin ? [{ key: 'x', label: '', sortable: false, render: r => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => delPay(r)} aria-label="Delete" /> }] : [])]} />
          </Card>
          <Card title="Repayment schedule" pad={false}>
            <DataTable search={false} pageSize={12} rows={l.schedule.map(s => ({ ...s, id: s.no }))} columns={[{ key: 'no', label: '#' }, { key: 'due_date', label: 'Due date', render: r => date(r.due_date) }, { key: 'amount', label: 'Installment', money: true }, { key: 'balance_after', label: 'Balance after', money: true }]} />
          </Card>
        </div>
      )}
      {pay && <RepayModal l={l} onClose={() => setPay(false)} onSaved={() => { setPay(false); reload(); onChanged(); }} />}
    </Modal>
  );
}

function RepayModal({ l, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ amount: String(Math.min(l.installment, l.outstanding)), payment_date: todayStr(), method: 'Bank Transfer', note: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const amt = Number(f.amount);
    if (!(amt > 0)) return setErr('Enter the amount repaid.');
    if (amt > l.outstanding) return setErr(`Amount is more than the outstanding ${money(l.outstanding)}.`);
    if (!f.payment_date) return setErr('Payment date is required.');
    if (f.payment_date < l.start_date) return setErr('Payment date cannot be before the start date.');
    if (f.payment_date > todayStr()) return setErr('Payment date cannot be in the future.');
    setBusy(true); setErr('');
    try { await api.post(`/liabilities/${l.id}/payments`, f); toast.success('Repayment recorded — it also shows in Expenses → Loans.'); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Record repayment" subtitle={`Outstanding ${money(l.outstanding)}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <div className="form-grid">
          <Field label="Amount (PKR)" required><MoneyInput value={f.amount} onChange={v => setF(x => ({ ...x, amount: v }))} /></Field>
          <Field label="Date" required><Input type="date" min={l.start_date} max={todayStr()} value={f.payment_date} onChange={e => setF(x => ({ ...x, payment_date: e.target.value }))} /></Field>
          <Field label="Method"><Select value={f.method} onChange={v => setF(x => ({ ...x, method: v }))} options={['Bank Transfer', 'Cash', 'Cheque', 'JazzCash', 'EasyPaisa', 'Card', 'Online Gateway', 'Other']} /></Field>
          <Field label="Note"><Input value={f.note} maxLength={500} onChange={e => setF(x => ({ ...x, note: e.target.value }))} /></Field>
        </div>
      </div>
    </Modal>
  );
}
