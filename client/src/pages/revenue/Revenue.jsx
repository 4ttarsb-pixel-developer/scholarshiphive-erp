import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Banknote, CircleDollarSign, Clock, Percent, RotateCcw, Plus, FileDown, Trash2, Receipt, CalendarClock, Sparkles, UserPlus, Wallet, Lightbulb,
  Search, Target, AlertTriangle, Handshake, ListChecks,
} from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { useLang } from '../../lib/i18n.jsx';
import { useLayout } from '../../components/Layout.jsx';
import { api, qs } from '../../lib/api.js';
import { useDebounced, useServerList, useTableQuery } from '../../lib/useServerList.js';
import { Badge, Button, Card, DataTable, DateRange, Field, Flag, Input, Kpi, Loader, Modal, MoneyInput, Notice, Person, Select, Textarea, useConfirm, useToast, Legend } from '../../components/ui.jsx';
import ServerTable, { CardTabs, FilterChips } from '../../components/ServerTable.jsx';
import { BarsLines, Donut, TrendLine, ShareList, useColors } from '../../components/charts.jsx';
import { money, date, monthEnd, monthStart, monthName, todayStr } from '../../lib/format.js';
import SaleDetail from './SaleDetail.jsx';

const EMPTY = { q: '', status: '', method: '', category: '', package: '', country: '', staff: '', service: '' };
const LABELS = { q: 'Search', status: 'Status', method: 'Method', category: 'Category', package: 'Package', country: 'Country', staff: 'Staff', service: 'Service' };
const TITLES = {
  overview: ['Revenue', 'Track your sales, collections and overall revenue performance.'],
  customers: ['Customers', 'Every student / client and their balances.'],
  sales: ['Sales & Deals', 'Every deal with filters — click a row for the receipt, payment plan and documents.'],
  invoices: ['Invoices', 'Download a PDF receipt / invoice for any deal.'],
  payments: ['Payments', 'Money received from customers.'],
  upcoming: ['Upcoming Payments', 'Balances still to be collected, by next due date.'],
  refunds: ['Refunds', 'Money returned to customers.'],
  forecast: ['Revenue Forecast', 'Based on the last 6 months of collections and the installment plans.'],
};

export const statusCol = { key: 'status', label: 'Status', sort: 'status', render: r => <Badge status={r.status}>{r.status}</Badge> };

export default function Revenue() {
  const { tab = 'overview' } = useParams();
  const [sp, setSp] = useSearchParams();
  const { can } = useAuth();
  const { dataVersion } = useLayout();
  const nav = useNavigate();
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const [f, setF] = useState(EMPTY);
  const [openSale, setOpenSale] = useState(sp.get('open') ? Number(sp.get('open')) : null);
  const [payFor, setPayFor] = useState(null);
  const [refundFor, setRefundFor] = useState(null);
  const [v, setV] = useState(0);
  const bump = () => setV(x => x + 1);
  const edit = can('revenue', 'edit');
  useEffect(() => { const o = sp.get('open'); if (o) { setOpenSale(Number(o)); setSp(p => { const n = new URLSearchParams(p); n.delete('open'); return n; }, { replace: true }); } }, [sp]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!TITLES[tab]) return <Notice type="warn">Page not found.</Notice>;
  const [t, sub] = TITLES[tab];
  const filtered = ['overview', 'sales', 'invoices'].includes(tab);
  const noRange = ['customers', 'upcoming', 'forecast'].includes(tab);
  const params = { ...range, v, dv: dataVersion };
  return (
    <>
      <div className="page-head">
        <div><h1>{t}</h1><p>{sub}</p></div>
        <div className="page-actions">
          {!noRange && <DateRange from={range.from} to={range.to} allowAll={filtered} onChange={(from, to) => setRange({ from, to })} />}
          {edit && <Button variant="primary" icon={Plus} onClick={() => nav('/revenue/new')}>New Sale / Deal</Button>}
        </div>
      </div>
      {filtered && <Filters f={f} setF={setF} />}
      {tab === 'overview' && <Overview f={f} params={params} onOpen={setOpenSale} setF={setF} />}
      {(tab === 'sales' || tab === 'invoices') && <Deals f={f} params={params} invoices={tab === 'invoices'} onOpen={setOpenSale} />}
      {tab === 'customers' && <Customers params={params} />}
      {tab === 'payments' && <Payments params={params} edit={edit} onAdd={() => setPayFor({})} reload={bump} />}
      {tab === 'upcoming' && <Upcoming params={params} edit={edit} onPay={s => setPayFor(s)} onOpen={setOpenSale} />}
      {tab === 'refunds' && <Refunds params={params} edit={edit} onAdd={() => setRefundFor({})} reload={bump} />}
      {tab === 'forecast' && <Forecast params={params} />}
      {openSale && <SaleDetail id={openSale} edit={edit} onClose={() => setOpenSale(null)} onPay={s => setPayFor(s)} onRefund={s => setRefundFor(s)} onChanged={bump} version={v} />}
      {payFor && <PaymentModal sale={payFor} onClose={() => setPayFor(null)} onSaved={() => { setPayFor(null); bump(); }} />}
      {refundFor && <RefundModal sale={refundFor} onClose={() => setRefundFor(null)} onSaved={() => { setRefundFor(null); bump(); }} />}
    </>
  );
}

