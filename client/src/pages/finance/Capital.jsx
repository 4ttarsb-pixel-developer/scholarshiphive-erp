// Capital & Equity — Assets = Liabilities + Capital, the four kinds of capital, owner's equity / net worth.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Plus, Scale, Layers, Briefcase, Landmark, Coins, Gem, CheckCircle2, AlertTriangle, Pencil, Trash2, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { api, qs } from '../../lib/api.js';
import { useFormDef, CustomValues } from '../../lib/forms.jsx';
import { Badge, Button, Card, DataTable, ExportButtons, Kpi, Loader, Modal, Notice, Select, useConfirm, useToast } from '../../components/ui.jsx';
import { ShareList, Donut } from '../../components/charts.jsx';
import { money, date, titleCase } from '../../lib/format.js';
import { AnalyticsToolbar, ChartCard, Delta, PeriodTable, useAnalyticsState, useOverview, LIQ } from './shared.jsx';
import { Ratio } from './Liabilities.jsx';

export const CAPITAL = {
  fixed: { label: 'Fixed capital', icon: Layers, formula: 'Fixed capital = value of long-term assets (low / illiquid + intangible)', desc: 'Money locked in buildings, vehicles, furniture, computers, software and other long-term assets.' },
  working: { label: 'Working capital', icon: Briefcase, formula: 'Working capital = current assets (high + medium liquid) − current liabilities (due within 12 months)', desc: 'Money available to run the business day to day. Positive = you can pay short-term bills.' },
  debt: { label: 'Debt capital', icon: Landmark, formula: 'Debt capital = outstanding loans + recorded debt capital', desc: 'Borrowed money (bank loans, owner / personal loans, credit cards, leases) used to finance the business.' },
  equity: { label: 'Equity capital', icon: Coins, formula: 'Equity capital = owner / partner investments − drawings', desc: 'Money the owners and partners have put into the business (minus what they took out).' },
};
const TITLES = {
  overview: ['Capital & Equity', 'The accounting equation: Assets = Liabilities + Capital (owner’s equity).'],
  fixed: [CAPITAL.fixed.label, CAPITAL.fixed.desc], working: [CAPITAL.working.label, CAPITAL.working.desc], debt: [CAPITAL.debt.label, CAPITAL.debt.desc], equity: [CAPITAL.equity.label, CAPITAL.equity.desc],
  'owners-equity': ["Owner's equity / net worth", 'What the business is worth to its owners: total assets minus total liabilities.'],
  entries: ['Capital entries', 'Every investment and withdrawal, by capital type.'],
};

export default function Capital() {
  const { tab = 'overview' } = useParams();
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const [t, s] = TITLES[tab] || TITLES.overview;
  return (
    <>
      <div className="page-head">
        <div><h1>{t}</h1><p>{s}</p></div>
        <div className="page-actions">{isAdmin && <Button variant="primary" icon={Plus} onClick={() => nav(`/capital/new${CAPITAL[tab] ? `?class=${tab}` : ''}`)}>Add capital entry</Button>}</div>
      </div>
      {tab === 'entries' ? <Entries /> : TITLES[tab] ? <Analytics tab={tab} key={tab} /> : <Notice type="warn">Page not found.</Notice>}
    </>
  );
}

