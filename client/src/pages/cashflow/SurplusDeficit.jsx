import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, CircleArrowDown, CircleArrowUp, HandCoins, Landmark, PauseCircle, PiggyBank, Sprout, TriangleAlert, UserPlus } from 'lucide-react';
import { useLoad } from '../../lib/auth.jsx';
import { qs } from '../../lib/api.js';
import { Card, Field, Input, Kpi, Loader, MoneyInput, Notice, Select } from '../../components/ui.jsx';
import { money as fmtMoney, date } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);
import { CashBadge, HowTo, ScenarioSwitch } from './shared.jsx';

const r2 = n => Math.round(Number(n || 0) * 100) / 100;

export default function SurplusDeficit() {
  const [scenario, setScenario] = useState('base');
  const f = useLoad(`/cashflow/forecast${qs({ scenario, months: 12 })}`);
  const md = useLoad('/cashflow/models');
  const wc = useLoad('/cashflow/working-capital');
  const d = f.data;
  const worst = useMemo(() => (d ? d.months.reduce((m, x) => (x.need > (m?.need || 0) ? x : m), null) : null), [d]);
  const best = useMemo(() => (d ? d.months.reduce((m, x) => (x.surplus > (m?.surplus || 0) ? x : m), null) : null), [d]);
  const [amt, setAmt] = useState('');
  const [daysN, setDaysN] = useState('30');
  const [src, setSrc] = useState('');
  if (f.error) return <Notice type="error">{f.error.message}</Notice>;
  if (!d || !md.data) return <Loader />;
  const lines = d.position.credit.lines;
  const rate = md.data.settings.interest_rate;
  const need = Number(amt || worst?.need || 0);
  const chosen = lines.find(l => String(l.id) === src) || lines[0];
  const loanRate = chosen?.rate ?? rate;
  const cost = r2((need * loanRate * Number(daysN || 0)) / 100 / 365);
  const surplus = best?.surplus || 0;
  const overdue = wc.data?.receivables?.overdue || 0;
  const bills = (wc.data?.payables?.bills || 0) - (wc.data?.payables?.held || 0);
  const mo = md.data.millerOrr, ba = md.data.baumol;
  const options = [
    ...lines.map(l => ({ icon: Landmark, name: `${l.name} (${l.kind.replace('_', ' ')})`, can: l.available, cost: r2((Math.min(need, l.available) * l.rate) / 100 / 12), note: `${l.rate}% a year · only on the amount used` })),
    { icon: HandCoins, name: 'Collect overdue student fees', can: overdue, cost: r2(overdue * 0.02), note: 'Cost ≈ a 2% early-payment discount if you offer one', link: '/cash-flow/working-capital' },
    { icon: PauseCircle, name: 'Hold / delay non-urgent bills', can: bills, cost: 0, note: 'Free, but never delay salaries, tax or rent agreements', link: '/cash-flow/payments' },
    { icon: Banknote, name: 'Short-term bank loan', can: null, cost: r2((need * rate) / 100 / 12), note: `At ~${rate}% a year · add it in Liabilities when taken`, link: '/liabilities/new' },
    { icon: UserPlus, name: 'Owner / partner injection', can: null, cost: 0, note: 'No interest, but reduces owner’s free cash', link: '/capital/new' },
  ];
  return (
    <div className="stack">
      <div className="cf-toolbar"><ScenarioSwitch value={scenario} onChange={setScenario} /><div className="spacer" /><Link className="btn btn-sm" to="/cash-flow/forecast">Full cash budget</Link></div>
      <div className="grid grid-kpi">
        <Kpi icon={TriangleAlert} color={d.summary.deficitMonths ? 'red' : 'green'} label="Deficit months (next 12)" value={d.summary.deficitMonths} sub={`${d.summary.belowBufferMonths} more below the buffer`} />
        <Kpi icon={CircleArrowDown} color="red" label="Biggest shortfall" value={money(worst?.need || 0)} sub={worst?.need ? `${worst.label} · lowest on ${date(worst.lowDate)}` : 'No financing needed'} />
        <Kpi icon={CircleArrowUp} color="green" label="Biggest idle surplus" value={money(surplus)} sub={best?.surplus ? best.label : 'No surplus above the buffer'} />
        <Kpi icon={Landmark} color="purple" label="Unused credit lines" value={money(d.position.credit.available)} sub={lines.length ? `${lines.length} line(s)` : <Link to="/cash-flow/treasury">Add overdraft / running finance →</Link>} />
      </div>
      <Card title="Month by month" subtitle="Surplus = cash above the safety buffer at the month’s lowest point · deficit = below zero">
        <div className="month-strip">
          {d.months.map(m => (
            <div key={m.key} className={`ms ${m.status}`}>
              <span className="ms-l">{m.label.replace(' (rest)', '*')}</span>
              <CashBadge status={m.status} />
              <b>{money(m.status === 'surplus' ? m.surplus : -m.need, { short: true })}</b>
              <small>low {money(m.low, { short: true })}</small>
            </div>
          ))}
        </div>
        <HowTo>Buffer = {money(d.buffer)}. * = rest of this month.</HowTo>
      </Card>

      <div className="grid grid-2">
        <Card title={<span className="row" style={{ gap: 6 }}><TriangleAlert size={16} />Managing a cash deficit (shortfall)</span>} subtitle="Overdraft, running finance, loans — and cheaper ways first" pad={false}>
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Option</th><th className="num">Can raise</th><th className="num">Cost / month</th></tr></thead>
            <tbody>{options.map((o, i) => (
              <tr key={i}><td><div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><o.icon size={16} /><div className="cell-2">{o.link ? <Link to={o.link}><b>{o.name}</b></Link> : <b>{o.name}</b>}<small>{o.note}</small></div></div></td>
                <td className="num">{o.can === null ? 'As agreed' : money(o.can)}</td><td className="num">{o.cost ? money(o.cost) : 'Free'}</td></tr>))}</tbody>
          </table></div>
          <div className="card-body">
            <div className="form-section"><span>₨</span>Interest cost calculator</div>
            <div className="form-grid">
              <Field label="Amount needed (PKR)"><MoneyInput value={amt} placeholder={String(Math.round(worst?.need || 0))} onChange={setAmt} /></Field>
              <Field label="For how many days"><Input inputMode="numeric" value={daysN} onChange={e => setDaysN(e.target.value.replace(/\D/g, ''))} /></Field>
              <Field label="From" full><Select value={src || String(chosen?.id || '')} onChange={setSrc} options={lines.length ? lines.map(l => ({ value: String(l.id), label: `${l.name} — ${l.rate}%` })) : [{ value: '', label: `Typical bank rate — ${rate}%` }]} ariaLabel="Source" /></Field>
            </div>
            <div className="notice info" style={{ marginTop: 10 }}><Banknote /><div>Borrowing <b>{money(need)}</b> for <b>{daysN || 0} days</b> at <b>{loanRate}%</b> costs about <b>{money(cost)}</b> in interest (amount × rate × days ÷ 365).</div></div>
          </div>
        </Card>

        <Card title={<span className="row" style={{ gap: 6 }}><Sprout size={16} />Managing a cash surplus (excess cash)</span>} subtitle="Idle cash earns nothing in a current account">
          <div className="slip-row"><span>Idle cash above the buffer (best month)</span><b>{money(surplus)}</b></div>
          <div className="slip-row"><span>If kept in a deposit / T-bill at {rate}% for a month</span><b className="text-green">{money(r2((surplus * rate) / 100 / 12))}</b></div>
          <div className="slip-row"><span>For 3 months</span><b className="text-green">{money(r2((surplus * rate) / 100 / 4))}</b></div>
          {mo && <>
            <div className="form-section" style={{ marginTop: 12 }}><span>M</span>Miller–Orr control limits (today)</div>
            <div className="slip-row"><span>Upper limit (invest above this)</span><b>{money(mo.upper)}</b></div>
            <div className="slip-row"><span>Return point (bring cash back to)</span><b>{money(mo.returnPoint)}</b></div>
            <div className="slip-row"><span>Lower limit (borrow / sell below this)</span><b>{money(mo.lower)}</b></div>
            <Notice type={md.data.action.action === 'invest' ? 'success' : md.data.action.action === 'raise' ? 'warn' : 'info'}>
              {md.data.action.action === 'invest' ? <>Cash today ({money(md.data.cash)}) is above the upper limit — invest about <b>{money(md.data.action.amount)}</b>.</>
                : md.data.action.action === 'raise' ? <>Cash today ({money(md.data.cash)}) is below the lower limit — raise about <b>{money(md.data.action.amount)}</b>.</>
                  : <>Cash today ({money(md.data.cash)}) is inside the limits — no transfer needed.</>}
            </Notice>
          </>}
          {ba && <div className="slip-row" style={{ marginTop: 6 }}><span>Baumol: best size of each transfer from investments</span><b>{money(ba.optimal)}</b></div>}
          <ul className="cf-tips" style={{ marginTop: 10 }}>
            <li><PiggyBank /><span>Keep fee collections for the next intake’s university payments in a separate deposit, not the running account.</span></li>
            <li><Landmark /><span>Repay the most expensive running finance first — saving 21% beats earning 12%.</span></li>
          </ul>
          <HowTo to="/cash-flow/models">The models use your last 180 days of daily cash flow.</HowTo>
        </Card>
      </div>
    </div>
  );
}
