// Budget allotment: cash given to employees (their own limited "petty cash" for variable expenses) + petty cash top-ups.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownToLine, Check, CircleSlash, Clock, HandCoins, KeyRound, Lock, Plus, PlusCircle, RotateCcw, Search, ShieldCheck, Undo2, Users, Wallet, X, XCircle } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useDebounced, useServerList, useTableQuery } from '../../lib/useServerList.js';
import { Avatar, Badge, Button, Card, DataTable, ExportButtons, Field, Input, Kpi, Loader, Modal, MoneyInput, Notice, Segmented, Select, Textarea, useConfirm, useToast } from '../../components/ui.jsx';
import ServerTable, { CardTabs } from '../../components/ServerTable.jsx';
import { money as fmtMoney, date, dateTime, todayStr } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);
import { RowReview } from '../expenses/Variable.jsx';
import { StatusBadge, useExpenseMeta } from '../expenses/shared.jsx';

export default function Budgets() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [v, setV] = useState(0);
  const [state, setState] = useState('active');
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const [allot, setAllot] = useState(() => (sp.get('allot') ? { target: sp.get('allot') === 'petty' ? 'petty' : 'employee', user_id: sp.get('user') || '' } : null));
  const [open, setOpen] = useState(null);
  const { data: d, error } = useLoad(`/cashflow/budgets?state=${state}&q=${encodeURIComponent(search)}`, [v]);
  const bump = () => setV(x => x + 1);
  useEffect(() => { if (sp.get('allot')) setSp(p => { const x = new URLSearchParams(p); x.delete('allot'); x.delete('user'); return x; }, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const t = d.totals;
  const edit = can('cashflow', 'edit');
  return (
    <div className="stack">
      <div className="cf-toolbar">
        <span className="balance-pill ok"><Users size={15} />{t.active} active budget(s)</span>
        <span className={`balance-pill ${d.petty.balance > 0 ? 'ok' : 'bad'}`}><Wallet size={15} />Petty cash {money(d.petty.balance)}</span>
        <div className="spacer" />
        {edit && <Button icon={ArrowDownToLine} onClick={() => setAllot({ target: 'petty' })}>Petty cash top-up</Button>}
        {edit && <Button variant="primary" icon={Plus} onClick={() => setAllot({ target: 'employee' })}>Allot budget to employee</Button>}
      </div>
      {!edit && <Notice type="info">You can view budgets. Allotting money needs “Cash Flow Manager: edit”; approving needs “Expense Approvals”.</Notice>}
      <div className="grid grid-kpi">
        <Kpi icon={HandCoins} color="blue" label="Given to staff (net)" value={money(t.allotted - t.returned)} sub={`Allotted ${money(t.allotted)} · returned ${money(t.returned)}`} />
        <Kpi icon={CircleSlash} color="orange" label="Spent from budgets" value={money(t.spent)} sub={`${money(t.spent_pending)} waiting approval`} />
        <Kpi icon={Wallet} color={t.balance > 0 ? 'green' : 'blue'} label="Unspent with staff" value={money(t.balance)} sub="Cash still in employees’ hands" />
        <Kpi icon={Wallet} color="cyan" label="Petty cash balance" value={money(d.petty.balance)} sub={d.petty.pendingTopups ? `${d.petty.pendingTopups} top-up(s) waiting · ${money(d.petty.pendingTopupAmount)}` : `Top-ups ${money(d.petty.topups)}`} />
        <Kpi icon={Clock} color="purple" label="Waiting approval" value={d.pending.budget + d.pending.petty} sub={`${d.pending.budget} allotment(s) · ${d.pending.petty} top-up(s)`} />
      </div>

      <Card title="Budget (cash assign) vs full Expenses access" subtitle="Two very different things — choose the right one">
        <div className="compare">
          <div className="cmp limited">
            <div className="cmp-h"><Wallet /><b>Budget allotment (this page)</b><Badge tone="orange">Limited</Badge></div>
            <ul>
              <li><Check />Employee gets a fixed amount and a <b>“My Budget”</b> page</li>
              <li><Check />Can add <b>variable expenses</b> only, up to the balance (and your per-expense limit / categories)</li>
              <li><Check />Sees <b>only his / her own</b> entries — never other employees’</li>
              <li><X />Cannot see the Expenses module, approvals or reports</li>
              <li><Clock />Ends when you <b>close</b> the budget or on the “valid until” date</li>
            </ul>
          </div>
          <div className="cmp full">
            <div className="cmp-h"><KeyRound /><b>Expenses access (Admin Settings)</b><Badge tone="purple">Full</Badge></div>
            <ul>
              <li><Check />Given by admin in <b>Users &amp; Roles → Page access</b></li>
              <li><Check />Sees <b>all employees’</b> expenses, constant + variable, analytics</li>
              <li><Check /><b>Edit</b> level: add entries and correct anyone’s not-approved entries</li>
              <li><Check />No money limit — spending is controlled by approvals</li>
              <li><Lock />Stays until admin takes the access back</li>
            </ul>
            <Link className="btn btn-sm" to="/settings/admin/users">Open employees</Link>
          </div>
        </div>
      </Card>

      <Card title="Employee budgets" pad={false} actions={<><Segmented value={state} onChange={setState} options={[{ value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }, { value: '', label: 'All' }]} /></>}>
        <div className="card-toolbar"><div className="search"><Search /><input className="input" placeholder="Search employee, Emp ID, purpose…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search budgets" /></div></div>
        <div className="card-body">
          {d.wallets.length ? <div className="wallet-grid">{d.wallets.map(w => (
            <button type="button" key={w.user_id} className={`wallet-card ${w.state}`} onClick={() => setOpen(w.user_id)}>
              <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><Avatar fileId={w.photo_file_id} name={w.full_name} size={40} /><div className="cell-2" style={{ textAlign: 'start' }}><b data-no-translate>{w.full_name}</b><small>{w.employee_code} · {w.designation || 'Employee'}</small></div>
                <Badge tone={w.state === 'closed' ? 'grey' : w.active ? 'green' : 'orange'}>{w.state === 'closed' ? 'Closed' : w.active ? 'Active' : 'Expired'}</Badge></div>
              {w.purpose && <div className="small muted wallet-purpose">{w.purpose}</div>}
              <div className="wallet-bal"><span>Balance</span><b className={w.balance <= 0 ? 'text-red' : ''}>{money(w.balance)}</b></div>
              <div className="split-bar" title={`${w.used_pct}% used`}><span style={{ width: `${w.used_pct}%`, background: 'var(--orange)' }} /><span style={{ width: `${100 - w.used_pct}%`, background: 'var(--green)' }} /></div>
              <div className="row small muted" style={{ justifyContent: 'space-between' }}><span>Spent {money(w.spent)} of {money(w.allotted - w.returned)}</span>{w.pending_count > 0 && <Badge tone="orange">{w.pending_count} to approve</Badge>}</div>
              {(w.valid_until || Number(w.max_entry) > 0) && <div className="small muted">{w.valid_until ? `Valid until ${date(w.valid_until)}` : ''}{w.valid_until && Number(w.max_entry) > 0 ? ' · ' : ''}{Number(w.max_entry) > 0 ? `Max ${money(w.max_entry)} per expense` : ''}</div>}
            </button>))}</div>
            : <div className="empty-state"><Wallet /><div>{state === 'active' ? 'No active budgets.' : 'No budgets.'} {edit && <button type="button" className="link-btn" onClick={() => setAllot({ target: 'employee' })}>Allot the first one</button>}</div></div>}
        </div>
      </Card>

      <Entries v={v} onChanged={bump} />
      {allot && <AllotForm preset={allot} onClose={() => setAllot(null)} onSaved={() => { setAllot(null); bump(); }} />}
      {open && <WalletDrawer userId={open} onClose={() => setOpen(null)} onChanged={bump} onAddMore={uid => { setOpen(null); setAllot({ target: 'employee', user_id: String(uid) }); }} />}
    </div>
  );
}

function Entries({ v, onChanged }) {
  const { user, isAdmin, can } = useAuth();
  const [q, setQ] = useTableQuery({ kind: '', status: '', q: '', sort: 'date', dir: 'desc' });
  const search = useDebounced(q.q);
  const list = useServerList('/cashflow/budgets/entries', { kind: q.kind, status: q.status, q: search, page: q.page, limit: q.limit, sort: q.sort, dir: q.dir }, [v]);
  const all = useServerList('/cashflow/budgets/entries', { kind: q.kind, q: search, limit: 1 }, [v]);
  const t = all.data?.totals;
  const approver = can('expense_approve', 'edit');
  const refresh = () => { list.reload(); all.reload(); onChanged(); };
  return (
    <Card title="Allotments, returns & petty top-ups" subtitle="Every amount given out or taken back" pad={false} actions={<ExportButtons dataset="budget-entries" />}>
      <div className="card-toolbar">
        <Segmented value={q.kind} onChange={x => setQ({ kind: x })} options={[{ value: '', label: 'All' }, { value: 'allot', label: 'Employee allotments' }, { value: 'return', label: 'Returns' }, { value: 'petty', label: 'Petty top-ups' }]} />
        <div className="search"><Search /><input className="input" placeholder="Search ref #, person, reference…" value={q.q} onChange={e => setQ({ q: e.target.value })} aria-label="Search entries" /></div>
      </div>
      <CardTabs value={q.status} onChange={x => setQ({ status: x })} tabs={[{ value: '', label: 'All', count: t?.count }, { value: 'pending', label: 'Not approved', count: t?.pending_count, icon: Clock }, { value: 'approved', label: 'Approved', count: t?.approved_count, icon: Check }, { value: 'rejected', label: 'Rejected', count: t?.rejected_count, icon: XCircle }]} />
      <ServerTable data={list.data} loading={list.loading} query={q} onQuery={setQ} empty="Nothing here yet." columns={[
        { key: 'entry_date', label: 'Date', sort: 'date', render: r => date(r.entry_date) },
        { key: 'ref_no', label: 'Ref #', sort: 'ref', render: r => <span className="mono">{r.ref_no}</span> },
        { key: 'kind', label: 'Type', render: r => (r.source === 'petty' ? <Badge tone="cyan">Petty top-up</Badge> : r.kind === 'return' ? <Badge tone="purple">Returned</Badge> : <Badge tone="blue">Budget allotted</Badge>) },
        { key: 'holder', label: 'Given to', sort: 'holder', render: r => <div className="cell-2"><b data-no-translate>{r.holder}</b><small>{r.employee_code || (r.source === 'petty' ? 'Petty cash holder' : '')}</small></div> },
        { key: 'payment_method', label: 'Method', render: r => <div className="cell-2"><span>{r.payment_method}</span><small>{r.reference_no}</small></div> },
        { key: 'entered_by', label: 'Entered by', className: 'hide-md' },
        { key: 'status', label: 'Status', sort: 'status', render: r => <StatusBadge status={r.status} /> },
        { key: 'amount', label: 'Amount', sort: 'amount', money: true },
        ...(approver ? [{ key: 'act', label: '', render: r => (r.status === 'pending' && (isAdmin || r.created_by !== user.id)
          ? <RowReview row={r} endpoint={r.source === 'petty' ? `/cashflow/budgets/topups/${r.id}/review` : `/cashflow/budgets/entries/${r.id}/review`} onDone={refresh} /> : null) }] : [])]}
        footer={dd => <tr><td colSpan={7}>Given (approved) {money(dd.totals.given)} · returned {money(dd.totals.returned)} · waiting {money(dd.totals.pending)}</td><td className="num">{money(dd.rows.reduce((a, r) => a + r.amount, 0))}</td>{approver && <td />}</tr>} />
    </Card>
  );
}

/** Cash to an employee budget, or a petty cash top-up. */
function AllotForm({ preset, onClose, onSaved }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { meta } = useExpenseMeta();
  const [people, setPeople] = useState([]);
  const [cur, setCur] = useState(null);
  const [f, setF] = useState({ target: preset.target || 'employee', user_id: preset.user_id || '', amount: '', entry_date: todayStr(), payment_method: 'Cash', reference_no: '', title: '', purpose: '', valid_until: '', max_entry: '', category_ids: [], note: '', paid_to: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/users/directory').then(setPeople).catch(() => {}); }, []);
  useEffect(() => {
    if (f.target !== 'employee' || !f.user_id) { setCur(null); return; }
    let alive = true;
    api.get(`/cashflow/budgets/${f.user_id}`).then(x => { if (!alive) return; setCur(x); const w = x.wallet; setF(s => ({ ...s, purpose: s.purpose || w.purpose || '', valid_until: w.valid_until || '', max_entry: Number(w.max_entry) ? String(w.max_entry) : '', category_ids: (w.category_ids || []).map(Number) })); })
      .catch(() => alive && setCur(false));
    return () => { alive = false; };
  }, [f.target, f.user_id]);
  const set = k => x => setF(s => ({ ...s, [k]: x?.target ? x.target.value : x }));
  const cats = meta?.categories?.variable || [];
  const toggleCat = id => setF(s => ({ ...s, category_ids: s.category_ids.includes(id) ? s.category_ids.filter(x => x !== id) : [...s.category_ids, id] }));
  const save = async () => {
    setErr('');
    if (!(Number(f.amount) > 0)) return setErr('Enter an amount greater than 0.');
    if (f.target === 'employee' && !f.user_id) return setErr('Choose the employee.');
    if (f.target === 'petty' && !f.paid_to.trim()) return setErr('Who received the petty cash?');
    setBusy(true);
    try {
      const r = await api.post('/cashflow/budgets/allot', { ...f, category_ids: JSON.stringify(f.category_ids) });
      toast.success(r.status === 'approved' ? (f.target === 'petty' ? `Top-up added — petty balance ${money(r.balance)}.` : `Budget allotted — balance ${money(r.balance)}. The employee can now use “My Budget”.`) : 'Saved — waiting for an approver.');
      onSaved();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const person = people.find(p => String(p.id) === String(f.user_id));
  return (
    <Modal open onClose={onClose} size="lg" title={f.target === 'petty' ? 'Petty cash top-up' : 'Allot budget to an employee'} subtitle={f.target === 'petty' ? 'Cash handed to the petty cash holder (moved here from Petty Cash → Top-ups)' : 'The employee gets limited access: own variable expenses, up to this balance'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{f.target === 'petty' ? 'Save top-up' : 'Allot budget'}</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <Segmented value={f.target} onChange={set('target')} options={[{ value: 'employee', label: 'Employee budget' }, { value: 'petty', label: 'Petty cash top-up' }]} />
        <div className="form-grid">
          {f.target === 'employee'
            ? <Field label="Employee" required full><Select value={String(f.user_id)} onChange={set('user_id')} searchable placeholder="Search employee by name or Emp ID" options={people.map(p => ({ value: String(p.id), label: p.full_name, hint: `${p.employee_code}${p.designation ? ' · ' + p.designation : ''}` }))} ariaLabel="Employee" /></Field>
            : <Field label="Given to (petty cash holder)" required full><Input list="pc-people" value={f.paid_to} onChange={set('paid_to')} maxLength={160} /><datalist id="pc-people">{people.map(p => <option key={p.id} value={p.full_name} />)}</datalist></Field>}
          {f.target === 'employee' && f.user_id && cur && <div className="full"><Notice type={cur.wallet.state === 'closed' ? 'warn' : 'info'}>{person?.full_name} already has a budget — balance <b>{money(cur.wallet.balance)}</b>{cur.wallet.state === 'closed' ? ' (closed — this allotment re-opens it)' : ''}. This amount is added on top.{cur.expensesAccess && <> They also have full Expenses access ({cur.expensesAccess}).</>}</Notice></div>}
          <Field label="Amount (PKR)" required><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
          <Field label="Date" required><Input type="date" max={todayStr()} value={f.entry_date} onChange={set('entry_date')} /></Field>
          <Field label="Given by (method)"><Select value={f.payment_method} onChange={set('payment_method')} options={meta?.methods || ['Cash', 'Bank Transfer']} ariaLabel="Method" /></Field>
          <Field label="Reference no."><Input value={f.reference_no} onChange={set('reference_no')} maxLength={80} placeholder="Cheque / transfer / voucher no." /></Field>
          {f.target === 'employee' ? <>
            <Field label="Purpose" full hint="Shown to the employee, e.g. “Lahore expo stall + courier for November files”"><Input value={f.purpose} onChange={set('purpose')} maxLength={200} /></Field>
            <Field label="Valid until (optional)" hint="After this date the employee cannot add new expenses"><Input type="date" min={todayStr()} value={f.valid_until} onChange={set('valid_until')} /></Field>
            <Field label="Maximum per expense (optional)" hint="0 / empty = no limit"><MoneyInput value={f.max_entry} onChange={set('max_entry')} /></Field>
            <Field label="Allowed categories" full hint="None ticked = every variable category">
              <div className="cat-checks">{cats.map(c => <label key={c.id} className={`chip ${f.category_ids.includes(Number(c.id)) ? 'on' : ''}`}><input type="checkbox" checked={f.category_ids.includes(Number(c.id))} onChange={() => toggleCat(Number(c.id))} />{c.name}</label>)}</div>
            </Field>
          </> : <Field label="Title"><Input value={f.title} onChange={set('title')} maxLength={160} placeholder="e.g. November float" /></Field>}
          <Field label="Note" full><Textarea rows={2} value={f.note} onChange={set('note')} maxLength={1000} /></Field>
        </div>
        {!isAdmin && <Notice type="info">An approver must approve this before the money counts.</Notice>}
      </div>
    </Modal>
  );
}

function WalletDrawer({ userId, onClose, onChanged, onAddMore }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { meta } = useExpenseMeta();
  const { data: d, error, reload } = useLoad(`/cashflow/budgets/${userId}`);
  const [ret, setRet] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState('');
  const [s, setS] = useState(null);
  useEffect(() => { if (d) setS({ purpose: d.wallet.purpose || '', valid_until: d.wallet.valid_until || '', max_entry: Number(d.wallet.max_entry) ? String(d.wallet.max_entry) : '', category_ids: (d.wallet.category_ids || []).map(Number) }); }, [d]);
  const cats = meta?.categories?.variable || [];
  const approver = can('expense_approve', 'edit');
  const edit = can('cashflow', 'edit');
  const ledger = useMemo(() => d?.ledger || [], [d]);
  if (error) return <Modal open drawer onClose={onClose} title="Budget"><Notice type="error">{error.message}</Notice></Modal>;
  if (!d || !s) return <Modal open drawer onClose={onClose} title="Budget"><Loader /></Modal>;
  const w = d.wallet;
  const changed = () => { reload(); onChanged(); };
  const saveSettings = async () => {
    setBusy('s');
    try { await api.put(`/cashflow/budgets/${userId}`, { ...s, category_ids: JSON.stringify(s.category_ids), version: w.version }); toast.success('Budget rules saved.'); changed(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const reopen = async () => {
    if (!(await confirm({ title: `Re-open ${w.full_name}'s budget?`, message: 'They can add expenses again (up to any balance left).', ok: 'Re-open' }))) return;
    try { await api.post(`/cashflow/budgets/${userId}/reopen`); toast.success('Re-opened.'); changed(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open drawer onClose={onClose} title={`${w.full_name} · budget`} subtitle={`${w.employee_code} · ${w.designation || 'Employee'}`}>
      <div className="stack">
        <div className="profile-head"><Avatar fileId={w.photo_file_id} name={w.full_name} size={64} />
          <div style={{ flex: 1 }}><div className="detail-amount"><span>{money(w.balance)}</span><Badge tone={w.state === 'closed' ? 'grey' : w.active ? 'green' : 'orange'}>{w.state === 'closed' ? 'Closed' : w.active ? 'Active' : 'Expired'}</Badge></div>
            <div className="small muted">Allotted {money(w.allotted)} · returned {money(w.returned)} · spent {money(w.spent)}{w.pending_allot > 0 ? ` · ${money(w.pending_allot)} waiting approval` : ''}</div>
            {w.state === 'closed' && <div className="small muted">Closed {dateTime(w.closed_at)}{w.close_note ? ` — ${w.close_note}` : ''}</div>}</div></div>
        <div className="row">
          {edit && <Button variant="primary" icon={PlusCircle} onClick={() => onAddMore(userId)}>Add more cash</Button>}
          {approver && w.balance > 0 && <Button icon={Undo2} onClick={() => setRet(true)}>Cash returned</Button>}
          {approver && w.state === 'active' && <Button variant="danger" icon={Lock} onClick={() => setClosing(true)}>Close budget (take access back)</Button>}
          {edit && w.state === 'closed' && <Button icon={RotateCcw} onClick={reopen}>Re-open</Button>}
        </div>
        {d.expensesAccess && <Notice type="info">This employee also has full Expenses access ({d.expensesAccess}) from Admin Settings — closing the budget does not remove that.</Notice>}
        <Card title="Rules for this budget">
          <div className="form">
            <div className="form-grid">
              <Field label="Purpose" full><Input value={s.purpose} disabled={!edit} onChange={e => setS(x => ({ ...x, purpose: e.target.value }))} maxLength={200} /></Field>
              <Field label="Valid until"><Input type="date" value={s.valid_until} disabled={!edit} onChange={e => setS(x => ({ ...x, valid_until: e.target.value }))} /></Field>
              <Field label="Max per expense"><MoneyInput value={s.max_entry} disabled={!edit} onChange={x => setS(y => ({ ...y, max_entry: x }))} /></Field>
              <Field label="Allowed categories" full hint="None ticked = all variable categories"><div className="cat-checks">{cats.map(c => <label key={c.id} className={`chip ${s.category_ids.includes(Number(c.id)) ? 'on' : ''}`}><input type="checkbox" disabled={!edit} checked={s.category_ids.includes(Number(c.id))} onChange={() => setS(x => ({ ...x, category_ids: x.category_ids.includes(Number(c.id)) ? x.category_ids.filter(y => y !== Number(c.id)) : [...x.category_ids, Number(c.id)] }))} />{c.name}</label>)}</div></Field>
            </div>
            {edit && <div><Button loading={busy === 's'} icon={ShieldCheck} onClick={saveSettings}>Save rules</Button></div>}
          </div>
        </Card>
        <Card title="Budget book" subtitle="Money in, expenses out, running balance (newest first)" pad={false}>
          <DataTable rows={ledger} search={false} pageSize={12} empty="No movements yet." columns={[
            { key: 'd', label: 'Date', render: r => date(r.d) }, { key: 'ref_no', label: 'Ref #', render: r => <span className="mono">{r.ref_no}</span> },
            { key: 'title', label: 'Details', wrap: true, render: r => <div className="cell-2"><b>{r.title}</b><small>{r.kind === 'expense' ? (r.status === 'pending' ? 'Expense · not approved yet' : 'Expense · approved') : r.kind === 'allot' ? 'Allotted' : 'Returned'}</small></div> },
            { key: 'credit', label: 'In (+)', align: 'right', render: r => (r.credit ? <span className="text-green">{money(r.credit)}</span> : '—') },
            { key: 'debit', label: 'Out (−)', align: 'right', render: r => (r.debit ? <span className="text-orange">{money(r.debit)}</span> : '—') },
            { key: 'balance', label: 'Balance', align: 'right', render: r => <b>{money(r.balance)}</b> }]} />
        </Card>
        <Card title="Expenses from this budget" pad={false} subtitle="Approve or reject them in Expenses → Approvals or Payment control">
          <DataTable rows={d.expenses} pageSize={10} empty="No expenses yet." columns={[
            { key: 'expense_date', label: 'Date', render: r => date(r.expense_date) }, { key: 'item', label: 'Expense', render: r => <div className="cell-2"><b>{r.sub_category || r.category}</b><small>{r.paid_to}</small></div> },
            { key: 'receipt', label: 'Receipt', render: r => (r.receipt_file_id ? <a href={`/api/files/${r.receipt_file_id}`} target="_blank" rel="noreferrer">View</a> : <span className="muted" title={r.no_receipt_reason}>None</span>) },
            { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} /> }, { key: 'amount', label: 'Amount', money: true }]} />
        </Card>
      </div>
      {ret && <ReturnModal w={w} onClose={() => setRet(false)} onDone={() => { setRet(false); changed(); }} />}
      {closing && <CloseModal w={w} onClose={() => setClosing(false)} onDone={() => { setClosing(false); changed(); }} />}
    </Modal>
  );
}

function ReturnModal({ w, onClose, onDone }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(w.balance));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await api.post(`/cashflow/budgets/${w.user_id}/return`, { amount, note }); toast.success(`Recorded — balance now ${money(r.balance)}.`); onDone(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Unspent cash returned" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Record return</Button></>}>
      <div className="form">
        <Field label={`Amount returned (max ${money(w.balance)})`} required><MoneyInput value={amount} onChange={setAmount} /></Field>
        <Field label="Note"><Input value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="e.g. Returned to office cash" /></Field>
      </div>
    </Modal>
  );
}

function CloseModal({ w, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [back, setBack] = useState(true);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const r = await api.post(`/cashflow/budgets/${w.user_id}/close`, { note, return_balance: back }); toast.success(`Budget closed${r.returned ? ` — ${money(r.returned.amount)} recorded as returned` : ''}.`); onDone(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Close ${w.full_name}'s budget?`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} onClick={go}>Close budget</Button></>}>
      <div className="form">
        <p className="small" style={{ margin: 0 }}>“My Budget” becomes read-only for them immediately. Pending allotments are cancelled; expenses already entered stay for approval.</p>
        <Field label="Reason"><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="e.g. Expo finished" /></Field>
        {w.balance > 0 && <label className="check"><input type="checkbox" checked={back} onChange={e => setBack(e.target.checked)} /><span>Record the unspent {money(w.balance)} as returned to the company</span></label>}
      </div>
    </Modal>
  );
}
