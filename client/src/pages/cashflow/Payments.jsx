// Payment control: approve / hold / release / reject constant (and variable) expenses — one by one, selected, or everything that matches the filters.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, Check, CheckCheck, Clock, Layers, ListFilter, PauseCircle, PlayCircle, Repeat, RotateCcw, Search, Wallet, X, XCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useDebounced, useServerList, useTableQuery } from '../../lib/useServerList.js';
import { Badge, Button, Card, DateRange, ExportButtons, Field, Input, Kpi, Modal, MonthPicker, MoneyInput, Notice, Segmented, Select, Textarea, useConfirm, useToast } from '../../components/ui.jsx';
import ServerTable, { CardTabs, FilterChips } from '../../components/ServerTable.jsx';
import { money as fmtMoney, date, monthName, thisMonth, monthStart, monthEnd, todayStr } from '../../lib/format.js';
const money = (n, o) => fmtMoney(Math.round(Number(n || 0)), o);
import { ExpenseDetail, StatusBadge, useExpenseMeta } from '../expenses/shared.jsx';
import { ReceiptCell, itemCell, twoLine } from '../expenses/Variable.jsx';

const FREQ = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' };
const VERB = { approve: 'Approve', hold: 'Put on hold', release: 'Release hold', pending: 'Back to not approved', reject: 'Reject' };

