import { useState } from 'react';
import { Anchor, Banknote, Building, CreditCard, Globe2, Landmark, Pencil, PiggyBank, Plus, Scale, Smartphone, Trash2, Wallet } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { Badge, Button, Card, DataTable, Field, Input, Kpi, Loader, Modal, MoneyInput, Notice, Select, Textarea, useConfirm, useToast } from '../../components/ui.jsx';
import { money as fmtMoney, date, todayStr } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);
import { BASIS_TEXT, HowTo } from './shared.jsx';

export const KINDS = [
  { value: 'bank', label: 'Bank current / savings account', icon: Building, tone: 'blue' },
  { value: 'cash', label: 'Cash in office / safe', icon: Banknote, tone: 'green' },
  { value: 'wallet', label: 'Mobile wallet (JazzCash, EasyPaisa…)', icon: Smartphone, tone: 'cyan' },
  { value: 'deposit', label: 'Term deposit / T-bills / money market', icon: PiggyBank, tone: 'purple' },
  { value: 'overdraft', label: 'Overdraft facility', icon: CreditCard, tone: 'orange' },
  { value: 'running_finance', label: 'Running finance (RF) line', icon: Landmark, tone: 'orange' },
  { value: 'loan_facility', label: 'Other loan facility', icon: Landmark, tone: 'red' },
];
const CREDIT = ['overdraft', 'running_finance', 'loan_facility'];
const kindOf = k => KINDS.find(x => x.value === k) || KINDS[0];