// ═════════ Filters (same as the Revenue Manager) ═════════
function useMeta() {
  const [meta, setMeta] = useState(null);
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    api.get('/revenue/meta').then(setMeta).catch(() => {});
    api.get('/users/directory').then(setStaff).catch(() => {});
  }, []);
  return { meta, staff };
}

function Filters({ f, setF }) {
  const { meta, staff } = useMeta();
  const set = (k, val) => setF(o => ({ ...o, [k]: val }));
  const opts = (list, all) => [{ value: '', label: all }, ...(list || []).filter(x => x !== 'Other').map(x => ({ value: x, label: x }))];
  const staffName = id => staff.find(s => String(s.id) === String(id))?.full_name || id;
  return (
    <Card pad={false} className="filter-card" style={{ marginBottom: 16 }}>
      <div className="filters">
        <div className="search wide"><Search /><input className="input" placeholder="Search client, invoice, phone, email, country, staff…" value={f.q} onChange={e => set('q', e.target.value)} aria-label="Search deals" /></div>
        <Select value={f.status} onChange={x => set('status', x)} options={opts(meta?.statuses, 'All status')} ariaLabel="Status filter" />
        <Select value={f.method} onChange={x => set('method', x)} options={opts(meta?.methods, 'All methods')} ariaLabel="Payment method filter" />
        <Select value={f.category} onChange={x => set('category', x)} options={opts(meta?.categories, 'All categories')} ariaLabel="Category filter" />
        <Select value={f.service} onChange={x => set('service', x)} options={opts(meta?.services, 'All services')} searchable ariaLabel="Service filter" />
        <Select value={f.package} onChange={x => set('package', x)} options={opts(meta?.packages, 'All packages')} ariaLabel="Package filter" />
        <Select value={f.country} onChange={x => set('country', x)} options={opts(meta?.countries, 'All countries')} searchable ariaLabel="Country filter" renderOption={o => <span className="row" style={{ gap: 8 }}>{o.value && <Flag country={o.value} />}{o.label}</span>} />
        <Select value={f.staff} onChange={x => set('staff', x)} options={[{ value: '', label: 'All staff' }, ...staff.map(s => ({ value: String(s.id), label: s.full_name, hint: s.employee_code }))]} searchable ariaLabel="Staff filter" />
      </div>
      <div className="filters-foot">
        <FilterChips items={Object.keys(EMPTY).map(k => ({ key: k, label: LABELS[k], value: k === 'staff' && f[k] ? staffName(f[k]) : f[k], onRemove: () => set(k, '') }))} onClear={() => setF(EMPTY)} />
      </div>
    </Card>
  );
}

const cleanFilters = (f, search) => ({ ...f, q: search });

