import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, CalendarRange, Landmark, PauseCircle, Pencil, PiggyBank, Plus, Scale, Settings2, Trash2, TriangleAlert } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { api, qs } from '../../lib/api.js';
import { Badge, Button, Card, DataTable, ExportButtons, Field, Input, Kpi, Loader, Modal, MonthPicker, MoneyInput, Notice, Select, Textarea, useConfirm, useToast } from '../../components/ui.jsx';
import { money as fmtMoney, date, monthName, thisMonth, addMonth, titleCase } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);
import { AssumptionsModal, BalanceChart, CashBadge, HowTo, IN_LABELS, OUT_LABELS, PositionCard, ScenarioSwitch } from './shared.jsx';

export default function Forecast() {
  const [scenario, setScenario] = useState('base');
  const [n, setN] = useState('');
  const [v, setV] = useState(0);
  const [settings, setSettings] = useState(false);
  const { data: d, error, loading } = useLoad(`/cashflow/forecast${qs({ scenario, months: n })}`, [v]);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const m = d.months;
  const s = d.summary;
  const a = d.assumptions;
  const line = (label, get, cls, link) => (
    <tr className={cls}><td className="sticky-col">{link ? <Link to={link}>{label}</Link> : label}</td>{m.map(x => { const val = get(x); return <td key={x.key} className="num" style={{ color: typeof val === 'number' && val < 0 ? 'var(--red)' : undefined }}>{typeof val === 'number' ? (Math.abs(val) < 0.5 ? '—' : money(Math.round(val))) : val}</td>; })}</tr>
  );
  return (
    <div className="stack">
      <div className="cf-toolbar">
        <ScenarioSwitch value={scenario} onChange={setScenario} />
        <div style={{ width: 150 }}><Select value={n || String(m.length)} onChange={setN} options={['3', '6', '9', '12', '18'].map(x => ({ value: x, label: `${x} months` }))} ariaLabel="Forecast length" /></div>
        <div className="spacer" />
        {loading && <span className="small muted">Updating…</span>}
        <Button size="sm" icon={Settings2} onClick={() => setSettings(true)}>Assumptions</Button>
        <ExportButtons dataset="cash-forecast" params={{ scenario, months: m.length }} />
      </div>
      <PositionCard pos={d.position} />
      <div className="grid grid-kpi">
        <Kpi icon={ArrowDownCircle} color="green" label="Expected cash in" value={money(d.totals.inflow)} sub={`${m.length} month(s) · ${d.scenario.label}`} />
        <Kpi icon={ArrowUpCircle} color="red" label="Expected cash out" value={money(d.totals.outflow)} sub="Salaries, rent, bills, loans, tax…" />
        <Kpi icon={Scale} color={d.totals.net >= 0 ? 'cyan' : 'orange'} label="Net cash flow" value={money(d.totals.net)} sub={`Closing ${money(d.totals.closing)}`} />
        <Kpi icon={TriangleAlert} color={s.deficitMonths ? 'red' : s.belowBufferMonths ? 'orange' : 'green'} label="Months with a deficit" value={s.deficitMonths} sub={`${s.belowBufferMonths} below buffer · ${s.surplusMonths} surplus`} />
        <Kpi icon={Landmark} color="purple" label="Most finance needed" value={money(s.maxNeed)} sub={<Link to="/cash-flow/surplus-deficit">How to fund it →</Link>} />
        <Kpi icon={PiggyBank} color="blue" label="Largest idle surplus" value={money(s.maxSurplus)} sub="Above the safety buffer" />
      </div>
      <Card title="Cash budget chart" subtitle="Each month: cash in, cash out, closing balance and the lowest point inside the month">
        <BalanceChart data={m} lowKey="low" buffer={d.buffer} height={320} />
      </Card>
      <Card title="Cash budget" subtitle={`${d.scenario.label} · amounts in PKR · first column = rest of this month from today`} pad={false}>
        <div className="table-wrap cf-budget">
          <table className="tbl">
            <thead><tr><th className="sticky-col">Item</th>{m.map(x => <th key={x.key} className="num">{x.label}</th>)}</tr></thead>
            <tbody>
              {line('Opening cash', x => x.opening, 'strong')}
              <tr className="sec"><td className="sticky-col" colSpan={m.length + 1}>Cash in</td></tr>
              {Object.keys(IN_LABELS).map(k => line(IN_LABELS[k], x => x.in[k], '', k === 'planned' ? '#plan' : k === 'receivables' || k === 'overdue' ? '/cash-flow/working-capital' : undefined))}
              {line('Total cash in', x => x.inflow, 'strong text-green')}
              <tr className="sec"><td className="sticky-col" colSpan={m.length + 1}>Cash out</td></tr>
              {Object.keys(OUT_LABELS).map(k => line(OUT_LABELS[k], x => x.out[k], '', { salaries: '/salary', rent: '/cash-flow/payments', bills: '/cash-flow/payments', payables: '/cash-flow/payments', loans: '/liabilities', planned: '#plan' }[k]))}
              {line('Total cash out', x => x.outflow, 'strong text-red')}
              <tr className="sec"><td className="sticky-col" colSpan={m.length + 1}>Result</td></tr>
              {line('Net cash flow', x => x.net, 'strong')}
              {line('Closing cash', x => x.closing, 'strong')}
              {line('Lowest point in the month', x => <span title={date(x.lowDate)} className={x.low < 0 ? 'text-red' : ''}>{money(Math.round(x.low))}<small className="muted"> · {date(x.lowDate)}</small></span>)}
              {line('Safety buffer', x => x.buffer)}
              {line('Surplus / deficit', x => <CashBadge status={x.status} />)}
              {line('Surplus above buffer', x => x.surplus, 'text-green')}
              {line('Finance needed to keep the buffer', x => x.need, 'text-red')}
              {line('Suggested funding', x => (x.financing.length || x.unfunded ? <div className="cf-fund">{x.financing.map(f => <span key={f.source}>{f.source}: {money(f.amount)} <small>@{f.rate}%</small></span>)}{x.unfunded > 0 && <span className="text-red">Unfunded: {money(x.unfunded)}</span>}</div> : '—'))}
            </tbody>
          </table>
        </div>
      </Card>
      {d.held.length > 0 && (
        <Card title={<span className="row" style={{ gap: 6 }}><PauseCircle size={16} />Payments on hold, not in this forecast</span>} subtitle="Release them or give a “hold until” date in Payment control" pad={false} actions={<Link className="btn btn-sm" to="/cash-flow/payments?status=hold">Payment control</Link>}>
          <DataTable search={false} rows={d.held} columns={[{ key: 'ref_no', label: 'Ref #', render: r => <span className="mono">{r.ref_no}</span> }, { key: 'title', label: 'Expense' }, { key: 'hold_until', label: 'Hold until', render: r => date(r.hold_until) }, { key: 'reason', label: 'Why not counted', wrap: true }, { key: 'amount', label: 'Amount', money: true }]} />
        </Card>
      )}
      <div className="grid grid-2">
        <Card title="What this forecast is built from">
          <div className="slip-row"><span>Open student installments</span><b>{money(a.receivablesOpen)}</b></div>
          <div className="slip-row"><span>… of which overdue</span><b className="text-red">{money(a.overdueOpen)}</b></div>
          <div className="slip-row"><span>On-time collection / overdue recovery</span><b>{a.collection_rate}% / {a.overdue_collection}%</b></div>
          <div className="slip-row"><span>New-sales cash per normal month</span><b>{money(a.salesBase)}</b></div>
          <div className="slip-row"><span>Growth per month · tax on collections</span><b>{a.growth_pct}% · {a.tax_rate}%</b></div>
          <div className="slip-row"><span>Salaries per month ({a.salary.basis})</span><b>{money(a.salary.monthly)}</b></div>
          <div className="slip-row"><span>Variable expenses per month (average)</span><b>{money(a.variableAvg)}</b></div>
          <div className="slip-row"><span>Petty cash &amp; staff budgets per month (average)</span><b>{money(a.pettyAvg)}</b></div>
          <div className="slip-row"><span>Recurring bills · loans · planned items</span><b>{a.recurring} · {a.loans} · {a.planItems}</b></div>
          <HowTo>History used: {a.historyMonths.length ? a.historyMonths.map(x => monthName(x, true)).join(', ') : 'this month only (new business)'}. Change any number in Assumptions.</HowTo>
        </Card>
        <Card title="Reading the cash budget">
          <ul className="cf-tips">
            <li><CalendarRange /><span><b>Inflow:</b> sales revenue (new deals × seasonality) and receivables collection (installment due dates × collection %).</span></li>
            <li><ArrowUpCircle /><span><b>Outflow:</b> payments (bills, subscriptions), salaries, rent, taxes, loans and the average of variable &amp; petty spending.</span></li>
            <li><TriangleAlert /><span><b>Deficit</b> = the month’s lowest point goes below zero; <b>below buffer</b> = above zero but under your safety buffer. Fund it with the cheapest line first, or hold payments.</span></li>
            <li><PiggyBank /><span><b>Surplus</b> = cash above the buffer at the month’s lowest point — invest it short-term (see Cash Models).</span></li>
          </ul>
        </Card>
      </div>
      <PlanItems id="plan" onChanged={() => setV(x => x + 1)} />
      <AssumptionsModal open={settings} onClose={() => setSettings(false)} onSaved={() => setV(x => x + 1)} />
    </div>
  );
}