export default function Treasury() {
  const { can, isAdmin } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [v, setV] = useState(0);
  const [form, setForm] = useState(null);
  const { data: d, error } = useLoad('/cashflow/treasury', [v]);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const edit = can('cashflow', 'edit');
  const t = d.totals, pos = d.position;
  const anchor = async () => {
    if (!(await confirm({ title: 'Use bank & cash statements as opening cash?', message: `Opening cash becomes ${money(pos.statements.total)} from the day after the latest statement date. Cash flow, runway and forecasts then start from your real bank balances.`, ok: 'Use statements' }))) return;
    try { await api.post('/cashflow/treasury/anchor'); toast.success('Opening cash updated from statements.'); setV(x => x + 1); } catch (e) { toast.error(e.message); }
  };
  const del = async r => {
    if (!(await confirm({ title: `Delete ${r.name}?`, message: 'Only the account record is removed — no cash entries are touched. Switch it off instead to keep history.', danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/cashflow/treasury/${r.id}`); toast.success('Deleted.'); setV(x => x + 1); } catch (e) { toast.error(e.message); }
  };
  const liquid = d.rows.filter(r => !CREDIT.includes(r.kind));
  const credit = d.rows.filter(r => CREDIT.includes(r.kind));
  const cols = [
    { key: 'name', label: 'Account', render: r => { const k = kindOf(r.kind); return <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><span className={`acct-ic b-${k.tone}`}><k.icon size={15} /></span><div className="cell-2"><b>{r.name}</b><small>{[r.institution, r.account_ref && `•••${r.account_ref}`].filter(Boolean).join(' · ') || k.label}</small></div></div>; } },
    { key: 'currency', label: 'Currency', render: r => (r.currency === 'PKR' ? 'PKR' : <span>{r.currency} <small className="muted">@ {r.fx_rate}</small></span>) },
    { key: 'as_of', label: 'Balance date', render: r => <span className={r.stale_days > 7 ? 'text-orange' : ''} title={r.stale_days > 7 ? 'Update this balance' : undefined}>{date(r.as_of)}{r.stale_days > 7 ? ` · ${r.stale_days}d old` : ''}</span> },
    { key: 'active', label: '', render: r => (r.active ? null : <Badge tone="grey">Switched off</Badge>) },
  ];
  const actions = { key: 'x', label: '', sortable: false, render: r => edit && <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><Button size="sm" variant="ghost" icon={Pencil} aria-label="Edit" onClick={() => setForm(r)} />{isAdmin && <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => del(r)} />}</span> };
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi icon={Building} color="blue" label="Bank accounts" value={money(t.bank)} />
        <Kpi icon={Banknote} color="green" label="Cash in office" value={money(t.cash)} />
        <Kpi icon={Smartphone} color="cyan" label="Mobile wallets" value={money(t.wallet)} />
        <Kpi icon={PiggyBank} color="purple" label="Deposits & T-bills" value={money(t.deposits)} sub={`≈ ${money(t.depositYield)} interest a year`} />
        <Kpi icon={Landmark} color="orange" label="Credit lines available" value={money(pos.credit.available)} sub={`Used ${money(pos.credit.used)} of ${money(pos.credit.limit)}`} />
      </div>
      <Card title={<span className="row" style={{ gap: 6 }}><Scale size={16} />Bank reconciliation</span>} subtitle="ERP cash position vs your bank / cash statements"
        actions={edit && pos.statements.count > 0 && <Button size="sm" icon={Anchor} onClick={anchor}>Use statements as opening cash</Button>}>
        <div className="grid grid-3">
          <div className="cf-fact"><Wallet /><div><span>ERP cash position</span><b>{money(pos.cash)}</b><small className="muted">{BASIS_TEXT[pos.basis]}</small></div></div>
          <div className="cf-fact"><Building /><div><span>Statements total ({pos.statements.count})</span><b>{pos.statements.count ? money(pos.statements.total) : '—'}</b><small className="muted">Bank + office cash + wallets + deposits</small></div></div>
          <div className="cf-fact"><Scale /><div><span>Difference</span><b className={pos.statements.difference && Math.abs(pos.statements.difference) > 1 ? 'text-orange' : ''}>{pos.statements.difference === null ? '—' : money(pos.statements.difference)}</b><small className="muted">Unrecorded fees, bank charges or cash with staff ({money(pos.withStaff.total)})</small></div></div>
        </div>
        <HowTo>Update each balance from the bank app / statement at least weekly. A difference means something was paid or received but not entered in the ERP — enter it, or re-anchor with “Use statements as opening cash”.</HowTo>
      </Card>
      <Card title="Bank, cash, wallet & deposit accounts" pad={false} actions={edit && <Button size="sm" variant="primary" icon={Plus} onClick={() => setForm({ kind: 'bank' })}>Add account</Button>}>
        <DataTable rows={liquid} search={false} empty="No accounts yet. Add your bank accounts, office cash and wallets to reconcile and to start forecasts from real balances." columns={[
          ...cols.slice(0, 1), { key: 'kind', label: 'Type', render: r => <Badge tone={kindOf(r.kind).tone}>{kindOf(r.kind).label.split(' (')[0]}</Badge> }, ...cols.slice(1),
          { key: 'interest_rate', label: 'Profit rate', render: r => (Number(r.interest_rate) ? `${r.interest_rate}%` : '—') },
          { key: 'balance', label: 'Balance', render: r => money(r.balance).replace('PKR', r.currency), align: 'right' }, { key: 'pkr_balance', label: 'In PKR', money: true }, actions]} />
      </Card>
      <Card title="Overdraft, running finance & loan lines" subtitle="Used to fund cash deficits — cheapest first" pad={false} actions={edit && <Button size="sm" icon={Plus} onClick={() => setForm({ kind: 'running_finance' })}>Add credit line</Button>}>
        <DataTable rows={credit} search={false} empty="No credit lines. Add an overdraft or running-finance limit so deficit months show how they will be funded." columns={[
          ...cols.slice(0, 1), { key: 'interest_rate', label: 'Rate', render: r => `${r.interest_rate}%` }, { key: 'maturity_date', label: 'Renewal', render: r => date(r.maturity_date) },
          { key: 'credit_limit', label: 'Limit', money: true }, { key: 'balance', label: 'Used', money: true }, { key: 'available', label: 'Available', money: true },
          { key: 'util', label: 'Used %', render: r => { const p = Number(r.credit_limit) ? Math.round((Math.max(0, Number(r.balance)) / Number(r.credit_limit)) * 100) : 0; return <Badge tone={p > 80 ? 'red' : p > 50 ? 'orange' : 'green'}>{p}%</Badge>; } }, actions]} />
      </Card>
      {t.fx.length > 0 && <Card title={<span className="row" style={{ gap: 6 }}><Globe2 size={16} />Foreign currency (university commissions, partner payouts)</span>}>
        {t.fx.map(x => <div key={x.currency} className="slip-row"><span>{x.currency} {Number(x.amount).toLocaleString()}</span><b>{money(x.pkr)}</b></div>)}
        <HowTo>Update the exchange rate when you update the balance. Convert to PKR before big local payments to avoid last-minute rates.</HowTo>
      </Card>}
      <Card title="Treasury good practice for a consultancy">
        <ul className="cf-tips">
          <li><Building /><span>Keep a <b>fee-collection account</b> separate from the <b>operations account</b>; move a fixed amount to operations each week (see Baumol).</span></li>
          <li><PiggyBank /><span>Money you hold for students’ university / embassy payments is not yours to spend — keep it in a deposit and add it as a planned payment.</span></li>
          <li><Landmark /><span>Renew running-finance limits before the peak (June–August) intake season; use them only for the gap days shown in Inflow vs Outflow.</span></li>
        </ul>
      </Card>
      {form && <AccountForm record={form.id ? form : null} preset={form.kind} onClose={() => setForm(null)} onSaved={() => { setForm(null); setV(x => x + 1); }} />}
    </div>
  );
}

function AccountForm({ record, preset, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({ name: record?.name || '', kind: record?.kind || preset || 'bank', institution: record?.institution || '', account_ref: record?.account_ref || '', currency: record?.currency || 'PKR', fx_rate: String(record?.fx_rate ?? 1),
    balance: record ? String(record.balance) : '', credit_limit: record ? String(record.credit_limit) : '', interest_rate: record ? String(record.interest_rate) : '', maturity_date: record?.maturity_date || '', as_of: todayStr(), notes: record?.notes || '', active: record ? record.active : true }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = k => x => setF(s => ({ ...s, [k]: x?.target ? (x.target.type === 'checkbox' ? x.target.checked : x.target.value) : x }));
  const credit = CREDIT.includes(f.kind);
  const save = async () => {
    setErr(''); setBusy(true);
    try { record ? await api.put(`/cashflow/treasury/${record.id}`, f) : await api.post('/cashflow/treasury', f); toast.success('Saved.'); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={record ? `Update ${record.name}` : 'Add account'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <div className="form-grid">
          <Field label="Type" required full><Select value={f.kind} onChange={set('kind')} options={KINDS.map(k => ({ value: k.value, label: k.label }))} ariaLabel="Type" /></Field>
          <Field label="Name" required><Input value={f.name} onChange={set('name')} maxLength={120} placeholder={credit ? 'e.g. HBL running finance' : 'e.g. Meezan current — fees'} /></Field>
          <Field label="Bank / institution"><Input value={f.institution} onChange={set('institution')} maxLength={120} /></Field>
          <Field label="Account (last 4 digits only)" hint="Never enter the full account number"><Input value={f.account_ref} onChange={e => set('account_ref')(e.target.value.replace(/[^\w-]/g, '').slice(-6))} maxLength={6} /></Field>
          <Field label="Currency"><Input value={f.currency} onChange={e => set('currency')(e.target.value.toUpperCase().slice(0, 3))} maxLength={3} /></Field>
          {f.currency !== 'PKR' && <Field label={`PKR per 1 ${f.currency}`}><MoneyInput value={f.fx_rate} onChange={set('fx_rate')} /></Field>}
          <Field label={credit ? 'Amount used now' : 'Balance'} required><MoneyInput value={f.balance} onChange={set('balance')} /></Field>
          <Field label="Balance date" required><Input type="date" max={todayStr()} value={f.as_of} onChange={set('as_of')} /></Field>
          {credit && <Field label="Sanctioned limit" required><MoneyInput value={f.credit_limit} onChange={set('credit_limit')} /></Field>}
          <Field label={credit ? 'Interest / markup rate (yearly %)' : 'Profit rate (yearly %)'}><Input inputMode="decimal" value={f.interest_rate} onChange={e => set('interest_rate')(e.target.value.replace(/[^\d.]/g, ''))} /></Field>
          {(credit || f.kind === 'deposit') && <Field label={credit ? 'Renewal / expiry date' : 'Maturity date'}><Input type="date" value={f.maturity_date || ''} onChange={set('maturity_date')} /></Field>}
          <Field label="Notes" full><Textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={1000} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /><span>Active (counted in totals)</span></label>
      </div>
    </Modal>
  );
}