// ═════════ Overview ═════════
function Overview({ f, params, onOpen, setF }) {
  const search = useDebounced(f.q);
  const fp = { ...cleanFilters(f, search), from: params.from, to: params.to, ...(params.from ? {} : { all: '1' }) };
  const { data: d, loading, error, reload } = useServerList('/revenue/summary', fp, [params.v, params.dv]);
  const c = useColors();
  const nav = useNavigate();
  const { isAdmin, can } = useAuth();
  const { tx } = useLang();
  const [targets, setTargets] = useState(false);
  if (!d) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  const k = d.kpi;
  const drill = key => it => setF(o => ({ ...o, [key]: o[key] === String(it.id ?? it.name) ? '' : String(it.id ?? it.name) }));
  const total = k.collected + k.outstanding;
  const pctOf = n => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const insights = [
    k.trend.collected != null && tx('Collections are {dir} {n}% vs the previous period.', { dir: k.trend.collected >= 0 ? tx('up') : tx('down'), n: Math.abs(k.trend.collected) }),
    k.gross > 0 && tx('Outstanding amount is {n}% of booked revenue.', { n: Math.round((k.outstanding / k.gross) * 1000) / 10 }),
    k.overdue_count > 0 && tx('{n} deal(s) are overdue — {amount} still to collect.', { n: k.overdue_count, amount: money(k.overdue) }),
    d.byCountry[0] && tx('{name} contributed {n}% of revenue.', { name: d.byCountry[0].name, n: d.byCountry[0].share }),
    d.byService[0] && d.byService[0].name !== 'Other' && tx('Top service: {name} ({amount}).', { name: d.byService[0].name, amount: money(d.byService[0].value) }),
    d.forecast[0] && tx("Next month's collection is expected to be {amount}.", { amount: money(d.forecast[0].expected) }),
  ].filter(Boolean);
  const tg = d.targets;
  return (
    <div className="stack" style={{ position: 'relative' }}>
      {loading && <div className="soft-loading" aria-hidden="true" />}
      <div className="grid grid-kpi">
        <Kpi icon={CircleDollarSign} color="blue" label="Gross Revenue (Sales)" value={money(k.gross)} trend={k.trend.gross} sub={`${k.deals} ${tx('deals')}`} />
        <Kpi icon={Banknote} color="green" label="Collected (In Account)" value={money(k.collected)} trend={k.trend.collected} sub="vs last period" />
        <Kpi icon={Clock} color="orange" label="Outstanding" value={money(k.outstanding)} trend={k.trend.outstanding} invert sub={k.overdue_count ? <span className="text-red">{k.overdue_count} {tx('overdue')}</span> : 'vs last period'} />
        <Kpi icon={Percent} color="purple" label="Collection Rate" value={`${k.rate}%`} trend={k.trend.rate} sub="vs last period" />
        <Kpi icon={RotateCcw} color="red" label="Refunds" value={money(k.refunds)} trend={k.trend.refunds} invert sub="vs last period" />
      </div>
      <div className="grid grid-main">
        <Card title="Revenue Overview" subtitle="Last 12 months · filters applied" actions={<Legend items={[{ label: 'Gross Revenue', color: c.c1 }, { label: 'Collected', color: c.c2 }, { label: 'Outstanding', color: c.c3 }]} />}>
          <BarsLines data={d.monthly} height={290} bars={[{ key: 'collected', label: 'Collected', color: c.c2 }, { key: 'outstanding', label: 'Outstanding', color: c.c3 }]} lines={[{ key: 'gross', label: 'Gross Revenue', color: c.c1 }]} />
        </Card>
        <Card title="Revenue by category" subtitle="Click to filter">
          <Donut data={d.byCategory} center={money(k.gross, { short: true })} centerSub="Total Revenue" onSelect={drill('category')} active={f.category} height={190} />
          <ShareList items={d.byCategory} onSelect={drill('category')} active={f.category} />
        </Card>
      </div>
      <div className="grid grid-3">
        <Card title="Revenue by package" subtitle="Click to filter"><ShareList items={d.byPackage} colorIndex={1} onSelect={drill('package')} active={f.package} /></Card>
        <Card title="Revenue by country" subtitle="Click to filter"><ShareList items={d.byCountry} colorIndex={2} onSelect={drill('country')} active={f.country} render={it => <><Flag country={it.name} />{it.name}</>} /></Card>
        <Card title="Collection rate trend" subtitle="Collected ÷ gross, monthly"><TrendLine data={d.monthly} dataKey="rate" percent color={c.c2} /></Card>
      </div>
      <div className="grid grid-3">
        <Card title="Revenue by service" subtitle="Click to filter"><ShareList items={d.byService} colorIndex={3} onSelect={drill('service')} active={f.service} /></Card>
        <Card title="Money split" subtitle="Collected vs still to collect">
          <Donut data={[{ name: 'Collected', value: k.collected, color: c.c2 }, { name: 'Outstanding', value: k.outstanding, color: c.c3 }, { name: 'Refunds', value: k.refunds, color: c.c5 }]} center={`${k.rate}%`} centerSub="Collected" height={170} />
          {[['Collected', k.collected, c.c2], ['Outstanding', k.outstanding, c.c3]].map(([l, val, col]) => (
            <div key={l} className="list-row"><span className="row" style={{ gap: 8 }}><i style={{ width: 9, height: 9, borderRadius: 9, background: col, display: 'inline-block' }} />{l}<small className="muted">{money(val)}</small></span><b>{pctOf(val)}%</b></div>
          ))}
        </Card>
        <Card title="Payment methods" subtitle="Money received on these deals · click to filter"><ShareList items={d.byMethod} colorIndex={4} onSelect={drill('method')} active={f.method} /></Card>
      </div>
      <div className="grid grid-main">
        <Card title={<span className="row" style={{ gap: 8 }}><Target size={16} />Targets — {monthName(tg.month)}</span>} subtitle="Booked sales this month" actions={isAdmin && <Button size="sm" onClick={() => setTargets(true)}>Set targets</Button>}>
          <div className="target-company">
            <div><div className="small muted">Company target</div><div className="kpi-value">{money(tg.company.achieved)}</div><div className="small muted">{tx('of {target}', { target: money(tg.company.target) })} · {tg.company.target ? Math.round((tg.company.achieved / tg.company.target) * 100) : 0}%</div></div>
            <Progress v={tg.company.achieved} t={tg.company.target} />
          </div>
          <div className="target-grid">
            {tg.staff.length ? tg.staff.map(m => (
              <div key={m.id} className="target-row" role="button" tabIndex={0} onClick={() => setF(o => ({ ...o, staff: String(m.id) }))} title="Show this person's deals">
                <div className="row" style={{ justifyContent: 'space-between' }}><b data-no-translate>{m.full_name}</b><small className="muted mono">{money(m.achieved, { short: true })} / {money(m.target, { short: true })} · {m.deals} {tx('deals')}</small></div>
                <Progress v={m.achieved} t={m.target} />
              </div>
            )) : <div className="muted small">No staff targets yet.{isAdmin ? ' Click “Set targets”.' : ''}</div>}
          </div>
        </Card>
        <div className="stack">
          <Card title="Revenue Forecast" subtitle="Based on the last 6 months of collections" actions={<Button size="sm" variant="ghost" onClick={() => nav('/revenue/forecast')}>View details</Button>}>
            <div className="grid grid-3" style={{ gap: 8 }}>{d.forecast.map(x => <div key={x.month} className="card" style={{ padding: 10, textAlign: 'center' }}><div className="small muted">{monthName(x.month, true)} {x.month.slice(0, 4)}</div><b className="mono">{money(x.expected, { short: true })}</b></div>)}</div>
          </Card>
          <Card title={<span className="row" style={{ gap: 8 }}><Lightbulb size={16} color="var(--orange)" />Key Insights</span>}>
            {insights.length ? <ul className="insights">{insights.map(i => <li key={i}>{i}</li>)}</ul> : <div className="muted small">Insights appear once you record sales.</div>}
          </Card>
        </div>
      </div>
      <Transactions f={f} params={params} onOpen={onOpen} />
      {can('revenue', 'edit') && (
        <Card title="Quick Actions">
          <div className="quick-actions">
            {[[Handshake, 'New Sale', '/revenue/new'], [Wallet, 'Record Payment', '/revenue/payments'], [RotateCcw, 'Add Refund', '/revenue/refunds'], [CalendarClock, 'Upcoming', '/revenue/upcoming'], [UserPlus, 'Customers', '/revenue/customers'], [Sparkles, 'Forecast', '/revenue/forecast']].map(([I, l, to]) => (
              <button key={l} className="btn" onClick={() => nav(to)}><I />{l}</button>
            ))}
          </div>
        </Card>
      )}
      {targets && <TargetsModal onClose={() => setTargets(false)} onSaved={() => { setTargets(false); reload(); }} />}
    </div>
  );
}

