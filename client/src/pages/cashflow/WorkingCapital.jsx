import { Link } from 'react-router-dom';
import { AlertTriangle, Boxes, Briefcase, CircleDollarSign, Clock, HandCoins, Info, Lightbulb, Receipt, RefreshCcw, Scale, XCircle } from 'lucide-react';
import { useLoad } from '../../lib/auth.jsx';
import { Badge, Card, DataTable, ExportButtons, Kpi, Loader, Notice } from '../../components/ui.jsx';
import { ShareList, SimpleBars, useColors } from '../../components/charts.jsx';
import { money as fmtMoney, date } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);
import { HowTo, days } from './shared.jsx';

const TIP_ICON = { warn: AlertTriangle, info: Info, error: XCircle };

function CycleBar({ cycle }) {
  const { dio = 0, dso, dpo = 0, ccc } = cycle;
  if (dso === null) return <div className="muted small">Needs sales in the last 90 days to measure the cycle.</div>;
  const total = Math.max(1, (dio || 0) + dso, dpo || 0);
  const w = x => `${Math.max(0, (x / total) * 100)}%`;
  return (
    <div className="ccc">
      <div className="ccc-row"><span className="ccc-l">Operating cycle</span><div className="ccc-track">{dio > 0 && <span className="seg-dio" style={{ width: w(dio) }}>Stock {Math.round(dio)}d</span>}<span className="seg-dso" style={{ width: w(dso) }}>Students pay in {Math.round(dso)}d</span></div></div>
      <div className="ccc-row"><span className="ccc-l">We pay vendors</span><div className="ccc-track"><span className="seg-dpo" style={{ width: w(dpo || 0) }}>{Math.round(dpo || 0)}d</span></div></div>
      <div className="ccc-result"><RefreshCcw size={16} />Cash conversion cycle = {Math.round(dio || 0)} + {Math.round(dso)} − {Math.round(dpo || 0)} = <b>{days(ccc)}</b>
        <span className="muted small"> — days your own cash is tied up between paying out and collecting fees.</span></div>
    </div>
  );
}

