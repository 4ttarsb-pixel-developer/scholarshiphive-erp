import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend as RLegend } from 'recharts';
import { ArrowLeftRight, BadgePercent, CheckCircle2, Repeat, Sigma, XCircle } from 'lucide-react';
import { useLoad } from '../../lib/auth.jsx';
import { Card, Field, Input, Kpi, Loader, MoneyInput, Notice, Segmented } from '../../components/ui.jsx';
import { useColors } from '../../components/charts.jsx';
import { axisMoney, money as fmtMoney, date } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);
import { baumol, baumolCurve, discountCost, millerOrr, millerOrrAction } from '../../lib/cashmodels.js';
import { HowTo } from './shared.jsx';

const n = x => Number(String(x ?? '').replace(/,/g, '')) || 0;
const pctIn = (v, set) => <div className="input-suffix"><Input inputMode="decimal" value={v} onChange={e => set(e.target.value.replace(/[^\d.]/g, ''))} /><span>%</span></div>;
const daysIn = (v, set) => <div className="input-suffix"><Input inputMode="numeric" value={v} onChange={e => set(e.target.value.replace(/\D/g, ''))} /><span>days</span></div>;

export default function Models() {
  const [sp, setSp] = useSearchParams();
  const tab = ['baumol', 'miller', 'discount'].includes(sp.get('tab')) ? sp.get('tab') : 'baumol';
  const { data: d, error } = useLoad('/cashflow/models');
  const wc = useLoad('/cashflow/working-capital');
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  return (
    <div className="stack">
      <div className="view-switch">
        <Segmented value={tab} onChange={t => setSp(p => { const x = new URLSearchParams(p); x.set('tab', t); return x; }, { replace: true })} options={[
          { value: 'baumol', label: <span className="row" style={{ gap: 6 }}><Repeat size={15} />Baumol model</span> },
          { value: 'miller', label: <span className="row" style={{ gap: 6 }}><Sigma size={15} />Miller–Orr model</span> },
          { value: 'discount', label: <span className="row" style={{ gap: 6 }}><BadgePercent size={15} />Cash discount vs interest</span> }]} />
      </div>
      {tab === 'baumol' && <Baumol d={d} />}
      {tab === 'miller' && <MillerOrr d={d} />}
      {tab === 'discount' && <Discount d={d} wc={wc.data} />}
    </div>
  );
}