export function Progress({ v, t }) {
  const p = t ? Math.min(100, (v / t) * 100) : 0;
  return <div className="bar progress"><span style={{ width: `${p}%`, background: p >= 100 ? 'var(--green)' : 'var(--primary)', color: p >= 100 ? 'var(--green)' : 'var(--primary)' }} /></div>;
}

function dealColumns({ invoices, compact }) {
  return [
    { key: 'sale_date', label: 'Date', sort: 'date', render: r => date(r.sale_date) },
    { key: 'customer_name', label: 'Client', sort: 'client', render: r => <span className="cell-flag" data-no-translate><Flag country={r.destination} /><span className="cell-2"><b>{r.customer_name}</b><small>{r.invoice_no}{r.customer_phone ? ` · ${r.customer_phone}` : ''}</small></span></span> },
    { key: 'service', label: 'Service / package', sort: 'package', render: r => <div className="cell-2"><span>{r.service || r.package}</span><small>{r.service ? r.package : r.revenue_category}</small></div> },
    ...(compact ? [] : [{ key: 'employee_name', label: 'Staff', sort: 'staff', render: r => <span data-no-translate>{r.employee_name}</span> }]),
    { key: 'total_amount', label: 'Amount', sort: 'total', money: true },
    { key: 'paid', label: 'Received', sort: 'paid', money: true },
    { key: 'outstanding', label: 'Outstanding', sort: 'balance', money: true, render: r => <span style={{ color: r.outstanding > 0 ? 'var(--red)' : undefined }}>{money(r.outstanding)}</span> },
    { key: 'due', label: 'Next due', sort: 'due', render: r => (r.status === 'Paid' || r.status === 'Refunded' || !r.due ? '—' : <span className={r.status === 'Overdue' ? 'text-red strong' : ''}>{date(r.due)}</span>) },
    statusCol,
    { key: 'pdf', label: invoices ? 'Invoice' : 'Receipt', render: r => <a className="btn btn-sm" href={`/api/revenue/sales/${r.id}/invoice`} onClick={e => e.stopPropagation()} download title="Download PDF"><FileDown />PDF</a> },
  ];
}

