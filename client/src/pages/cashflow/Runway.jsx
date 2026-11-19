import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Hourglass, PiggyBank, TrendingDown, TrendingUp, CalendarX2, ShieldAlert, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { useLoad } from '../../lib/auth.jsx';
import { Badge, Card, Kpi, Loader, Notice } from '../../components/ui.jsx';
import { ShareList } from '../../components/charts.jsx';
import { money as fmtMoney, date, monthName } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);
import { AssumptionsModal, BalanceChart, HowTo, PositionCard, months } from './shared.jsx';

const LEVEL = { safe: ['green', 'Safe — 12+ months'], watch: ['blue', 'Watch — 6 to 12 months'], danger: ['orange', 'Danger — 3 to 6 months'], critical: ['red', 'Critical — under 3 months'] };
const ml = m => `${monthName(m, true)} ’${m.slice(2, 4)}`;
const BURN = { operating: 'Operating expenses', petty: 'Petty cash', salariesPaid: 'Salaries paid', loanRepayments: 'Loan repayments', refunds: 'Refunds to students', assetPurchases: 'Asset purchases', drawing: 'Owner drawings' };

export default function Runway() {
  const [v, setV] = useState(0);
  const [settings, setSettings] = useState(false);
  const { data: d, error } = useLoad('/cashflow/runway', [v]);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const r = d.runway, b = d.burn;
  const [tone, levelText] = LEVEL[r.level];
  const scale = 24, at = r.net === null ? scale : Math.min(scale, r.net);
  const chart = [
    ...d.history.map(h => ({ label: ml(h.month), inflow: h.inflow, outflow: h.outflow, closing: h.closing })),
    ...d.projection.slice(1).map(p => ({ label: `${ml(p.key)} ▸`, closing: p.closing, low: p.low })),
  ];
  return (
    <div className="stack">
      <PositionCard pos={d.position} onSettings={() => setSettings(true)} />
      <div className="grid grid-kpi">
        <Kpi icon={Hourglass} color={tone === 'green' ? 'green' : tone === 'blue' ? 'cyan' : tone} label="Cash runway (net burn)" value={r.net === null ? 'Cash positive' : months(r.net)} sub={r.netDate ? `Cash lasts until about ${date(r.netDate)}` : 'Money in ≥ money out on average'} />
        <Kpi icon={ShieldAlert} color="purple" label="If all income stopped" value={months(r.gross)} sub="Cash ÷ average monthly cash out" />
        <Kpi icon={Flame} color="red" label="Average cash out / month" value={money(b.gross)} sub={`Gross burn · last ${d.averages.months.length} month(s)${d.averages.scaled ? ' (this month, scaled)' : ''}`} />
        <Kpi icon={ArrowDownCircle} color="green" label="Average cash in / month" value={money(b.inflow)} sub="Fees, commissions, loans, investment" />
        <Kpi icon={b.net > 0 ? TrendingDown : TrendingUp} color={b.net > 0 ? 'orange' : 'green'} label={b.net > 0 ? 'Net burn / month' : 'Net cash gain / month'} value={money(Math.abs(b.net))} sub="Cash out − cash in" />
        <Kpi icon={PiggyBank} color="blue" label="Safety buffer" value={money(d.buffer)} sub={<Link to="/cash-flow/surplus-deficit">Surplus &amp; deficit →</Link>} />
      </div>

      <Card title="Runway meter" subtitle="How many months the cash lasts at the current net burn" actions={<Badge tone={tone}>{levelText}</Badge>}>
        <div className="runway-meter">
          <div className="runway-track"><span className="z critical" /><span className="z danger" /><span className="z watch" /><span className="z safe" /></div>
          <div className="runway-marker" style={{ insetInlineStart: `${(at / scale) * 100}%` }}><b>{r.net === null ? '∞' : months(r.net)}</b></div>
          <div className="runway-scale">{[[0, '0'], [12.5, '3'], [25, '6'], [50, '12'], [100, '24+ months']].map(([p, l]) => <span key={l} style={{ insetInlineStart: `${p}%` }}>{l}</span>)}</div>
        </div>
        <div className="grid grid-3" style={{ marginTop: 18 }}>
          <div className="cf-fact"><CalendarX2 /><div><span>Forecast: cash below zero</span><b>{d.forecast.zeroDate ? date(d.forecast.zeroDate) : 'Not in the next 12 months'}</b></div></div>
          <div className="cf-fact"><ShieldAlert /><div><span>Forecast: below the safety buffer</span><b>{d.forecast.bufferDate ? date(d.forecast.bufferDate) : 'Not in the next 12 months'}</b></div></div>
          <div className="cf-fact"><TrendingDown /><div><span>Lowest point in 12 months</span><b className={d.forecast.lowest.balance < 0 ? 'text-red' : ''}>{money(d.forecast.lowest.balance)} · {date(d.forecast.lowest.date)}</b></div></div>
        </div>
      </Card>

      <div className="grid grid-main">
        <Card title="Cash balance — last 12 months and next 12 months" subtitle="Bars = actual cash in / out. ▸ = forecast (expected case, see Cash Forecast)">
          <BalanceChart data={chart} lowKey="low" buffer={d.buffer} height={330} />
        </Card>
        <Card title="Where the burn goes" subtitle="Average cash out per month">
          <ShareList items={b.parts.map(p => ({ name: BURN[p.key] || p.key, value: p.value }))} colorIndex={4} />
        </Card>
      </div>

      <Card title="How to make the cash last longer" subtitle="For a study-abroad consultancy">
        <ul className="cf-tips">
          <li><ArrowDownCircle /><span><b>Collect first:</b> overdue student installments and university commissions are the fastest cash. <Link to="/cash-flow/working-capital">See receivables ageing →</Link></span></li>
          <li><ArrowUpCircle /><span><b>Hold what can wait:</b> put non-urgent constant expenses on hold until fee collections arrive. <Link to="/cash-flow/payments">Payment control →</Link></span></li>
          <li><Flame /><span><b>Give budgets, not open access:</b> allot fixed cash to staff for expos, courier and attestation runs instead of open spending. <Link to="/cash-flow/budgets">Budget allotment →</Link></span></li>
          <li><PiggyBank /><span><b>Line up finance before you need it:</b> a running-finance limit is cheaper when arranged early. <Link to="/cash-flow/treasury">Treasury &amp; banking →</Link></span></li>
        </ul>
        <HowTo>Runway (net) = cash today ÷ (average monthly cash out − average monthly cash in). The meter uses the last {d.settings.burn_months} complete month(s); the forecast dates use the full cash budget (installments, recurring bills, salaries, loans and planned items).</HowTo>
      </Card>
      <AssumptionsModal open={settings} onClose={() => setSettings(false)} onSaved={() => setV(x => x + 1)} />
    </div>
  );
}
