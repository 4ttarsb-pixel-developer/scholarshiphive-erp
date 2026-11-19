import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Building2, Coins, TrendingDown, Archive, Plus, Pencil, Trash2, Lock, ShoppingCart, PackageMinus, Scale, ChevronRight } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { api, qs } from '../../lib/api.js';
import { useFormDef, CustomValues } from '../../lib/forms.jsx';
import { Badge, Button, Card, DataTable, DateRange, ExportButtons, Kpi, Loader, Modal, Notice, Select, useConfirm, useToast } from '../../components/ui.jsx';
import { Donut, ShareList } from '../../components/charts.jsx';
import { money, date, titleCase } from '../../lib/format.js';
import { LIQ, AnalyticsToolbar, ChartCard, Delta, PeriodTable, useAnalyticsState, useOverview } from './shared.jsx';

const TITLES = {
  overview: ['Assets', 'Everything ScholarshipHive owns — grouped by how quickly it turns into cash.'],
  register: ['Assets register', 'Every asset with its category, value and status. Assets are permanent records — only admin can edit or delete them.'],
  high: ['High liquid assets', 'Cash, bank, wallets and short deposits — money you can use within days.'],
  medium: ['Medium liquid assets', 'Receivables, advances, deposits and short investments — cash within weeks or months.'],
  low: ['Low / illiquid assets', 'Buildings, vehicles, furniture, computers and intangibles — long-term assets.'],
};

export default function Assets() {
  const { tab = 'overview' } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const [t, s] = TITLES[tab] || TITLES.overview;
  return (
    <>
      <div className="page-head">
        <div><h1>{t}</h1><p>{s}</p></div>
        <div className="page-actions">{can('assets', 'edit') && <Button variant="primary" icon={Plus} onClick={() => nav(`/assets/new${LIQ[tab] ? `?liquidity=${tab}` : ''}`)}>Add asset</Button>}</div>
      </div>
      {tab === 'overview' && <Overview />}
      {(tab === 'register' || LIQ[tab]) && <Register liquidity={LIQ[tab] ? tab : ''} key={tab} />}
      {!TITLES[tab] && <Notice type="warn">Page not found.</Notice>}
    </>
  );
}