function Analytics({ tab }) {
  const [st, set] = useAnalyticsState('capital', { chart: 'line' });
  const { data: d, loading, error } = useOverview(st);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const p = d.position; const ch = d.change;
  return (
    <div className="stack" style={{ gap: 16, position: 'relative' }}>
      {loading && <div className="soft-loading" />}
      <AnalyticsToolbar state={st} set={set} />
      {tab === 'overview' && <Overview d={d} st={st} />}
      {tab === 'fixed' && <ClassView k="fixed" d={d} st={st} value={p.capital.fixed} change={ch.fixed} seriesKey="fixedCap"
        breakdown={<Card title="Long-term assets by category" actions={<Link className="small" to="/assets/low">Open assets</Link>}><ShareList items={d.liquidityCategories.find(x => x.id === 'low')?.items || []} colorIndex={3} /></Card>} />}
      {tab === 'working' && <ClassView k="working" d={d} st={st} value={p.capital.working} change={ch.working} seriesKey="working"
        breakdown={<Card title="How it is calculated">
          <div className="slip-row"><span>{LIQ.high.label}</span><b>{money(p.assets.high)}</b></div>
          <div className="slip-row"><span>+ {LIQ.medium.label}</span><b>{money(p.assets.medium)}</b></div>
          <div className="slip-row"><span>= Current assets</span><b>{money(p.assets.current)}</b></div>
          <div className="slip-row"><span>− Current liabilities</span><b className="text-red">{money(p.liabilities.current)}</b></div>
          <div className="slip-row total"><span>Working capital</span><span>{money(p.capital.working)}</span></div>
          <Ratio label="Current ratio" sub="Current assets ÷ current liabilities (above 1 is healthy)" v={p.ratios.current} />
        </Card>} />}
      {tab === 'debt' && <ClassView k="debt" d={d} st={st} value={p.capital.debt} change={ch.debt} seriesKey="debtCap" invert
        breakdown={<Card title="Debt by category" actions={<Link className="small" to="/liabilities/all">Open liabilities</Link>}><ShareList items={p.liabilities.byCategory} colorIndex={4} />
          <Ratio label="Debt-to-equity" sub="Liabilities ÷ owner's equity (lower is safer)" v={p.ratios.debtToEquity} /></Card>} />}
      {tab === 'equity' && <ClassView k="equity" d={d} st={st} value={p.capital.equity} change={ch.equityCap} seriesKey="equityCap" breakdown={<EquityParties />} />}
      {tab === 'owners-equity' && <OwnersEquity d={d} st={st} />}
    </div>
  );
}

