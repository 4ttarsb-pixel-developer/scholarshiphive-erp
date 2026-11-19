// Shared pieces for the Cash Flow Manager pages: assumptions (settings) form, cash position card, balance chart, badges.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Legend as RLegend } from 'recharts';
import { Info, Landmark, Settings2, Wallet, Banknote, Users } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Badge, Button, Field, Input, Loader, Modal, MoneyInput, Notice, Segmented, useToast } from '../../components/ui.jsx';
import { useColors } from '../../components/charts.jsx';
import { axisMoney, money as fmtMoney, date, todayStr } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);

export const IN_LABELS = { receivables: 'Student fee installments due', overdue: 'Overdue fees (expected recovery)', newSales: 'New sales (expected cash)', planned: 'Planned receipts (commissions, owner money…)' };
export const OUT_LABELS = { salaries: 'Salaries', rent: 'Rent & lease', bills: 'Bills, utilities & subscriptions', taxes: 'Taxes & fees', variable: 'Variable expenses (average)', petty: 'Petty cash & staff budgets (average)', loans: 'Loan / finance repayments', payables: 'Bills waiting approval (payables)', planned: 'Planned payments' };
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const BASIS_TEXT = {
  opening: 'Opening cash you entered + every cash in / out recorded since that date',
  treasury: 'Bank / cash statement balances (Treasury) + cash in / out recorded after the statement date',
  system: 'All cash in − cash out recorded in the ERP (no opening balance entered yet)',
};
export const months = n => (n === null || n === undefined ? '—' : n >= 99 ? '99+ months' : `${Math.round(n * 10) / 10} month${Math.round(n * 10) / 10 === 1 ? '' : 's'}`);
export const days = n => (n === null || n === undefined ? '—' : `${Math.round(n)} day${Math.round(n) === 1 ? '' : 's'}`);

const STATUS = { deficit: ['red', 'Deficit'], below_buffer: ['orange', 'Below safety buffer'], surplus: ['green', 'Surplus'] };
export const CashBadge = ({ status }) => { const [t, l] = STATUS[status] || ['grey', status]; return <Badge tone={t}>{l}</Badge>; };

/** Bars for money in / out + a balance line, with the safety buffer and zero marked. */
export function BalanceChart({ data, xKey = 'label', height = 320, inKey = 'inflow', outKey = 'outflow', lineKey = 'closing', lowKey, buffer, area }) {
  const c = useColors();
  if (!data?.length) return <div className="muted small" style={{ padding: '40px 0', textAlign: 'center' }}>No data</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 10, left: -4, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} />
        <YAxis tickFormatter={axisMoney} tickLine={false} axisLine={false} width={60} />
        <Tooltip formatter={v => money(v)} cursor={{ fill: c.grid }} />
        <RLegend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} />
        {inKey && <Bar dataKey={inKey} name="Cash in" fill={c.c2} radius={[4, 4, 0, 0]} maxBarSize={22} />}
        {outKey && <Bar dataKey={outKey} name="Cash out" fill={c.c5} radius={[4, 4, 0, 0]} maxBarSize={22} />}
        {area ? <Area type="monotone" dataKey={lineKey} name="Cash balance" stroke={c.c1} fill={c.c1} fillOpacity={0.12} strokeWidth={2.4} />
          : <Line type="monotone" dataKey={lineKey} name="Cash balance (end)" stroke={c.c1} strokeWidth={2.6} dot={{ r: 3 }} />}
        {lowKey && <Line type="monotone" dataKey={lowKey} name="Lowest point" stroke={c.c3} strokeDasharray="5 4" strokeWidth={2} dot={false} />}
        {buffer > 0 && <ReferenceLine y={buffer} stroke={c.c3} strokeDasharray="6 4" label={{ value: 'Safety buffer', position: 'insideTopRight', fill: c.c3, fontSize: 11 }} />}
        <ReferenceLine y={0} stroke={c.c5} strokeWidth={1.2} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** "Cash today" card: where the number comes from, cash with staff, bank statements, unused credit lines. */
