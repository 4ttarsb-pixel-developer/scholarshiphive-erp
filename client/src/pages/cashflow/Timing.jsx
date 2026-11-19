import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownCircle, ArrowUpCircle, CalendarClock, CalendarX2, Clock3, TrendingDown } from 'lucide-react';
import { useLoad } from '../../lib/auth.jsx';
import { qs } from '../../lib/api.js';
import { Badge, Card, DataTable, Kpi, Loader, Notice, Segmented, Select } from '../../components/ui.jsx';
import { BarsLines, TrendLine, useColors } from '../../components/charts.jsx';
import { money as fmtMoney, date } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);
import { BalanceChart, HowTo, IN_LABELS, OUT_LABELS, PositionCard, ScenarioSwitch, days } from './shared.jsx';

const short = d => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

export default function Timing() {
  const [span, setSpan] = useState('90');
  const [scenario, setScenario] = useState('base');
  const [dir, setDir] = useState('');
  const c = useColors();
  const { data: d, error } = useLoad(`/cashflow/timing${qs({ days: span, scenario })}`);
  const daily = useMemo(() => (d?.daily || []).map(x => ({ ...x, label: short(x.date) })), [d]);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const h = d.history;
  const tin = d.weekly.reduce((a, w) => a + w.inflow, 0), tout = d.weekly.reduce((a, w) => a + w.outflow, 0);
  const events = d.events.filter(e => !dir || e.dir === dir);
  return (
    <div className="stack">
      <div className="cf-toolbar">
        <ScenarioSwitch value={scenario} onChange={setScenario} />
        <div style={{ width: 160 }}><Select value={span} onChange={setSpan} options={[{ value: '30', label: 'Next 30 days' }, { value: '60', label: 'Next 60 days' }, { value: '90', label: 'Next 90 days' }, { value: '180', label: 'Next 180 days' }]} ariaLabel="Window" /></div>
      </div>
      <PositionCard pos={d.position} />
      <div className="grid grid-kpi">
        <Kpi icon={ArrowDownCircle} color="green" label={`Cash in · next ${d.window.days} days`} value={money(tin)} />
        <Kpi icon={ArrowUpCircle} color="red" label={`Cash out · next ${d.window.days} days`} value={money(tout)} />
        <Kpi icon={TrendingDown} color={d.trough.balance < 0 ? 'red' : 'orange'} label="Lowest balance ahead" value={money(d.trough.balance)} sub={`On ${date(d.trough.date)}`} />
        <Kpi icon={CalendarX2} color={d.firstNegative ? 'red' : 'green'} label="First day below zero" value={d.firstNegative ? date(d.firstNegative.date) : 'None'} sub={d.firstNegative ? 'Arrange cash before this date' : `In the next ${d.window.days} days`} />
        <Kpi icon={Clock3} color="purple" label="Timing gap (history)" value={h.gapDays === null ? '—' : days(Math.abs(h.gapDays))} sub={h.avgInDay ? `Money comes in ~day ${Math.round(h.avgInDay)}, goes out ~day ${Math.round(h.avgOutDay)}` : 'Needs a few months of data'} />
      </div>
      <Card title="Week by week: inflow vs outflow" subtitle="Bars = expected money in / out each week · line = balance at the end of the week · dashed = lowest point inside the week">
        <BalanceChart data={d.weekly} lowKey="low" height={320} />
      </Card>
      <Card title="Day by day cash balance" subtitle="Where the balance dips between collections and payments">
        <BalanceChart data={daily} inKey={null} outKey={null} lineKey="balance" area height={240} />
      </Card>
      <div className="grid grid-2">
        <Card title="When money usually comes in vs goes out" subtitle={`Average per month · ${h.months} month(s) of history`}>
          <BarsLines data={h.buckets} xKey="label" height={250} bars={[{ key: 'inflow', label: 'Cash in', color: c.c2 }, { key: 'outflow', label: 'Cash out', color: c.c5 }]} lines={[{ key: 'gap', label: 'In − out', color: c.c1 }]} />
          <HowTo>Rent, salaries and subscriptions usually leave early in the month while student fees arrive later — that gap is the cash you must keep ready (or a running-finance line).</HowTo>
        </Card>
        <Card title="A typical month: running cash (history)" subtitle={h.lowDay?.day ? `Lowest point is usually around day ${h.lowDay.day} (${money(h.lowDay.value)} below the month’s start)` : 'Cumulative in − out by day of the month'}>
          <TrendLine data={h.curve} dataKey="cumulative" xKey="day" area height={250} color={c.c4} />
        </Card>
      </div>
      <Card title="Upcoming cash events" subtitle="Installments, recurring bills, salaries, loans and planned items (daily averages for variable spending and new sales are not listed)" pad={false}
        actions={<Segmented value={dir} onChange={setDir} options={[{ value: '', label: 'All' }, { value: 'in', label: 'Cash in' }, { value: 'out', label: 'Cash out' }]} />}>
        <DataTable rows={events} pageSize={15} empty="Nothing scheduled in this window." columns={[
          { key: 'date', label: 'Date', render: r => date(r.date) },
          { key: 'dir', label: '', render: r => <Badge tone={r.dir === 'in' ? 'green' : 'red'}>{r.dir === 'in' ? 'In' : 'Out'}</Badge> },
          { key: 'bucket', label: 'Type', render: r => (r.dir === 'in' ? IN_LABELS : OUT_LABELS)[r.bucket] || r.bucket },
          { key: 'title', label: 'Details', wrap: true, render: r => (r.link ? <Link to={r.link}>{r.title}</Link> : r.title) },
          { key: 'ref', label: 'Ref', render: r => <span className="mono small">{r.ref || '—'}</span> },
          { key: 'amount', label: 'Amount', money: true }]} />
      </Card>
      <div className="grid grid-2">
        <Card title="Biggest payments ahead">{d.biggestOut.length ? d.biggestOut.map((e, i) => <div key={i} className="list-row"><span><CalendarClock size={14} style={{ verticalAlign: -2 }} /> {date(e.date)} · {e.title}</span><b className="mono text-red">{money(e.amount)}</b></div>) : <div className="muted small">None</div>}</Card>
        <Card title="Biggest receipts ahead">{d.biggestIn.length ? d.biggestIn.map((e, i) => <div key={i} className="list-row"><span><CalendarClock size={14} style={{ verticalAlign: -2 }} /> {date(e.date)} · {e.title}</span><b className="mono text-green">{money(e.amount)}</b></div>) : <div className="muted small">None</div>}</Card>
      </div>
    </div>
  );
}