function Equation({ p }) {
  const ok = p.equation.balanced;
  return (
    <Card title="Assets = Liabilities + Capital" subtitle={`Position on ${date(p.date)}`} actions={<span className={`eq-status ${ok ? 'text-green' : 'text-red'}`}>{ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{ok ? 'Balanced' : 'Not balanced'}</span>}>
      <div className="equation">
        <Link to="/assets" className="eq-box a"><span>Assets</span><b>{money(p.equation.assets)}</b><small className="muted">{p.assets.count} active</small></Link>
        <div className="eq-op">=</div>
        <Link to="/liabilities" className="eq-box l"><span>Liabilities</span><b>{money(p.equation.liabilities)}</b><small className="muted">Current {money(p.liabilities.current, { short: true })}</small></Link>
        <div className="eq-op">+</div>
        <Link to="/capital/owners-equity" className="eq-box c"><span>Capital (owner’s equity)</span><b>{money(p.equation.equity)}</b><small className="muted">Net worth</small></Link>
      </div>
    </Card>
  );
}

function Overview({ d, st }) {
  const p = d.position; const ch = d.change;
  const cards = [['fixed', p.capital.fixed, ch.fixed], ['working', p.capital.working, ch.working], ['debt', p.capital.debt, ch.debt], ['equity', p.capital.equity, ch.equityCap]];
  const col = c => getComputedStyle(document.documentElement).getPropertyValue(c).trim();
  return (
    <>
      <Equation p={p} />
      <div className="cap-grid">
        {cards.map(([k, v, c]) => { const C = CAPITAL[k]; return (
          <Link key={k} to={`/capital/${k}`} className="cap-card">
            <span className="cap-k"><C.icon />{C.label}</span>
            <span className="cap-v">{money(v)}</span>
            <span className="row small" style={{ gap: 6 }}><Delta pct={c.pct} invert={k === 'debt'} amount={c.change} /><span className="muted">vs start</span></span>
          </Link>
        ); })}
      </div>
      <div className="grid grid-main">
        <ChartCard title="Assets, liabilities and equity over time" data={d.series} type={st.chart === 'pie' ? 'line' : st.chart}
          series={[{ key: 'assets', label: 'Assets', color: 'var(--chart-1)' }, { key: 'liabilities', label: 'Liabilities', color: 'var(--chart-5)' }, { key: 'equity', label: 'Owner’s equity', color: 'var(--chart-2)' }]} />
        <Card title="How the business is financed" subtitle="Share of assets paid by debt vs owners">
          <Donut data={[{ name: 'Liabilities (debt)', value: Math.max(0, p.liabilities.total), color: col('--chart-5') }, { name: 'Owner’s equity', value: Math.max(0, p.equity.total), color: col('--chart-2') }]} center={money(p.assets.total, { short: true })} centerSub="Total assets" />
          <Ratio label="Current ratio" sub="Current assets ÷ current liabilities (above 1 is healthy)" v={p.ratios.current} />
          <Ratio label="Quick ratio" sub="High liquid assets ÷ current liabilities" v={p.ratios.quick} />
          <Ratio label="Debt-to-equity" sub="Liabilities ÷ owner's equity (lower is safer)" v={p.ratios.debtToEquity} />
          <Ratio label="Debt ratio" sub="Liabilities as % of assets" v={p.ratios.debtRatio} pct />
        </Card>
      </div>
      <ChartCard title="Four kinds of capital over time" data={d.series} type={st.chart === 'pie' ? 'pie' : st.chart === 'stacked' ? 'column' : st.chart}
        series={[{ key: 'fixedCap', label: 'Fixed capital', color: 'var(--chart-4)' }, { key: 'working', label: 'Working capital', color: 'var(--chart-6)' }, { key: 'debtCap', label: 'Debt capital', color: 'var(--chart-5)' }, { key: 'equityCap', label: 'Equity capital', color: 'var(--chart-2)' }]} />
      <Card pad={false} title="Period breakdown" subtitle="Up / down = change of owner’s equity vs the previous period">
        <PeriodTable series={d.series} cols={[{ key: 'assets', label: 'Assets' }, { key: 'liabilities', label: 'Liabilities' }, { key: 'equity', label: 'Owner’s equity' }, { key: 'working', label: 'Working capital' }]} changeKey="equityChange" />
      </Card>
    </>
  );
}

function ClassView({ k, d, st, value, change, seriesKey, breakdown, invert }) {
  const C = CAPITAL[k];
  const series = d.series.map((r, i) => ({ ...r, chg: i ? Math.round(((r[seriesKey] - d.series[i - 1][seriesKey]) / (Math.abs(d.series[i - 1][seriesKey]) || 1)) * 1000) / 10 : 0 }));
  return (
    <>
      <div className="grid grid-kpi">
        <Kpi icon={C.icon} color="blue" label={C.label} value={money(value)} sub={<><Delta pct={change.pct} invert={invert} amount={change.change} /> vs start of period</>} />
        <Kpi icon={ArrowUpCircle} color="green" label="Start of period" value={money(change.start)} />
        <Kpi icon={ArrowDownCircle} color="orange" label="Change" value={money(change.change)} />
      </div>
      <div className="formula">{C.formula}</div>
      <div className="grid grid-main">
        <ChartCard title={`${C.label} over time`} data={series} series={[{ key: seriesKey, label: C.label, color: k === 'debt' ? 'var(--chart-5)' : k === 'fixed' ? 'var(--chart-4)' : k === 'working' ? 'var(--chart-6)' : 'var(--chart-2)' }]} type={st.chart === 'stacked' ? 'column' : st.chart} />
        {breakdown}
      </div>
      <Card pad={false} title="Period breakdown"><PeriodTable series={series} cols={[{ key: seriesKey, label: C.label }]} changeKey="chg" invert={invert} /></Card>
      <Entries cls={k} compact />
    </>
  );
}

function EquityParties() {
  const { data } = useLoad('/capital?class=equity');
  return <Card title="Paid-in capital by owner / partner">{data ? <ShareList items={data.byParty.filter(x => x.value > 0)} /> : <Loader />}</Card>;
}

function OwnersEquity({ d, st }) {
  const p = d.position; const ch = d.change;
  return (
    <>
      <Equation p={p} />
      <div className="grid grid-kpi">
        <Kpi icon={Gem} color="green" label="Owner's equity / net worth" value={money(p.equity.total)} sub={<><Delta pct={ch.equity.pct} amount={ch.equity.change} /> vs start of period</>} />
        <Kpi icon={Coins} color="blue" label="Contributed capital" value={money(p.equity.contributed)} sub="Investments − drawings (all capital entries except debt)" />
        <Kpi icon={Scale} color="purple" label="Retained earnings / balance" value={money(p.equity.retained)} sub="Net worth − contributed capital" />
      </div>
      <div className="formula">Owner’s equity = Total assets − Total liabilities = Contributed capital + Retained earnings</div>
      <ChartCard title="Net worth over time" data={d.series} series={[{ key: 'equity', label: 'Owner’s equity', color: 'var(--chart-2)' }]} type={st.chart === 'stacked' ? 'area' : st.chart} />
      <Card pad={false} title="Period breakdown"><PeriodTable series={d.series} cols={[{ key: 'assets', label: 'Assets' }, { key: 'liabilities', label: 'Liabilities' }, { key: 'equity', label: 'Owner’s equity' }]} changeKey="equityChange" /></Card>
    </>
  );
}

const CLASS_TONE = { equity: 'green', debt: 'red', fixed: 'purple', working: 'blue' };

function Entries({ cls: fixedCls, compact }) {
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const [v, setV] = useState(0);
  const [cls, setCls] = useState(fixedCls || '');
  const [open, setOpen] = useState(null);
  const { def } = useFormDef('capital');
  const { data: d, error } = useLoad(`/capital${qs({ class: cls })}`, [v]);
  const confirm = useConfirm();
  const toast = useToast();
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const del = async r => {
    if (!(await confirm({ title: 'Delete capital entry?', message: `${r.type === 'investment' ? 'Added' : 'Withdrawn'} ${money(r.amount)} — ${r.party}`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/capital/${r.id}`); toast.success('Deleted.'); setOpen(null); setV(x => x + 1); } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      {!compact && <div className="grid grid-kpi">
        <Kpi icon={ArrowUpCircle} color="green" label="Added" value={money(d.totals.investment)} />
        <Kpi icon={ArrowDownCircle} color="red" label="Withdrawn" value={money(d.totals.drawing)} />
        <Kpi icon={Coins} color="purple" label="Net capital" value={money(d.totals.net)} />
        {d.byClass.map(c => <Kpi key={c.id} icon={CAPITAL[c.id].icon} color={CLASS_TONE[c.id]} label={CAPITAL[c.id].label} value={money(c.net)} sub={`${c.count} entr${c.count === 1 ? 'y' : 'ies'}`} />)}
      </div>}
      <Card pad={false} className={compact ? '' : 'mt'} title={compact ? `Recorded ${CAPITAL[fixedCls].label.toLowerCase()} entries` : 'Capital entries'}
        actions={<><ExportButtons dataset="capital" params={{ class: cls }} />{isAdmin && <Button size="sm" variant="primary" icon={Plus} onClick={() => nav(`/capital/new${cls ? `?class=${cls}` : ''}`)}>Add entry</Button>}</>}>
        {!fixedCls && <div className="card-toolbar"><div style={{ width: 200 }}><Select value={cls} onChange={setCls} options={[{ value: '', label: 'All capital types' }, ...Object.entries(CAPITAL).map(([k, c]) => ({ value: k, label: c.label }))]} ariaLabel="Capital type" /></div></div>}
        <DataTable rows={d.rows} onRowClick={setOpen} search={!compact} pageSize={compact ? 8 : 25} empty="No capital entries yet. Admin can add owner investment, drawings or other capital." columns={[
          { key: 'entry_date', label: 'Date', render: r => date(r.entry_date) },
          { key: 'capital_class', label: 'Capital type', render: r => <Badge tone={CLASS_TONE[r.capital_class]}>{CAPITAL[r.capital_class]?.label || titleCase(r.capital_class)}</Badge> },
          { key: 'type', label: 'Movement', render: r => <Badge tone={r.type === 'investment' ? 'green' : 'orange'}>{r.type === 'investment' ? 'Added' : 'Withdrawn'}</Badge> },
          { key: 'source_type', label: 'Source', render: r => r.source_type || '—' },
          { key: 'party', label: 'Owner / partner', render: r => <span data-no-translate>{r.party}</span> },
          { key: 'note', label: 'Note', wrap: true, render: r => <span data-no-translate>{r.note || '—'}</span> },
          { key: 'amount', label: 'Amount', money: true }]} />
      </Card>
      {open && (
        <Modal open onClose={() => setOpen(null)} title={`${open.type === 'investment' ? 'Added' : 'Withdrawn'} · ${money(open.amount)}`} subtitle={CAPITAL[open.capital_class]?.label}
          footer={isAdmin ? <><Button variant="danger" icon={Trash2} onClick={() => del(open)}>Delete</Button><Button variant="primary" icon={Pencil} onClick={() => nav(`/capital/${open.id}/edit`)}>Edit</Button></> : null}>
          <dl className="dl">
            <dt>Date</dt><dd>{date(open.entry_date)}</dd><dt>Source</dt><dd>{open.source_type || '—'}</dd>
            <dt>Owner / partner</dt><dd data-no-translate>{open.party}{open.share_pct != null ? ` · ${open.share_pct}%` : ''}</dd>
            <dt>Payment</dt><dd>{open.method || '—'}{open.reference_no ? ` · ${open.reference_no}` : ''}</dd>
            <CustomValues def={def} values={open.custom_fields} />
            <dt>Note</dt><dd data-no-translate>{open.note || '—'}</dd><dt>Entered by</dt><dd data-no-translate>{open.entered_by || '—'}</dd>
          </dl>
        </Modal>
      )}
    </>
  );
}