export function PositionCard({ pos, onSettings }) {
  if (!pos) return null;
  return (
    <div className="cf-position">
      <div className="cf-pos-main">
        <span className="small muted">Cash available today</span>
        <b className={pos.cash < 0 ? 'text-red' : ''}>{money(pos.cash)}</b>
        <span className="small muted row" style={{ gap: 5 }}><Info size={13} />{BASIS_TEXT[pos.basis]}{pos.basis === 'opening' && ` (${money(pos.anchor.amount)} on ${date(pos.anchor.from)})`}</span>
      </div>
      <div className="cf-pos-parts">
        <div><Wallet size={15} /><span>With staff (petty + budgets)</span><b>{money(pos.withStaff.total)}</b></div>
        <div><Banknote size={15} /><span>Bank &amp; cash statements</span><b>{pos.statements.count ? money(pos.statements.total) : '—'}</b></div>
        <div><Landmark size={15} /><span>Unused credit lines</span><b>{money(pos.credit.available)}</b></div>
        {pos.statements.difference !== null && Math.abs(pos.statements.difference) >= 1 && pos.basis !== 'treasury' && (
          <div className={Math.abs(pos.statements.difference) > Math.max(1000, Math.abs(pos.cash) * 0.02) ? 'warn' : ''}><Users size={15} /><span>Statements − ERP (reconcile)</span><b>{money(pos.statements.difference)}</b></div>
        )}
      </div>
      {onSettings && <Button size="sm" icon={Settings2} onClick={onSettings}>Assumptions</Button>}
    </div>
  );
}

export const STUDY_SEASON = [115, 95, 90, 100, 110, 125, 130, 115, 85, 90, 105, 120];