const REPEAT = [{ value: 'once', label: 'Once' }, { value: 'monthly', label: 'Every month' }, { value: 'quarterly', label: 'Every 3 months' }, { value: 'yearly', label: 'Every year' }];

function PlanItems({ id, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [v, setV] = useState(0);
  const [form, setForm] = useState(null);
  const { data } = useLoad('/cashflow/plan', [v]);
  const edit = can('cashflow', 'edit');
  const del = async r => {
    if (!(await confirm({ title: 'Delete planned item?', message: `${r.title} · ${money(r.amount)}`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/cashflow/plan/${r.id}`); toast.success('Deleted.'); setV(x => x + 1); onChanged(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Card id={id} title="Planned cash items" subtitle="Things the ERP cannot know yet: university commissions, owner money, advance tax, expo fees, a new branch…" pad={false}
      actions={edit && <Button size="sm" variant="primary" icon={Plus} onClick={() => setForm({})}>Add planned item</Button>}>
      <DataTable rows={data?.rows || []} loading={!data} empty="No planned items yet. Add expected university commissions, tax payments or other big amounts." columns={[
        { key: 'direction', label: 'In / out', render: r => <Badge tone={r.direction === 'in' ? 'green' : 'red'}>{r.direction === 'in' ? 'Cash in' : 'Cash out'}</Badge> },
        { key: 'title', label: 'Item', render: r => <div className="cell-2"><b>{r.title}</b><small>{r.category}</small></div> },
        { key: 'start_month', label: 'When', render: r => `${r.day} ${monthName(r.start_month)}${r.repeat !== 'once' ? ` · ${REPEAT.find(x => x.value === r.repeat)?.label.toLowerCase()}${r.end_month ? ` until ${monthName(r.end_month)}` : ''}` : ''}` },
        { key: 'probability', label: 'Chance', render: r => `${r.probability}%` },
        { key: 'active', label: 'Status', render: r => <Badge tone={r.active ? 'green' : 'grey'}>{r.active ? 'Counted' : 'Paused'}</Badge> },
        { key: 'amount', label: 'Amount', money: true },
        ...(edit ? [{ key: 'x', label: '', sortable: false, render: r => <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setForm(r)} /><Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => del(r)} /></span> }] : [])]} />
      {form && <PlanForm record={form.id ? form : null} categories={data?.categories} onClose={() => setForm(null)} onSaved={() => { setForm(null); setV(x => x + 1); onChanged(); }} />}
    </Card>
  );
}

function PlanForm({ record, categories, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ direction: record?.direction || 'in', category: record?.category || '', title: record?.title || '', amount: record ? String(record.amount) : '', start_month: record?.start_month || addMonth(thisMonth(), 1),
    repeat: record?.repeat || 'once', end_month: record?.end_month || '', day: String(record?.day || 15), probability: String(record?.probability ?? 100), note: record?.note || '', active: record ? record.active : true }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = k => x => setF(s => ({ ...s, [k]: x?.target ? (x.target.type === 'checkbox' ? x.target.checked : x.target.value) : x }));
  const cats = categories?.[f.direction] || [];
  const save = async () => {
    setErr(''); setBusy(true);
    try { record ? await api.put(`/cashflow/plan/${record.id}`, f) : await api.post('/cashflow/plan', f); toast.success('Saved — the forecast includes it now.'); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={record ? 'Edit planned item' : 'Add planned cash item'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <div className="form-grid">
          <Field label="Cash in or out" required><Select value={f.direction} onChange={x => setF(s => ({ ...s, direction: x, category: '' }))} options={[{ value: 'in', label: 'Cash in (receipt)' }, { value: 'out', label: 'Cash out (payment)' }]} ariaLabel="Direction" /></Field>
          <Field label="Category" required><Select value={f.category} onChange={set('category')} options={cats.map(c => ({ value: c, label: titleCase(c) }))} placeholder="Choose" ariaLabel="Category" /></Field>
          <Field label="Title" required full><Input value={f.title} onChange={set('title')} maxLength={160} placeholder={f.direction === 'in' ? 'e.g. Commission from University of Hertfordshire (Sep intake)' : 'e.g. Advance income tax (quarterly)'} /></Field>
          <Field label="Amount (PKR)" required><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
          <Field label="Chance it happens" hint="Forecast counts amount × chance"><Select value={f.probability} onChange={set('probability')} options={['100', '90', '75', '50', '25', '10'].map(x => ({ value: x, label: `${x}%` }))} ariaLabel="Chance" /></Field>
          <Field label="Month" required><MonthPicker value={f.start_month} onChange={set('start_month')} /></Field>
          <Field label="Day of the month"><Select value={f.day} onChange={set('day')} options={Array.from({ length: 28 }, (_, i) => String(i + 1))} ariaLabel="Day" /></Field>
          <Field label="Repeats"><Select value={f.repeat} onChange={set('repeat')} options={REPEAT} ariaLabel="Repeats" /></Field>
          {f.repeat !== 'once' && <Field label="Until (optional)"><Input type="month" value={f.end_month} onChange={set('end_month')} /></Field>}
          <Field label="Note" full><Textarea rows={2} value={f.note} onChange={set('note')} maxLength={1000} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /><span>Count this item in the forecast</span></label>
      </div>
    </Modal>
  );
}