export default function WorkingCapital() {
  const { data: d, error } = useLoad('/cashflow/working-capital');
  const c = useColors();
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const r = d.receivables, p = d.payables, inv = d.inventory, cy = d.cycle, pos = d.position;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi icon={HandCoins} color="blue" label="Receivables (students owe)" value={money(r.total)} sub={<>{money(r.overdue)} overdue · <Link to="/revenue/upcoming">follow up →</Link></>} />
        <Kpi icon={Receipt} color="orange" label="Payables (we owe)" value={money(p.total)} sub={`${p.count} bill(s) waiting · ${money(p.held)} on hold`} />
        <Kpi icon={Boxes} color="purple" label="Cash blocked in stock & prepaid" value={money(inv.stock + inv.prepaid)} sub={`Stock ${money(inv.stock)} · prepaid ${money(inv.prepaid)}`} />
        <Kpi icon={Briefcase} color={pos.workingCapital >= 0 ? 'green' : 'red'} label="Net working capital" value={money(pos.workingCapital)} sub="Current assets − current liabilities" />
        <Kpi icon={Scale} color={pos.currentRatio === null || pos.currentRatio >= 1.2 ? 'cyan' : 'red'} label="Current ratio" value={pos.currentRatio ?? '—'} sub={`Quick ratio ${pos.quickRatio ?? '—'} · aim ≥ 1.2`} />
        <Kpi icon={RefreshCcw} color="blue" label="Cash conversion cycle" value={days(cy.ccc)} sub={`DSO ${days(cy.dso)} · DPO ${days(cy.dpo)} · DIO ${days(cy.dio)}`} />
      </div>
      <div className="grid grid-main">
        <Card title="Operating cash cycle (conversion cycle)" subtitle="How long cash is locked from the day you pay to the day the student pays">
          <CycleBar cycle={cy} />
          <div className="grid grid-3" style={{ marginTop: 14 }}>
            <div className="cf-fact"><HandCoins /><div><span>DSO — receivable days</span><b>{days(cy.dso)}</b><small className={cy.dso > cy.targets.dso ? 'text-red' : 'muted'}>target {cy.targets.dso} days</small></div></div>
            <div className="cf-fact"><Receipt /><div><span>DPO — payable days</span><b>{days(cy.dpo)}</b><small className="muted">target {cy.targets.dpo} days</small></div></div>
            <div className="cf-fact"><Boxes /><div><span>DIO — stock days</span><b>{days(cy.dio)}</b><small className={cy.dio > cy.targets.dio ? 'text-red' : 'muted'}>target {cy.targets.dio} days</small></div></div>
          </div>
          <HowTo>DSO = receivables ÷ (sales booked in 90 days ÷ 90). DPO = bills waiting + trade payables ÷ (approved expenses in 90 days ÷ 90). DIO = stock (assets: Stock / Inventory) ÷ (supplies used in 90 days ÷ 90). Average real collection time from sale to payment: {days(r.collectionDays)}.</HowTo>
        </Card>
        <Card title={<span className="row" style={{ gap: 6 }}><Lightbulb size={16} />What to do</span>}>
          {d.tips.length ? <ul className="cf-tips">{d.tips.map((t, i) => { const I = TIP_ICON[t.level] || Info; return <li key={i} className={t.level}><I /><span>{t.text}{t.link && <> <Link to={t.link}>Open →</Link></>}</span></li>; })}</ul> : <Notice type="success">Working capital looks healthy.</Notice>}
        </Card>
      </div>

      <h2 className="cf-h2"><HandCoins size={18} />Receivables (debtors) — student fees &amp; partner money</h2>
      <div className="grid grid-main">
        <Card title="Receivables ageing" subtitle="How late the money is">
          <SimpleBars data={r.aging} xKey="label" height={230} keys={[{ key: 'amount', label: 'Amount', color: c.c1 }]} />
          <div className="aging-row">{r.aging.map(a => <span key={a.key} className={a.key === 'current' ? '' : a.key === 'd30' ? 'w' : 'b'}><small>{a.label}</small><b>{money(a.amount)}</b><small>{a.count} item(s)</small></span>)}</div>
        </Card>
        <Card title="By counsellor"><ShareList items={r.byCounsellor} colorIndex={1} /></Card>
      </div>
      <Card title="Who owes the most" subtitle="Overdue first · call these students / partners" pad={false} actions={<ExportButtons dataset="receivables" />}>
        <DataTable rows={r.debtors} pageSize={10} empty="No money is owed by students right now." columns={[
          { key: 'customer', label: 'Student / client', render: x => <div className="cell-2"><b>{x.customer}</b><small>{x.phone || ''}</small></div> },
          { key: 'employee_name', label: 'Counsellor' }, { key: 'invoices', label: 'Invoices', render: x => <span className="mono small">{x.invoices.join(', ')}</span> },
          { key: 'oldest', label: 'Oldest overdue', render: x => (x.oldest ? <Badge tone={x.oldest > 60 ? 'red' : 'orange'}>{x.oldest} days</Badge> : <span className="muted">{x.nextDue ? `Due ${date(x.nextDue)}` : '—'}</span>) },
          { key: 'overdue', label: 'Overdue', money: true }, { key: 'amount', label: 'Total due', money: true }]} />
      </Card>
      <div className="grid grid-2">
        <Card title="By destination country"><ShareList items={r.byCountry} colorIndex={3} /></Card>
        <Card title="Other receivables" subtitle="From the assets register (receivables, staff advances)">
          <div className="slip-row"><span>Recorded in Assets</span><b>{money(r.other)}</b></div>
          <div className="slip-row"><span>Sales booked (last 90 days)</span><b>{money(r.sales90)}</b></div>
          <HowTo to="/assets/medium" label="Medium liquid assets">University commissions you are waiting for can be added as planned receipts in Cash Forecast, or as a receivable asset.</HowTo>
        </Card>
      </div>

      <h2 className="cf-h2"><Receipt size={18} />Payables (creditors) — bills we still have to pay</h2>
      <div className="grid grid-main">
        <Card title="Bills waiting approval / payment" pad={false} actions={<Link className="btn btn-sm" to="/cash-flow/payments">Payment control</Link>}>
          <DataTable rows={p.list} pageSize={8} empty="No bills waiting." columns={[
            { key: 'due', label: 'Due', render: x => date(x.due) }, { key: 'ref_no', label: 'Ref #', render: x => <span className="mono">{x.ref_no}</span> },
            { key: 'title', label: 'Expense', render: x => <div className="cell-2"><b>{x.sub_category || x.category}</b><small>{x.paid_to}</small></div> },
            { key: 'on_hold', label: '', render: x => (x.on_hold ? <Badge tone="grey"><Clock size={11} />On hold</Badge> : x.expense_type === 'constant' ? <Badge tone="purple">Constant</Badge> : <Badge tone="cyan">Variable</Badge>) },
            { key: 'amount', label: 'Amount', money: true }]} />
        </Card>
        <Card title="Payables ageing">
          {p.aging.map(a => <div key={a.key} className="slip-row"><span>{a.label}</span><b>{money(a.amount)} <small className="muted">({a.count})</small></b></div>)}
          {p.trade.length > 0 && <><div className="form-section" style={{ marginTop: 10 }}><span><CircleDollarSign size={12} /></span>Trade payables (Liabilities)</div>
            {p.trade.map(t => <div key={t.id} className="slip-row"><span>{t.title} · {t.lender}</span><b>{money(t.outstanding)}</b></div>)}</>}
        </Card>
      </div>

      <h2 className="cf-h2"><Boxes size={18} />Inventory &amp; prepaid — avoid unnecessary cash block</h2>
      <Card pad={false} subtitle="Stationery stock, marketing material, welcome kits, prepaid rent and deposits from the assets register" title="Cash locked in things" actions={<Link className="btn btn-sm" to="/assets/medium">Assets</Link>}>
        <DataTable rows={inv.items} search={false} empty="No stock or prepaid items in the assets register." columns={[{ key: 'name', label: 'Item' }, { key: 'category', label: 'Type' }, { key: 'sub_category', label: 'Detail', render: x => x.sub_category || '—' }, { key: 'value', label: 'Value', money: true }]} />
        <div className="card-body small muted">Supplies used in the last 90 days: {money(inv.consumption90)} · stock lasts about {days(inv.dio)}.</div>
      </Card>
    </div>
  );
}