function Overview() {
  const [st, set] = useAnalyticsState('assets', { chart: 'stacked' });
  const { data: d, loading, error } = useOverview(st);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const p = d.position; const ch = d.change; const f = d.flows;
  const liqSeries = [{ key: 'high', label: 'High liquid', color: 'var(--chart-6)' }, { key: 'medium', label: 'Medium liquid', color: 'var(--chart-3)' }, { key: 'low', label: 'Low / illiquid', color: 'var(--chart-4)' }];
  const col = c => getComputedStyle(document.documentElement).getPropertyValue(c).trim();
  const pie = ['high', 'medium', 'low'].map((k, i) => ({ name: LIQ[k].short, value: p.assets[k], color: col(['--chart-6', '--chart-3', '--chart-4'][i]) }));
  return (
    <div className="stack" style={{ gap: 16, position: 'relative' }}>
      {loading && <div className="soft-loading" />}
      <AnalyticsToolbar state={st} set={set} right={<ExportButtons dataset="assets" params={{ status: 'active' }} />} />
      <div className="liq-cards">
        {['high', 'medium', 'low'].map(k => {
          const I = LIQ[k].icon;
          return (
            <Link key={k} to={`/assets/${k}`} className={`liq-card ${k}`}>
              <div className="liq-top"><span className="liq-name">{LIQ[k].label}</span><span className="liq-icon"><I /></span></div>
              <div className="liq-value">{money(p.assets[k])}</div>
              <div className="row small" style={{ justifyContent: 'space-between' }}>
                <span className="muted">{p.assets.total ? Math.round((p.assets[k] / p.assets.total) * 1000) / 10 : 0}% of assets</span>
                <span className="row" style={{ gap: 6 }}><Delta pct={ch[k].pct} amount={ch[k].change} /><ChevronRight size={14} className="chev-flip" /></span>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="grid grid-kpi">
        <Kpi icon={Building2} color="blue" label="Total assets" value={money(p.assets.total)} sub={<><Delta pct={ch.assets.pct} amount={ch.assets.change} /> vs start of period</>} />
        <Kpi icon={ShoppingCart} color="green" label="Bought in period" value={money(f.assetsBought)} sub={`${f.assetsBoughtCount} asset(s)`} />
        <Kpi icon={PackageMinus} color="orange" label="Disposed / sold" value={money(f.assetsDisposed)} sub={`${f.assetsDisposedCount} asset(s)`} />
        <Kpi icon={TrendingDown} color="red" label="Depreciation" value={money(Math.max(0, p.assets.cost - p.assets.total))} sub="Cost − current value" />
        <Kpi icon={Scale} color="purple" label="Working capital" value={money(p.capital.working)} sub={<Link to="/capital/working">Current assets − current liabilities</Link>} />
      </div>
      <div className="grid grid-main">
        <ChartCard title="Assets over time (by liquidity)" subtitle={`Value held at the end of each ${st.group === 'day' ? 'day' : st.group}`} data={d.series} series={liqSeries} type={st.chart} />
        <Card title="Liquidity mix today"><Donut data={pie} center={money(p.assets.total, { short: true })} centerSub="Total assets" />
          <div className="stack" style={{ gap: 0, marginTop: 8 }}>
            {pie.map(x => <div key={x.name} className="list-row"><span className="row" style={{ gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: x.color, display: 'inline-block' }} />{x.name}</span><b className="mono">{money(x.value)}</b></div>)}
          </div>
        </Card>
      </div>
      <div className="grid grid-2">
        <ChartCard title="Assets bought per period (ups)" subtitle="New purchases split by liquidity" data={d.series.map(r => ({ ...r, bh: r.byLiquidity.high, bm: r.byLiquidity.medium, bl: r.byLiquidity.low }))}
          series={[{ key: 'bh', label: 'High liquid', color: 'var(--chart-6)' }, { key: 'bm', label: 'Medium liquid', color: 'var(--chart-3)' }, { key: 'bl', label: 'Low / illiquid', color: 'var(--chart-4)' }]} type={st.chart === 'pie' ? 'pie' : st.chart === 'line' || st.chart === 'area' ? st.chart : 'column'} height={260} />
        <ChartCard title="Bought vs disposed (ups & downs)" data={d.series} series={[{ key: 'assetsBought', label: 'Bought', color: 'var(--chart-2)' }, { key: 'assetsDisposed', label: 'Disposed / sold', color: 'var(--chart-5)' }]} type={st.chart === 'stacked' ? 'column' : st.chart} height={260} />
      </div>
      <div className="grid grid-3">
        {d.liquidityCategories.map((g, i) => (
          <Card key={g.id} title={`${LIQ[g.id].short} — by category`} actions={<Link className="small" to={`/assets/${g.id}`}>Open</Link>}>
            <ShareList items={g.items} colorIndex={i * 2} />
          </Card>
        ))}
      </div>
      <Card pad={false} title="Period breakdown" subtitle="Up / down = change of total assets vs the previous period">
        <PeriodTable series={d.series} cols={[{ key: 'high', label: 'High liquid' }, { key: 'medium', label: 'Medium liquid' }, { key: 'low', label: 'Low / illiquid' }, { key: 'assets', label: 'Total' }, { key: 'assetsBought', label: 'Bought' }]} changeKey="assetsChange" />
      </Card>
    </div>
  );
}

function Register({ liquidity }) {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const [v, setV] = useState(0);
  const [f, setF] = useState({ status: 'active', category: '', from: '', to: '' });
  const [open, setOpen] = useState(null);
  const params = { liquidity, status: f.status, category: f.category, from: f.from, to: f.to };
  const { data: d, loading, error } = useLoad(`/assets${qs(params)}`, [v]);
  const { def } = useFormDef('assets');
  const confirm = useConfirm();
  const toast = useToast();
  const catOpts = useMemo(() => {
    const cats = def?.lists?.category?.options || [];
    const liq = def?.lists?.liquidity?.options.find(o => o.value === liquidity);
    return [{ value: '', label: 'All categories' }, ...cats.filter(o => !liquidity || o.parent_option_id === liq?.id).map(o => ({ value: o.value, label: o.label }))];
  }, [def, liquidity]);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const del = async a => {
    if (!(await confirm({ title: 'Delete asset permanently?', message: `${a.name} (${money(a.current_value)}) will be removed from the register. Tip: mark it “Disposed” instead to keep history.`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/assets/${a.id}`); toast.success('Asset deleted.'); setOpen(null); setV(x => x + 1); } catch (e) { toast.error(e.message); }
  };
  const liqLabel = k => LIQ[k]?.short || k;
  return (
    <div className="stack" style={{ gap: 16, position: 'relative' }}>
      {loading && <div className="soft-loading" />}
      <div className="grid grid-kpi">
        <Kpi icon={Building2} color="blue" label="Active assets" value={d.totals.count} />
        <Kpi icon={Coins} color="green" label="Current value" value={money(d.totals.value)} />
        <Kpi icon={Coins} color="purple" label="Purchase cost" value={money(d.totals.cost)} />
        <Kpi icon={TrendingDown} color="orange" label="Depreciation" value={money(d.totals.depreciation)} sub="Cost − current value" />
        <Kpi icon={Archive} color="red" label="Disposed" value={d.totals.disposed} />
      </div>
      <div className="grid grid-2">
        <Card title="Value by category"><Donut data={d.byCategory} center={money(d.totals.value, { short: true })} centerSub="Current value" /></Card>
        <Card title={liquidity ? 'Value by sub-category' : 'Value by liquidity'}>
          {liquidity ? <ShareList items={d.bySub.length ? d.bySub : d.byCategory} /> : <ShareList items={d.byLiquidity} />}
        </Card>
      </div>
      <Card pad={false} title={liquidity ? LIQ[liquidity].label : 'Assets register'} actions={<ExportButtons dataset="assets" params={params} />}>
        <div className="card-toolbar">
          <div style={{ width: 160 }}><Select value={f.status} onChange={x => setF(o => ({ ...o, status: x }))} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'disposed', label: 'Disposed / sold' }]} ariaLabel="Status" /></div>
          <div style={{ width: 220 }}><Select value={f.category} onChange={x => setF(o => ({ ...o, category: x }))} options={catOpts} searchable ariaLabel="Category" /></div>
          <DateRange from={f.from} to={f.to} allowAll onChange={(from, to) => setF(o => ({ ...o, from, to }))} />
          <span className="small muted">Date filter = purchase date</span>
        </div>
        <DataTable rows={d.rows} onRowClick={setOpen} empty="No assets match these filters." searchKeys={['name', 'category', 'sub_category', 'serial_no', 'location', 'vendor', 'custodian']} columns={[
          { key: 'name', label: 'Asset', render: r => <div style={{ minWidth: 0 }}><b data-no-translate>{r.name}</b>{r.quantity > 1 && <span className="muted small"> × {r.quantity}</span>}</div> },
          ...(liquidity ? [] : [{ key: 'liquidity', label: 'Liquidity', render: r => <Badge tone={{ high: 'blue', medium: 'orange', low: 'purple' }[r.liquidity]}>{liqLabel(r.liquidity)}</Badge> }]),
          { key: 'category', label: 'Category', render: r => <span>{r.category}{r.sub_category ? <span className="muted"> › {r.sub_category}</span> : ''}</span> },
          { key: 'asset_type', label: 'Type', render: r => titleCase(r.asset_type) },
          { key: 'purchase_date', label: 'Acquired', render: r => date(r.purchase_date) },
          { key: 'location', label: 'Location', render: r => r.location || '—' },
          { key: 'cost', label: 'Cost', money: true }, { key: 'current_value', label: 'Current value', money: true },
          { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }]}
          footer={list => <tr><td colSpan={liquidity ? 5 : 6}>Total ({list.length})</td><td className="num">{money(list.reduce((a, r) => a + r.cost, 0))}</td><td className="num">{money(list.filter(r => r.status === 'active').reduce((a, r) => a + r.current_value, 0))}</td><td /></tr>} />
      </Card>
      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.name} subtitle={`${liqLabel(open.liquidity)} · ${open.category}${open.sub_category ? ' › ' + open.sub_category : ''}`} size="lg"
          footer={isAdmin ? <><Button variant="danger" icon={Trash2} onClick={() => del(open)}>Delete</Button><Button variant="primary" icon={Pencil} onClick={() => nav(`/assets/${open.id}/edit`)}>Edit</Button></> : <span className="small muted row"><Lock size={14} />Only admin can edit or delete assets</span>}>
          <dl className="dl">
            <dt>Status</dt><dd><Badge status={open.status} />{open.status === 'disposed' && open.disposed_date ? ` · ${date(open.disposed_date)}${open.disposal_value != null ? ` · ${money(open.disposal_value)}` : ''}` : ''}</dd>
            <dt>Type</dt><dd>{titleCase(open.asset_type)} asset</dd>
            <dt>Acquired</dt><dd>{date(open.purchase_date)}</dd><dt>Quantity</dt><dd>{open.quantity}</dd>
            <dt>Cost</dt><dd>{money(open.cost)}</dd><dt>Current value</dt><dd>{money(open.current_value)}</dd>
            <dt>Depreciation % per year</dt><dd>{open.depreciation_rate ? `${open.depreciation_rate}%` : '—'}</dd>
            <dt>Bought from (vendor)</dt><dd data-no-translate>{open.vendor || '—'}</dd>
            <dt>Payment</dt><dd>{open.payment_method || '—'}{open.reference_no ? ` · ${open.reference_no}` : ''}</dd>
            <dt>Warranty until</dt><dd>{open.warranty_until ? date(open.warranty_until) : '—'}</dd>
            <dt>Location</dt><dd data-no-translate>{open.location || '—'}</dd><dt>Custodian (kept by)</dt><dd data-no-translate>{open.custodian || '—'}</dd>
            <dt>Serial / reference</dt><dd data-no-translate>{open.serial_no || '—'}</dd>
            <CustomValues def={def} values={open.custom_fields} />
            <dt>Notes</dt><dd data-no-translate>{open.notes || '—'}</dd><dt>Entered by</dt><dd data-no-translate>{open.entered_by || '—'}</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}