function Transactions({ f, params, onOpen }) {
  const [view, setView] = useState('');
  const [q, setQ] = useTableQuery({ sort: 'date', dir: 'desc', limit: 10 });
  const search = useDebounced(f.q);
  const ignoreDates = view === 'upcoming' || view === 'overdue';
  const base = { ...cleanFilters(f, search), ...(ignoreDates || !params.from ? { all: '1' } : { from: params.from, to: params.to }), view };
  const list = useServerList('/revenue/deals', { ...base, page: q.page, limit: q.limit, sort: view === 'upcoming' ? 'due' : q.sort, dir: view === 'upcoming' ? 'asc' : q.dir }, [params.v, params.dv]);
  useEffect(() => { setQ({ page: 1 }); }, [view, f.q, f.status, f.method, f.category, f.package, f.country, f.staff, f.service, params.from, params.to]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card pad={false}>
      <CardTabs value={view} onChange={setView} right={<ExportLinks params={base} />} tabs={[
        { value: '', label: 'Recent transactions', icon: ListChecks }, { value: 'upcoming', label: 'Upcoming payments', icon: CalendarClock },
        { value: 'overdue', label: 'Overdue', icon: AlertTriangle, tone: 'red' }, { value: 'refunds', label: 'Refunds', icon: RotateCcw }]} />
      {ignoreDates && <div className="card-body small muted" style={{ paddingBottom: 0 }}>{view === 'upcoming' ? 'Installments due in the next 30 days (any sale date).' : 'Deals whose next installment date has passed (any sale date).'}</div>}
      {list.error && <div className="card-body"><Notice type="error">{list.error.message}</Notice></div>}
      <ServerTable columns={dealColumns({ compact: true })} data={list.data} loading={list.loading} query={q} onQuery={setQ} onRowClick={r => onOpen(r.id)}
        empty="No transactions match these filters. Clear a filter or add a new sale." pageSizes={[10, 25, 50, 100]}
        footer={d => <tr><td colSpan={3}>{d.total} {d.total === 1 ? 'deal' : 'deals'} · all filtered rows</td><td className="num">{money(d.totals.total)}</td><td className="num">{money(d.totals.paid)}</td><td className="num">{money(d.totals.outstanding)}</td><td colSpan={3} /></tr>} />
    </Card>
  );
}

export function ExportLinks({ params, dataset = 'sales' }) {
  const href = fmt => `/api/export/${dataset}${qs({ ...params, page: undefined, limit: undefined, format: fmt })}`;
  return (
    <div className="row" style={{ gap: 6 }}>
      <a className="btn btn-sm" href={href('csv')} download title="Excel-ready CSV with totals"><FileDown />Excel (CSV)</a>
      <a className="btn btn-sm" href={href('pdf')} download title="Branded PDF report"><Receipt />PDF report</a>
    </div>
  );
}