function Baumol({ d }) {
  const c = useColors();
  const [T, setT] = useState(String(Math.round(d.yearlyNeed || 0)));
  const [F, setF] = useState(String(d.settings.transaction_cost));
  const [i, setI] = useState(String(d.settings.interest_rate));
  const b = useMemo(() => baumol(n(T), n(F), n(i)), [T, F, i]);
  const curve = useMemo(() => baumolCurve(n(T), n(F), n(i)), [T, F, i]);
  return (
    <>
      <Card title="Baumol model — how much cash to move at a time" subtitle="Treats cash like stock: every transfer from deposits / T-bills costs money, and keeping cash idle loses interest">
        <div className="form-grid">
          <Field label="Cash needed in a year (T)" hint={`Your last 12 months of cash out${d.activeMonths < 12 ? `, annualised from ${d.activeMonths} month(s)` : ''}`}><MoneyInput value={T} onChange={setT} /></Field>
          <Field label="Cost per transfer (F)" hint="Bank charges + time to sell / move investments"><MoneyInput value={F} onChange={setF} /></Field>
          <Field label="Interest rate you give up (i)" hint="Deposit / T-bill rate, yearly">{pctIn(i, setI)}</Field>
        </div>
        <div className="formula">C* = √(2 × T × F ÷ i) = √(2 × {money(n(T))} × {money(n(F))} ÷ {n(i)}%)</div>
      </Card>
      {!b ? <Notice type="warn">Enter a yearly cash need, a transfer cost and an interest rate above zero.</Notice> : (
        <>
          <div className="grid grid-kpi">
            <Kpi icon={ArrowLeftRight} color="blue" label="Best transfer size (C*)" value={money(b.optimal)} sub="Move this much each time" />
            <Kpi icon={Repeat} color="purple" label="Transfers per year" value={b.transfers} sub={`About every ${Math.round(b.daysBetween)} days`} />
            <Kpi icon={Sigma} color="cyan" label="Average cash balance" value={money(b.averageCash)} sub="C* ÷ 2" />
            <Kpi icon={BadgePercent} color="orange" label="Lowest total cost / year" value={money(b.totalCost)} sub={`Transfers ${money(b.transactionCost)} + lost interest ${money(b.holdingCost)}`} />
          </div>
          <Card title="Cost curve" subtitle="Small transfers = many bank charges; big transfers = more idle cash. C* is where the total is lowest.">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={curve} margin={{ top: 10, right: 12, left: -4, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="cash" type="number" domain={['dataMin', 'dataMax']} tickFormatter={axisMoney} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={56} />
                <Tooltip formatter={v => money(v)} labelFormatter={l => `Transfer size ${money(l)}`} />
                <RLegend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="transaction" name="Transfer costs" stroke={c.c3} dot={false} strokeWidth={2} />
                <Line dataKey="holding" name="Lost interest" stroke={c.c4} dot={false} strokeWidth={2} />
                <Line dataKey="total" name="Total cost" stroke={c.c1} dot={false} strokeWidth={3} />
                <ReferenceLine x={b.optimal} stroke={c.c2} strokeDasharray="5 4" label={{ value: 'C*', position: 'top', fill: c.c2 }} />
              </LineChart>
            </ResponsiveContainer>
            <Notice type="info">For ScholarshipHive: keep fee collections in a deposit / T-bill account and move <b>{money(b.optimal)}</b> into the current account about every <b>{Math.round(b.daysBetween)} days</b>. Average idle cash is then only {money(b.averageCash)}.</Notice>
            <HowTo>Baumol assumes cash is spent evenly. Study-abroad cash is seasonal — use Miller–Orr for day-to-day limits and the Cash Forecast for intake peaks.</HowTo>
          </Card>
        </>
      )}
    </>
  );
}

function MillerOrr({ d }) {
  const c = useColors();
  const [L, setL] = useState(String(Math.round(d.buffer || 0)));
  const [F, setF] = useState(String(d.settings.transaction_cost));
  const [i, setI] = useState(String(d.settings.interest_rate));
  const [sd, setSd] = useState(String(Math.round(d.dailyStats.stdev || 0)));
  const m = useMemo(() => millerOrr(n(L), n(F), n(sd) ** 2, n(i)), [L, F, i, sd]);
  const act = millerOrrAction(d.cash, m);
  const hist = useMemo(() => {
    let bal = d.cash;
    const rows = [...d.daily].reverse().map(x => { const r = { date: x.date, balance: Math.round(bal) }; bal -= x.net; return r; });
    return rows.reverse().map(r => ({ ...r, label: date(r.date) }));
  }, [d]);
  return (
    <>
      <Card title="Miller–Orr model — upper and lower cash limits" subtitle="For cash that goes up and down unpredictably every day (fees in, bills out)">
        <div className="form-grid">
          <Field label="Lower limit L (minimum cash)" hint="Usually your safety buffer"><MoneyInput value={L} onChange={setL} /></Field>
          <Field label="Cost per transfer (F)"><MoneyInput value={F} onChange={setF} /></Field>
          <Field label="Interest rate (yearly)">{pctIn(i, setI)}</Field>
          <Field label="Daily ups & downs (σ, standard deviation)" hint={`From ${d.dailyStats.n} days of your cash flow · variance σ² = ${money(d.dailyStats.variance)}`}><MoneyInput value={sd} onChange={setSd} /></Field>
        </div>
        <div className="formula">Spread = 3 × ∛(¾ × F × σ² ÷ daily interest) · Return point Z = L + spread ÷ 3 · Upper limit H = L + spread</div>
      </Card>
      {!m ? <Notice type="warn">Needs some daily cash movement (σ above zero), a transfer cost and an interest rate.</Notice> : (
        <>
          <div className="grid grid-kpi">
            <Kpi icon={Sigma} color="red" label="Upper limit (H)" value={money(m.upper)} sub="Above this → invest the extra" />
            <Kpi icon={ArrowLeftRight} color="blue" label="Return point (Z)" value={money(m.returnPoint)} sub="Bring cash back to this" />
            <Kpi icon={Sigma} color="orange" label="Lower limit (L)" value={money(m.lower)} sub="Below this → sell / borrow" />
            <Kpi icon={act.action === 'hold' ? CheckCircle2 : XCircle} color={act.action === 'hold' ? 'green' : act.action === 'invest' ? 'cyan' : 'red'} label="Today" value={act.action === 'invest' ? `Invest ${money(act.amount)}` : act.action === 'raise' ? `Raise ${money(act.amount)}` : 'Inside the band'} sub={`Cash ${money(d.cash)}`} />
          </div>
          <Card title="Your cash against the Miller–Orr band" subtitle="Last 180 days (balance rebuilt from daily cash in / out)">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={hist} margin={{ top: 10, right: 12, left: -4, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
                <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={60} domain={[Math.min(m.lower * 0.8, ...hist.map(h => h.balance)), Math.max(m.upper * 1.1, ...hist.map(h => h.balance))]} />
                <Tooltip formatter={v => money(v)} />
                <Line dataKey="balance" name="Cash balance" stroke={c.c1} dot={false} strokeWidth={2.2} />
                <ReferenceLine y={m.upper} stroke={c.c5} strokeDasharray="6 4" label={{ value: 'H', position: 'insideRight', fill: c.c5 }} />
                <ReferenceLine y={m.returnPoint} stroke={c.c2} strokeDasharray="6 4" label={{ value: 'Z', position: 'insideRight', fill: c.c2 }} />
                <ReferenceLine y={m.lower} stroke={c.c3} strokeDasharray="6 4" label={{ value: 'L', position: 'insideRight', fill: c.c3 }} />
              </LineChart>
            </ResponsiveContainer>
            <HowTo>Only act when cash touches a limit: at H move {money(m.upper - m.returnPoint)} into short-term investments; at L bring {money(m.returnPoint - m.lower)} back (sell investments or use running finance). Inside the band, do nothing — that keeps bank charges and idle cash low.</HowTo>
          </Card>
        </>
      )}
    </>
  );
}

function Verdict({ ok, yes, no }) {
  return <Notice type={ok ? 'success' : 'warn'}>{ok ? yes : no}</Notice>;
}

function Discount({ d, wc }) {
  const [mode, setMode] = useState('vendor');
  const borrow = d.borrowRate ?? d.settings.interest_rate;
  // vendor offers us a discount
  const [vd, setVd] = useState('2'); const [vD, setVD] = useState('10'); const [vN, setVN] = useState('30'); const [vAmt, setVAmt] = useState('500000'); const [vr, setVr] = useState(String(borrow));
  const cost = discountCost(n(vd), n(vD), n(vN));
  const saving = (n(vAmt) * n(vd)) / 100;
  const interest = (n(vAmt) * (1 - n(vd) / 100) * n(vr) * (n(vN) - n(vD))) / 100 / 365;
  // we offer students a discount for paying the full fee now
  const [sFee, setSFee] = useState('300000'); const [sd, setSd] = useState('3'); const [sDays, setSDays] = useState(String(Math.round(wc?.receivables?.collectionDays || 60))); const [sr, setSr] = useState(String(borrow));
  const sCost = discountCost(n(sd), 0, n(sDays));
  const given = (n(sFee) * n(sd)) / 100;
  const earned = (n(sFee) * n(sr) * n(sDays)) / 100 / 365;
  return (
    <>
      <div className="view-switch"><Segmented value={mode} onChange={setMode} options={[{ value: 'vendor', label: 'A vendor offers us a discount' }, { value: 'student', label: 'We offer students a discount' }]} /></div>
      {mode === 'vendor' ? (
        <Card title="Should we pay early to get the discount?" subtitle="e.g. “2/10 net 30” — 2% off if paid within 10 days, otherwise full amount in 30 days">
          <div className="form-grid">
            <Field label="Discount">{pctIn(vd, setVd)}</Field>
            <Field label="If paid within">{daysIn(vD, setVD)}</Field>
            <Field label="Otherwise full amount due in">{daysIn(vN, setVN)}</Field>
            <Field label="Bill amount (PKR)"><MoneyInput value={vAmt} onChange={setVAmt} /></Field>
            <Field label="Our borrowing rate (overdraft / running finance)" hint={d.borrowSource ? `From ${d.borrowSource}` : 'Add a credit line in Treasury'}>{pctIn(vr, setVr)}</Field>
          </div>
          {cost ? <>
            <div className="formula">Cost of NOT taking the discount = d ÷ (1 − d) × 365 ÷ (N − D) = <b>{cost.simple}%</b> a year (compounded {cost.effective}%)</div>
            <div className="grid grid-3" style={{ margin: '12px 0' }}>
              <div className="cf-fact"><BadgePercent /><div><span>Discount saved</span><b className="text-green">{money(saving)}</b></div></div>
              <div className="cf-fact"><ArrowLeftRight /><div><span>Interest if we borrow to pay early</span><b className="text-red">{money(interest)}</b></div></div>
              <div className="cf-fact"><CheckCircle2 /><div><span>Net gain</span><b>{money(saving - interest)}</b></div></div>
            </div>
            <Verdict ok={cost.simple > n(vr)} yes={<>Take the discount — skipping it costs {cost.simple}% a year, more than borrowing at {n(vr)}%. Even if you use running finance to pay early you gain {money(saving - interest)}.</>}
              no={<>Do not borrow for this discount — it is worth only {cost.simple}% a year, less than your {n(vr)}% borrowing cost. Take it only if you have idle cash.</>} />
          </> : <Notice type="warn">Discount must be above 0% and the full-payment day must be after the discount day.</Notice>}
        </Card>
      ) : (
        <Card title="Full-fee discount to students vs waiting for installments" subtitle="Is a small discount for paying the whole package now cheaper than financing the wait?">
          <div className="form-grid">
            <Field label="Package fee (PKR)"><MoneyInput value={sFee} onChange={setSFee} /></Field>
            <Field label="Discount for paying in full now">{pctIn(sd, setSd)}</Field>
            <Field label="Days we would otherwise wait" hint={wc?.receivables?.collectionDays ? `Your average sale-to-payment time is ${Math.round(wc.receivables.collectionDays)} days` : 'Average time until installments arrive'}>{daysIn(sDays, setSDays)}</Field>
            <Field label="Our cost of money (borrowing / lost interest)">{pctIn(sr, setSr)}</Field>
          </div>
          {sCost ? <>
            <div className="formula">Yearly cost of the discount = d ÷ (1 − d) × 365 ÷ days = <b>{sCost.simple}%</b></div>
            <div className="grid grid-3" style={{ margin: '12px 0' }}>
              <div className="cf-fact"><BadgePercent /><div><span>Discount given</span><b className="text-red">{money(given)}</b></div></div>
              <div className="cf-fact"><ArrowLeftRight /><div><span>Interest saved / earned by getting cash now</span><b className="text-green">{money(earned)}</b></div></div>
              <div className="cf-fact"><CheckCircle2 /><div><span>Net effect per student</span><b>{money(earned - given)}</b></div></div>
            </div>
            <Verdict ok={sCost.simple <= n(sr)} yes={<>Offer it — the discount costs {sCost.simple}% a year, cheaper than your {n(sr)}% cost of money. It also removes the risk of a student dropping out before paying.</>}
              no={<>Too expensive in pure money terms ({sCost.simple}% a year vs {n(sr)}%). Use it only in a deficit month, or lower it to about {Math.max(0, Math.round(((n(sr) / 100) * n(sDays)) / 365 / (1 + ((n(sr) / 100) * n(sDays)) / 365) * 1000) / 10)}%.</>} />
          </> : <Notice type="warn">Enter a discount above 0% and the number of days.</Notice>}
        </Card>
      )}
    </>
  );
}