export default function Payments() {
  const { user, isAdmin, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { meta } = useExpenseMeta();
  const [sp] = useSearchParams();
  const [type, setType] = useState(['constant', 'variable', 'all'].includes(sp.get('type')) ? sp.get('type') : 'constant');
  const [mode, setMode] = useState('month');
  const [month, setMonth] = useState(thisMonth());
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const [q, setQ, resetQ] = useTableQuery({ status: sp.get('status') || '', category_id: '', method: '', budget: '', min: '', max: '', q: '', sort: 'date', dir: 'asc' });
  const [selected, setSelected] = useState(new Set());
  const [ask, setAsk] = useState(null); // { action, all }
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const search = useDebounced(q.q);
  const minD = useDebounced(q.min), maxD = useDebounced(q.max);
  const filters = { type, ...(mode === 'month' ? { month } : range), category_id: q.category_id, method: q.method, budget: q.budget, min: minD, max: maxD, q: search };
  const list = useServerList('/cashflow/control', { ...filters, status: q.status, page: q.page, limit: q.limit, sort: q.sort, dir: q.dir });
  const all = useServerList('/cashflow/control', { ...filters, limit: 1 });
  const reload = () => { list.reload(); all.reload(); };
  useEffect(() => { setSelected(new Set()); }, [type, mode, month, range.from, range.to, q.status, q.category_id, q.page, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const approver = can('expense_approve', 'edit');
  const t = all.data?.totals;
  const ft = list.data?.totals;
  const tree = type === 'all' ? [...(meta?.categories?.constant || []), ...(meta?.categories?.variable || [])] : meta?.categories?.[type] || [];
  const canSelect = r => approver && (isAdmin || r.created_by !== user.id);
  const statusNow = { ...filters, status: q.status };

  const run = async (action, { note, hold_until, everything, ids } = {}) => {
    setBusy(true);
    try {
      const body = everything ? { all: true, filters: statusNow, action, note, hold_until } : { ids: ids || [...selected], action, note, hold_until };
      const r = await api.post('/cashflow/control/bulk', body);
      if (r.updated) toast.success(`${r.updated} expense(s) · ${money(r.amount)} — ${VERB[action].toLowerCase()} done.`);
      if (r.skipped?.length) toast.warn(`${r.skipped.length} skipped: ${[...new Set(r.skipped.map(s => s.reason))].slice(0, 3).join('; ')}`);
      if (!r.updated && !r.skipped?.length) toast.info('Nothing to change.');
      setSelected(new Set()); setAsk(null); reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const start = async (action, everything) => {
    if (action === 'hold' || action === 'reject') return setAsk({ action, everything });
    if (everything) {
      const n = ft?.count ?? 0;
      if (!(await confirm({ title: `${VERB[action]} all ${n} filtered expense(s)?`, message: `Everything in this list (${money(ft?.amount)}) across all pages, with the filters shown. Your own entries are skipped unless you are admin.`, ok: VERB[action] }))) return;
    }
    run(action, { everything });
  };
  const chips = [
    { key: 'cat', label: 'Category', value: tree.find(x => String(x.id) === String(q.category_id))?.name, onRemove: () => setQ({ category_id: '' }) },
    { key: 'm', label: 'Method', value: q.method, onRemove: () => setQ({ method: '' }) },
    { key: 'b', label: 'Budget', value: q.budget === '1' ? 'From employee budgets' : q.budget === '0' ? 'Not from budgets' : '', onRemove: () => setQ({ budget: '' }) },
    { key: 'min', label: 'Min', value: q.min && money(q.min), onRemove: () => setQ({ min: '' }) },
    { key: 'max', label: 'Max', value: q.max && money(q.max), onRemove: () => setQ({ max: '' }) },
    { key: 'q', label: 'Search', value: q.q, onRemove: () => setQ({ q: '' }) },
  ];
  const today = todayStr();
  const columns = [
    { key: 'expense_date', label: type === 'variable' ? 'Date · Ref #' : 'Due · Ref #', sort: 'date', render: r => (r.status === 'pending' && !r.on_hold && r.expense_date < today && r.expense_type === 'constant'
      ? <span className="cell-2"><span className="text-red strong">{date(r.expense_date)}</span><small className="text-red">Overdue · {r.ref_no}</small></span> : twoLine(date(r.expense_date), <span className="mono">{r.ref_no}</span>)) },
    { key: 'item', label: 'Expense', sort: 'sub', render: itemCell },
    { key: 'paid_to', label: 'Paid to', sort: 'paid_to', render: r => twoLine(r.paid_to, r.payment_method) },
    { key: 'src', label: 'Source', render: r => (r.budget_holder_name ? <Badge tone="orange"><Wallet size={11} />Budget · {r.budget_holder_name}</Badge> : r.recurring_ref ? <Badge tone="purple"><Repeat size={11} />{FREQ[r.recurring_frequency] || 'Monthly'}</Badge> : <Badge tone={r.expense_type === 'constant' ? 'grey' : 'cyan'}>{r.expense_type === 'constant' ? 'One-off' : 'Variable'}</Badge>) },
    { key: 'receipt', label: 'Bill', render: r => <ReceiptCell row={r} optional={r.expense_type === 'constant'} /> },
    { key: 'status', label: 'Status', sort: 'status', render: r => (r.on_hold && r.status === 'pending'
      ? <span className="cell-2" title={r.hold_note || ''}><Badge tone="grey"><PauseCircle size={11} />On hold</Badge><small>{r.hold_until ? `until ${date(r.hold_until)}` : 'no date'}</small></span> : <StatusBadge status={r.status} />) },
    { key: 'amount', label: 'Amount', sort: 'amount', money: true },
    ...(approver ? [{ key: 'act', label: '', render: r => (canSelect(r) && r.status === 'pending' ? <span className="row-actions" onClick={e => e.stopPropagation()}>
      <Button size="sm" variant="success" icon={Check} title="Approve" aria-label="Approve" onClick={() => run('approve', { ids: [r.id] })} />
      {r.on_hold ? <Button size="sm" icon={PlayCircle} title="Release hold" aria-label="Release hold" onClick={() => run('release', { ids: [r.id] })} />
        : <Button size="sm" icon={PauseCircle} title="Hold" aria-label="Hold" onClick={() => setAsk({ action: 'hold', ids: [r.id] })} />}
    </span> : null) }] : []),
  ];
  const openCount = t ? t.pending_count - t.held_count : undefined;
  return (
    <div className="stack">
      {!approver && <Notice type="info">You can see the payment list. Approving, holding or rejecting needs “Expense Approvals (Manager): edit”.</Notice>}
      <Card pad={false} className="filter-card">
        <div className="cf-toolbar" style={{ padding: '14px 16px 0' }}>
          <Segmented value={type} onChange={x => { setType(x); setQ({ category_id: '' }); }} options={[{ value: 'constant', label: 'Constant expenses' }, { value: 'variable', label: 'Variable expenses' }, { value: 'all', label: 'All' }]} />
          <Segmented value={mode} onChange={setMode} options={[{ value: 'month', label: 'One month' }, { value: 'range', label: 'Date range' }]} />
          {mode === 'month' ? <MonthPicker value={month} onChange={setMonth} /> : <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />}
        </div>
        <div className="filters">
          <div className="search wide"><Search /><input className="input" placeholder="Search expense, vendor, ref #, bill no…" value={q.q} onChange={e => setQ({ q: e.target.value })} aria-label="Search" /></div>
          <Select value={q.category_id} onChange={x => setQ({ category_id: x })} searchable options={[{ value: '', label: 'All categories' }, ...tree.map(x => ({ value: String(x.id), label: x.name }))]} ariaLabel="Category" />
          <Select value={q.method} onChange={x => setQ({ method: x })} options={[{ value: '', label: 'All methods' }, ...(meta?.methods || [])]} ariaLabel="Method" />
          <Select value={q.budget} onChange={x => setQ({ budget: x })} options={[{ value: '', label: 'Any source' }, { value: '1', label: 'From employee budgets' }, { value: '0', label: 'Not from budgets' }]} ariaLabel="Source" />
          <MoneyInput value={q.min} onChange={x => setQ({ min: x })} placeholder="Min amount" aria-label="Minimum amount" />
          <MoneyInput value={q.max} onChange={x => setQ({ max: x })} placeholder="Max amount" aria-label="Maximum amount" />
        </div>
        <div className="filters-foot"><FilterChips items={chips} onClear={() => resetQ({ sort: q.sort, dir: q.dir, status: q.status })} /></div>
      </Card>
      <div className="grid grid-kpi">
        <Kpi icon={Layers} color="blue" label={mode === 'month' ? `${monthName(month)} total` : 'Total in range'} value={money(t?.amount)} sub={`${t?.count ?? 0} expense(s)`} />
        <Kpi icon={Clock} color="orange" label="Waiting approval" value={money((t?.pending || 0) - (t?.held || 0))} sub={`${openCount ?? 0} to decide`} />
        <Kpi icon={PauseCircle} color="purple" label="On hold" value={money(t?.held)} sub={`${t?.held_count ?? 0} postponed`} />
        <Kpi icon={Check} color="green" label="Approved (to pay / paid)" value={money(t?.approved)} sub={`${t?.approved_count ?? 0} approved`} />
        <Kpi icon={XCircle} color="red" label="Rejected" value={money(t?.rejected)} sub={`${t?.rejected_count ?? 0} — not paid`} />
      </div>
      <Card pad={false}>
        <CardTabs value={q.status} onChange={x => setQ({ status: x })} right={<ExportButtons dataset="payment-control" params={{ ...statusNow, sort: q.sort, dir: q.dir }} />} tabs={[
          { value: '', label: 'All', count: t?.count, icon: Layers }, { value: 'open', label: 'Not approved', count: openCount, icon: Clock }, { value: 'hold', label: 'On hold', count: t?.held_count, icon: PauseCircle },
          { value: 'approved', label: 'Approved', count: t?.approved_count, icon: Check }, { value: 'rejected', label: 'Rejected', count: t?.rejected_count, icon: XCircle }]} />
        {approver && (
          <div className="bulk-bar all-bar">
            <ListFilter size={16} /><b>{selected.size ? `${selected.size} selected` : `All filtered: ${ft?.count ?? 0} · ${money(ft?.amount)}`}</b>
            <div className="spacer" />
            {selected.size ? <>
              <Button size="sm" variant="success" icon={Check} loading={busy} onClick={() => start('approve')}>Approve</Button>
              <Button size="sm" icon={PauseCircle} onClick={() => start('hold')}>Hold</Button>
              <Button size="sm" icon={PlayCircle} onClick={() => start('release')}>Release</Button>
              <Button size="sm" icon={RotateCcw} onClick={() => start('pending')}>Not approved</Button>
              <Button size="sm" icon={X} onClick={() => start('reject')}>Reject</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            </> : <>
              <Button size="sm" variant="success" icon={CheckCheck} disabled={!ft?.count} loading={busy} onClick={() => start('approve', true)}>Approve all filtered</Button>
              <Button size="sm" icon={PauseCircle} disabled={!ft?.count} onClick={() => start('hold', true)}>Hold all filtered</Button>
              <Button size="sm" icon={PlayCircle} disabled={!ft?.held_count} onClick={() => start('release', true)}>Release all held</Button>
              <Button size="sm" icon={RotateCcw} disabled={!ft?.approved_count} onClick={() => start('pending', true)}>All back to not approved</Button>
            </>}
          </div>
        )}
        {list.error && <div className="card-body"><Notice type="error">{list.error.message}</Notice></div>}
        <ServerTable columns={columns} data={list.data} loading={list.loading} query={q} onQuery={setQ} onRowClick={can('expenses') ? r => setOpen(r.id) : undefined}
          selectable={approver} selected={selected} onSelect={setSelected} canSelect={canSelect}
          empty="No expenses match. Change the month / filters." footer={dd => <tr><td colSpan={columns.length - (approver ? 2 : 1)}>This page ({dd.rows.length}) · all {dd.total} filtered = {money(dd.totals.amount)}</td><td className="num">{money(dd.rows.reduce((a, r) => a + r.amount, 0))}</td>{approver && <td />}</tr>} />
      </Card>
      <div className="hint row" style={{ gap: 6 }}><CalendarClock size={14} />“On hold” keeps an expense not approved and moves its payment to the “hold until” date in Cash Forecast and Inflow vs Outflow. Approving or rejecting removes the hold.</div>
      {ask && <ReasonModal action={ask.action} count={ask.ids ? ask.ids.length : ask.everything ? ft?.count : selected.size} busy={busy} onClose={() => setAsk(null)} onSubmit={(note, until) => run(ask.action, { note, hold_until: until, everything: ask.everything, ids: ask.ids })} />}
      {open && <ExpenseDetail id={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

function ReasonModal({ action, count, busy, onClose, onSubmit }) {
  const [note, setNote] = useState('');
  const [until, setUntil] = useState('');
  const hold = action === 'hold';
  return (
    <Modal open onClose={onClose} size="sm" title={hold ? `Put ${count} expense(s) on hold` : `Reject ${count} expense(s)`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={hold ? 'primary' : 'danger'} loading={busy} disabled={note.trim().length < 3} onClick={() => onSubmit(note.trim(), until || null)}>{hold ? 'Hold' : 'Reject'}</Button></>}>
      <div className="form">
        <Field label={hold ? 'Why is the payment on hold?' : 'Reason (sent to the person who entered it)'} required><Textarea rows={3} autoFocus maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder={hold ? 'e.g. Pay after student fee collections on the 15th' : 'e.g. Duplicate bill'} /></Field>
        {hold && <Field label="Hold until (optional)" hint="The forecast moves the payment to this date. Empty = not counted until released."><Input type="date" min={todayStr()} value={until} onChange={e => setUntil(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}