// ═════════ Sales & deals / Invoices ═════════
function Deals({ f, params, invoices, onOpen }) {
  const [q, setQ] = useTableQuery({ sort: 'date', dir: 'desc', limit: 25 });
  const search = useDebounced(f.q);
  const base = { ...cleanFilters(f, search), ...(params.from ? { from: params.from, to: params.to } : { all: '1' }) };
  const list = useServerList('/revenue/deals', { ...base, page: q.page, limit: q.limit, sort: q.sort, dir: q.dir }, [params.v, params.dv]);
  useEffect(() => { setQ({ page: 1 }); }, [f.q, f.status, f.method, f.category, f.package, f.country, f.staff, f.service, params.from, params.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = list.data?.totals;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi icon={Handshake} color="blue" label="Deals" value={t?.count ?? '—'} />
        <Kpi icon={CircleDollarSign} color="purple" label="Total" value={money(t?.total)} />
        <Kpi icon={Banknote} color="green" label="Received" value={money(t?.paid)} />
        <Kpi icon={Clock} color="orange" label="Outstanding" value={money(t?.outstanding)} />
      </div>
      <Card pad={false} title={invoices ? 'Invoices' : 'Sales & Deals'} actions={<ExportLinks params={base} dataset={invoices ? 'invoices' : 'sales'} />}>
        {list.error && <div className="card-body"><Notice type="error">{list.error.message}</Notice></div>}
        <ServerTable columns={dealColumns({ invoices })} data={list.data} loading={list.loading} query={q} onQuery={setQ} onRowClick={r => onOpen(r.id)}
          empty="No deals match these filters. Use “New Sale / Deal” to add one."
          footer={d => <tr><td colSpan={4}>{d.total} · all filtered rows</td><td className="num">{money(d.totals.total)}</td><td className="num">{money(d.totals.paid)}</td><td className="num">{money(d.totals.outstanding)}</td><td colSpan={3} /></tr>} />
      </Card>
    </div>
  );
}

function Customers({ params }) {
  const { data, loading, error } = useLoad('/revenue/customers', [params.v, params.dv]);
  return (
    <Card pad={false}>
      {error && <div className="card-body"><Notice type="error">{error.message}</Notice></div>}
      <DataTable loading={loading} rows={data || []} tools={<ExportLinks dataset="customers" params={{}} />} empty="Customers appear here when you record a sale." searchKeys={['name', 'phone', 'email', 'country', 'destination']} columns={[
        { key: 'name', label: 'Customer', render: r => <span data-no-translate><Person name={r.name} sub={[r.phone, r.email].filter(Boolean).join(' · ')} /></span> },
        { key: 'destination', label: 'Destination', render: r => <span className="cell-flag"><Flag country={r.destination} />{r.destination || '—'}</span> },
        { key: 'deals', label: 'Deals', align: 'right' }, { key: 'total', label: 'Total', money: true }, { key: 'paid', label: 'Received', money: true },
        { key: 'outstanding', label: 'Outstanding', money: true }, { key: 'last_sale', label: 'Last sale', render: r => date(r.last_sale) }]} />
    </Card>
  );
}

function Payments({ params, edit, onAdd, reload }) {
  const { data, loading, error } = useLoad(`/revenue/payments${qs({ from: params.from || '2000-01-01', to: params.to || '2100-12-31' })}`, [params.v, params.dv]);
  const confirm = useConfirm();
  const toast = useToast();
  const del = async r => {
    if (!(await confirm({ title: 'Delete payment?', message: `${money(r.amount)} · ${date(r.payment_date)} · ${r.invoice_no}`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/revenue/payments/${r.id}`); toast.success('Payment deleted.'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Card pad={false}>
      {error && <div className="card-body"><Notice type="error">{error.message}</Notice></div>}
      <DataTable loading={loading} rows={data || []} tools={<>{edit && <Button size="sm" variant="primary" icon={Plus} onClick={onAdd}>Record payment</Button>}<ExportLinks dataset="payments" params={{ from: params.from, to: params.to }} /></>} empty="No payments in this period." columns={[
        { key: 'payment_date', label: 'Date', render: r => date(r.payment_date) }, { key: 'invoice_no', label: 'Invoice #' }, { key: 'customer_name', label: 'Customer', render: r => <span data-no-translate>{r.customer_name}</span> },
        { key: 'employee_name', label: 'Sales staff', render: r => <span data-no-translate>{r.employee_name}</span> }, { key: 'method', label: 'Method' }, { key: 'reference', label: 'Reference', render: r => r.reference || '—' }, { key: 'amount', label: 'Amount', money: true },
        ...(edit ? [{ key: 'x', label: '', sortable: false, render: r => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del(r)} aria-label="Delete" /> }] : [])]}
        footer={list => <tr><td colSpan={6}>Total ({list.length})</td><td className="num">{money(list.reduce((a, r) => a + r.amount, 0))}</td>{edit && <td />}</tr>} />
    </Card>
  );
}

function Upcoming({ params, edit, onPay, onOpen }) {
  const { data, loading, error } = useLoad('/revenue/upcoming', [params.v, params.dv]);
  return (
    <Card pad={false}>
      {error && <div className="card-body"><Notice type="error">{error.message}</Notice></div>}
      <DataTable loading={loading} rows={data || []} onRowClick={r => onOpen(r.id)} searchKeys={['customer_name', 'invoice_no', 'customer_phone', 'employee_name']} empty="Nothing outstanding — every invoice is fully paid. 🎉" columns={[
        { key: 'due', label: 'Next due', sortValue: r => r.due || '9999', render: r => r.due ? <span className={r.status === 'Overdue' ? 'text-red strong' : ''}>{date(r.due)}</span> : '—' },
        { key: 'invoice_no', label: 'Invoice #' }, { key: 'customer_name', label: 'Customer', render: r => <span data-no-translate>{r.customer_name}</span> }, { key: 'customer_phone', label: 'Phone', render: r => r.customer_phone || '—' },
        { key: 'employee_name', label: 'Sales staff', render: r => <span data-no-translate>{r.employee_name}</span> }, { key: 'next_amount', label: 'Due now', money: true, render: r => money(r.next_amount ?? r.outstanding) },
        { key: 'outstanding', label: 'Outstanding', money: true }, { key: 'status', label: 'Status', render: r => <Badge status={r.status}>{r.status}</Badge> },
        ...(edit ? [{ key: 'pay', label: '', sortable: false, render: r => <Button size="sm" variant="primary" onClick={e => { e.stopPropagation(); onPay(r); }}>Receive</Button> }] : [])]}
        footer={list => <tr><td colSpan={6}>Total outstanding</td><td className="num">{money(list.reduce((a, r) => a + r.outstanding, 0))}</td><td colSpan={edit ? 2 : 1} /></tr>} />
    </Card>
  );
}

function Refunds({ params, edit, onAdd, reload }) {
  const { data, loading, error } = useLoad(`/revenue/refunds${qs({ from: params.from || '2000-01-01', to: params.to || '2100-12-31' })}`, [params.v, params.dv]);
  const confirm = useConfirm();
  const toast = useToast();
  const del = async r => {
    if (!(await confirm({ title: 'Delete refund?', message: `${money(r.amount)} · ${r.invoice_no}`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/revenue/refunds/${r.id}`); toast.success('Refund deleted.'); reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Card pad={false}>
      {error && <div className="card-body"><Notice type="error">{error.message}</Notice></div>}
      <DataTable loading={loading} rows={data || []} tools={<>{edit && <Button size="sm" variant="primary" icon={Plus} onClick={onAdd}>Add refund</Button>}<ExportLinks dataset="refunds" params={{ from: params.from, to: params.to }} /></>} empty="No refunds in this period." columns={[
        { key: 'refund_date', label: 'Date', render: r => date(r.refund_date) }, { key: 'invoice_no', label: 'Invoice #' }, { key: 'customer_name', label: 'Customer', render: r => <span data-no-translate>{r.customer_name}</span> },
        { key: 'reason', wrap: true, label: 'Reason', render: r => <span data-no-translate>{r.reason}</span> }, { key: 'amount', label: 'Amount', money: true },
        ...(edit ? [{ key: 'x', label: '', sortable: false, render: r => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del(r)} aria-label="Delete" /> }] : [])]}
        footer={list => <tr><td colSpan={4}>Total ({list.length})</td><td className="num">{money(list.reduce((a, r) => a + r.amount, 0))}</td>{edit && <td />}</tr>} />
    </Card>
  );
}

function Forecast({ params }) {
  const { data: d, error } = useLoad('/revenue/forecast', [params.v, params.dv]);
  const c = useColors();
  const chart = useMemo(() => {
    if (!d) return [];
    const sched = Object.fromEntries((d.scheduled || []).map(s => [s.month, Number(s.due)]));
    return [...d.history.map(h => ({ month: h.month, collected: h.collected, scheduled: sched[h.month] || undefined })), ...d.forecast.map(x => ({ month: x.month, expected: x.expected, scheduled: sched[x.month] || 0 }))];
  }, [d]);
  if (!d) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  const upcoming = (d.scheduled || []).filter(s => s.month >= todayStr().slice(0, 7)).slice(0, 6);
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        {d.forecast.map((x, i) => <Kpi key={x.month} icon={Sparkles} color={['blue', 'purple', 'cyan'][i]} label={`${monthName(x.month)} (expected)`} value={money(x.expected)} />)}
        <Kpi icon={Wallet} color="orange" label="Pipeline (all outstanding)" value={money(d.pipeline)} sub="Money still to be collected" />
      </div>
      <Card title="Collections & forecast" subtitle="Bars = collected · line = expected (trend) · dashed = due by installment plans" actions={<Legend items={[{ label: 'Collected', color: c.c2 }, { label: 'Expected', color: c.c4 }, { label: 'Scheduled', color: c.c3 }]} />}>
        <BarsLines data={chart} bars={[{ key: 'collected', label: 'Collected', color: c.c2 }, { key: 'scheduled', label: 'Scheduled', color: c.c3 }]} lines={[{ key: 'expected', label: 'Expected', color: c.c4 }]} height={320} />
      </Card>
      {upcoming.length > 0 && <Card title="Due by installment plans" pad={false}>
        <table className="tbl"><tbody>{upcoming.map(s => <tr key={s.month}><td>{monthName(s.month)}</td><td className="num">{money(s.due)}</td></tr>)}</tbody></table>
      </Card>}
      <Notice type="info">The forecast uses a straight-line trend of the last 6 months of money actually received; “Scheduled” is what installment plans say is due.</Notice>
    </div>
  );
}

// ═════════ Targets ═════════
function TargetsModal({ onClose, onSaved }) {
  const toast = useToast();
  const { data, error } = useLoad('/revenue/targets');
  const [company, setCompany] = useState('');
  const [staff, setStaff] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setCompany(String(data.company.target || '')); setStaff(Object.fromEntries(data.everyone.map(u => [u.id, String(u.target || '')]))); } }, [data]);
  const save = async () => {
    setBusy(true);
    try { await api.put('/revenue/targets', { company_target: company || '0', staff: Object.entries(staff).map(([id, target]) => ({ id, target: target || '0' })) }); toast.success('Targets saved.'); onSaved(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Monthly targets" subtitle="Booked sales per month (PKR)" size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save targets</Button></>}>
      {error ? <Notice type="error">{error.message}</Notice> : !data ? <Loader /> : (
        <div className="form">
          <Field label="Company target per month (PKR)"><MoneyInput value={company} onChange={setCompany} /></Field>
          <div className="field-label">Staff targets</div>
          <div className="target-edit">
            {data.everyone.map(u => (
              <div key={u.id} className="row" style={{ justifyContent: 'space-between' }}>
                <span data-no-translate>{u.full_name} <small className="muted">{u.employee_code}</small></span>
                <div style={{ width: 180 }}><MoneyInput value={staff[u.id] || ''} onChange={x => setStaff(s => ({ ...s, [u.id]: x }))} placeholder="0" /></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ═════════ Payment / refund modals ═════════
function useOpenInvoices(sale, filter) {
  const [list, setList] = useState(sale?.id ? [sale] : null);
  useEffect(() => { if (!sale?.id) api.get('/revenue/sales?all=1').then(r => setList(r.filter(filter))).catch(() => setList([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

export function PaymentModal({ sale, onClose, onSaved }) {
  const toast = useToast();
  const list = useOpenInvoices(sale, s => s.outstanding > 0 && s.status !== 'Refunded');
  const [meta, setMeta] = useState(null);
  const [f, setF] = useState({ sale_id: sale?.id || '', amount: sale?.id ? String(sale.next_amount || sale.outstanding || '') : '', method: 'Bank Transfer', payment_date: todayStr(), reference: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/revenue/meta').then(setMeta).catch(() => {}); }, []);
  const sel = list?.find(s => String(s.id) === String(f.sale_id));
  const save = async () => {
    setErr(''); setBusy(true);
    try { await api.post('/revenue/payments', f); toast.success('Payment recorded.'); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Record payment" subtitle="Money received against an invoice" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save} disabled={!f.sale_id || !f.amount}>Save payment</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <Field label="Invoice" required>{list ? <Select value={f.sale_id} onChange={x => { const s = list.find(y => y.id === x); setF(y => ({ ...y, sale_id: x, amount: s ? String(s.next_amount || s.outstanding) : y.amount })); }} options={list.map(s => ({ value: s.id, label: `${s.invoice_no} · ${s.customer_name}`, hint: money(s.outstanding) }))} placeholder={list.length ? 'Select invoice' : 'No unpaid invoices'} searchable /> : 'Loading…'}</Field>
        {sel && <div className="small muted">Outstanding: <b>{money(sel.outstanding)}</b> / {money(sel.total_amount)}{sel.due ? <> · next due {date(sel.due)}</> : null}</div>}
        <div className="form-grid">
          <Field label="Amount (PKR)" required><MoneyInput value={f.amount} onChange={x => setF(y => ({ ...y, amount: x }))} /></Field>
          <Field label="Payment date" required><Input type="date" value={f.payment_date} max={todayStr()} onChange={e => setF(y => ({ ...y, payment_date: e.target.value }))} /></Field>
          <Field label="Method" required><Select value={f.method} onChange={x => setF(y => ({ ...y, method: x }))} options={meta?.methods || ['Bank Transfer']} /></Field>
          <Field label="Reference"><Input value={f.reference} onChange={e => setF(y => ({ ...y, reference: e.target.value }))} placeholder="Bank ref / receipt no." /></Field>
        </div>
      </div>
    </Modal>
  );
}

export function RefundModal({ sale, onClose, onSaved }) {
  const toast = useToast();
  const list = useOpenInvoices(sale, s => s.paid - s.refunded > 0);
  const [f, setF] = useState({ sale_id: sale?.id || '', amount: '', refund_date: todayStr(), reason: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const sel = list?.find(s => String(s.id) === String(f.sale_id));
  const save = async () => {
    setErr(''); setBusy(true);
    try { await api.post('/revenue/refunds', f); toast.success('Refund recorded.'); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add refund" subtitle="Money returned to a customer" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={save} disabled={!f.sale_id || !f.amount || !f.reason}>Save refund</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <Field label="Invoice" required>{list ? <Select value={f.sale_id} onChange={x => setF(y => ({ ...y, sale_id: x }))} options={list.map(s => ({ value: s.id, label: `${s.invoice_no} · ${s.customer_name}`, hint: money(s.paid - s.refunded) }))} placeholder={list.length ? 'Select invoice' : 'No paid invoices'} searchable /> : 'Loading…'}</Field>
        {sel && <div className="small muted">Refundable: <b>{money(sel.paid - sel.refunded)}</b></div>}
        <div className="form-grid">
          <Field label="Refund amount (PKR)" required><MoneyInput value={f.amount} onChange={x => setF(y => ({ ...y, amount: x }))} /></Field>
          <Field label="Refund date" required><Input type="date" value={f.refund_date} max={todayStr()} onChange={e => setF(y => ({ ...y, refund_date: e.target.value }))} /></Field>
        </div>
        <Field label="Reason" required><Textarea rows={2} value={f.reason} onChange={e => setF(y => ({ ...y, reason: e.target.value }))} /></Field>
      </div>
    </Modal>
  );
}