/** Every assumption used by the forecast, runway, buffer and the cash models. */
export function AssumptionsModal({ open, onClose, onSaved }) {
  const toast = useToast();
  const { can } = useAuth();
  const edit = can('cashflow', 'edit');
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setErr('');
    api.get('/cashflow/settings').then(r => {
      setD(r);
      const s = r.settings;
      setF({ ...Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v === null || v === undefined ? '' : Array.isArray(v) ? v.map(String) : String(v)])), has_opening: s.opening_balance !== null && s.opening_balance !== undefined });
    }).catch(e => setErr(e.message));
  }, [open]);
  if (!open) return null;
  const set = k => x => setF(s => ({ ...s, [k]: x?.target ? x.target.value : x }));
  const season = (i, val) => setF(s => ({ ...s, seasonality: s.seasonality.map((x, j) => (j === i ? val.replace(/[^\d]/g, '').slice(0, 3) : x)) }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const body = { ...f, seasonality: JSON.stringify(f.seasonality.map(Number)), opening_balance: f.has_opening ? f.opening_balance : '', opening_date: f.has_opening ? f.opening_date || todayStr() : '' };
      delete body.has_opening;
      await api.put('/cashflow/settings', body);
      toast.success('Assumptions saved — forecasts updated.');
      onSaved?.(); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const num = (k, label, hint, suffix) => <Field label={label} hint={hint}><div className="input-suffix"><Input inputMode="decimal" value={f[k]} disabled={!edit} onChange={e => set(k)(e.target.value.replace(/[^\d.-]/g, ''))} />{suffix && <span>{suffix}</span>}</div></Field>;
  return (
    <Modal open onClose={onClose} size="lg" title="Cash flow assumptions" subtitle="Used by Cash Runway, Forecast, Timing, Surplus & Deficit and the cash models"
      footer={<><Button onClick={onClose}>Close</Button>{edit && <Button variant="primary" loading={busy} onClick={save}>Save assumptions</Button>}</>}>
      {!f ? (err ? <Notice type="error">{err}</Notice> : <Loader />) : (
        <div className="form">
          {err && <Notice type="error">{err}</Notice>}
          {!edit && <Notice type="info">You can view these. Changing them needs “Cash Flow Manager: edit”.</Notice>}
          <div className="form-section"><span>1</span>Starting cash</div>
          <label className="check option-card"><input type="checkbox" checked={f.has_opening} disabled={!edit} onChange={e => setF(s => ({ ...s, has_opening: e.target.checked, opening_date: s.opening_date || todayStr() }))} />
            <span><b>I know my opening cash balance</b><br /><small className="muted">Total money in all bank accounts + office cash at the START of a date. Everything recorded after that date moves it up or down. (Or add accounts in Treasury &amp; Banking and press “Use statements as opening cash”.)</small></span></label>
          {f.has_opening && <div className="form-grid">
            <Field label="Opening cash (PKR)" required><MoneyInput value={f.opening_balance} onChange={set('opening_balance')} disabled={!edit} /></Field>
            <Field label="On (start of this date)" required><Input type="date" max={todayStr()} value={f.opening_date} onChange={set('opening_date')} disabled={!edit} /></Field>
          </div>}
          <div className="form-section"><span>2</span>Safety buffer &amp; burn</div>
          <div className="form-grid">
            <Field label="Minimum cash buffer (PKR)" hint="0 = automatic: months below × average monthly cash out"><MoneyInput value={f.min_cash_buffer} onChange={set('min_cash_buffer')} disabled={!edit} /></Field>
            {num('buffer_months', 'Automatic buffer (months of cash out)', 'e.g. 1 = keep one month of spending', 'months')}
            {num('burn_months', 'Average burn over the last', '1–12 complete months', 'months')}
            {num('forecast_months', 'Forecast length', '3–18 months', 'months')}
          </div>
          <div className="form-section"><span>3</span>Money coming in (study-abroad fees)</div>
          <div className="form-grid">
            {num('collection_rate', 'Installments paid on time', 'Share of scheduled student installments you expect on the due date', '%')}
            {num('overdue_collection', 'Overdue fees you expect back now', 'Of installments already late', '%')}
            {num('growth_pct', 'New-sales growth per month', 'Use a minus number for a slow-down', '%')}
            {num('tax_rate', 'Advance / withholding tax on collections', '0 if tax is added as a planned payment', '%')}
          </div>
          <Field label="Seasonality — new sales by month (100 = normal)" hint="Study-abroad fees peak before the September and January intakes. Edit the numbers or use a preset.">
            <div className="season-grid">{MONTHS_SHORT.map((m, i) => <label key={m}><span>{m}</span><Input inputMode="numeric" value={f.seasonality[i]} disabled={!edit} onChange={e => season(i, e.target.value)} /></label>)}</div>
            {edit && <div className="row" style={{ marginTop: 8 }}>
              <Button size="sm" onClick={() => setF(s => ({ ...s, seasonality: Array(12).fill('100') }))}>Flat (all 100)</Button>
              <Button size="sm" onClick={() => setF(s => ({ ...s, seasonality: (d?.studyAbroadSeason || STUDY_SEASON).map(String) }))}>Study-abroad intake pattern</Button>
              <Button size="sm" disabled={!d?.learnedSeason} title={d?.learnedSeason ? 'From your last 24 months of collections' : 'Needs 12+ months of collections'} onClick={() => setF(s => ({ ...s, seasonality: d.learnedSeason.map(String) }))}>Learn from my history</Button>
            </div>}
          </Field>
          <div className="form-section"><span>4</span>Payments &amp; models</div>
          <div className="form-grid">
            {num('salary_day', 'Salaries are paid on day', '1–28 of each month')}
            {num('transaction_cost', 'Cost of one transfer / investment sale (PKR)', 'Bank charges + staff time — Baumol & Miller–Orr “F”', 'PKR')}
            {num('interest_rate', 'Interest you could earn / pay (yearly)', 'T-bill / deposit / overdraft rate — the models’ “i”', '%')}
            {num('dso_target', 'Target: students pay within', 'Receivable days (DSO) target', 'days')}
            {num('dpo_target', 'Target: we pay vendors within', 'Payable days (DPO) target', 'days')}
            {num('dio_target', 'Target: stock lasts at most', 'Inventory days (DIO) target', 'days')}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Small "how it works" note with a link. */
export const HowTo = ({ children, to, label = 'Learn more' }) => (
  <div className="hint row" style={{ gap: 6, alignItems: 'flex-start' }}><Info size={14} style={{ flexShrink: 0, marginTop: 2 }} /><span>{children}{to && <> <Link to={to}>{label} →</Link></>}</span></div>
);

/** Segmented scenario switch. */
export const ScenarioSwitch = ({ value, onChange }) => (
  <Segmented value={value} onChange={onChange} options={[{ value: 'worst', label: 'Worst case' }, { value: 'base', label: 'Expected' }, { value: 'best', label: 'Best case' }]} />
);
