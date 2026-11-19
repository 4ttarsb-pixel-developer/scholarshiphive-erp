// "My Budget": an employee who received a cash budget from Cash Flow Manager records his / her own variable expenses here.
// Only their own entries are visible. No Expenses-module access is needed.
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownCircle, Check, Clock, History, Lock, Pencil, Plus, Receipt, Search, Wallet, XCircle } from 'lucide-react';
import { useAuth, useLoad } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { useDebounced, useServerList, useTableQuery } from '../lib/useServerList.js';
import { Badge, Button, Card, DataTable, Kpi, Loader, Modal, Notice } from '../components/ui.jsx';
import { ShareList } from '../components/charts.jsx';
import ServerTable, { CardTabs } from '../components/ServerTable.jsx';
import { money, date, dateTime } from '../lib/format.js';
import ExpenseForm from './expenses/ExpenseForm.jsx';
import { HistoryTimeline, ReceiptPreview, StatusBadge } from './expenses/shared.jsx';
import { ReceiptCell, itemCell, twoLine } from './expenses/Variable.jsx';

export default function MyBudget() {
  const { refresh } = useAuth();
  const [v, setV] = useState(0);
  const [form, setForm] = useState(null);
  const [open, setOpen] = useState(null);
  const { data: d, error } = useLoad('/budgets/me', [v]);
  const bump = () => { setV(x => x + 1); };
  useEffect(() => { refresh?.().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  if (!d.wallet) return (
    <>
      <div className="page-head"><div><h1>My Budget</h1><p>Cash given to you by the company for work expenses.</p></div></div>
      <div className="card card-pad empty-state"><Wallet /><h3>No budget yet</h3><p className="muted">When admin allots a budget to you in Cash Flow Manager (for example for an expo, courier or attestation runs), it appears here and you can record your expenses with receipts.</p></div>
    </>
  );
  const w = d.wallet, b = d.balance;
  const net = b.allotted - b.returned;
  const used = net > 0 ? Math.min(100, Math.round((b.spent / net) * 100)) : 0;
  return (
    <>
      <div className="page-head">
        <div><h1>My Budget</h1><p>{w.purpose || 'Cash given to you for work expenses'} — only you and the approvers see these entries.</p></div>
        <div className="page-actions">
          <span className={`balance-pill ${b.balance <= 0 ? 'bad' : 'ok'}`}><Wallet size={15} />Balance {money(b.balance)}</span>
          {w.active && <Button variant="primary" icon={Plus} disabled={b.balance <= 0} onClick={() => setForm({})}>Add expense</Button>}
        </div>
      </div>
      <div className="stack">
        {w.state === 'closed' && <Notice type="warn"><Lock size={14} style={{ verticalAlign: -2 }} /> Your budget was closed{w.closed_at ? ` on ${date(w.closed_at)}` : ''}{w.close_note ? ` — ${w.close_note}` : ''}. You can still see your history.</Notice>}
        {w.state === 'active' && !w.active && <Notice type="warn">Your budget expired on {date(w.valid_until)}. Ask admin to extend it.</Notice>}
        {w.active && b.balance <= 0 && <Notice type="error">No balance left. Ask admin to add more cash to your budget.</Notice>}
        <div className="grid grid-kpi">
          <Kpi icon={Wallet} color={b.balance > 0 ? 'green' : 'red'} label="Balance left" value={money(b.balance)} sub={`${used}% used`} />
          <Kpi icon={ArrowDownCircle} color="blue" label="Received" value={money(net)} sub={b.returned ? `Returned ${money(b.returned)}` : b.pending_allot ? `${money(b.pending_allot)} waiting approval` : 'Approved allotments'} />
          <Kpi icon={Receipt} color="orange" label="Spent" value={money(b.spent)} sub={`${money(b.spent_approved)} approved`} />
          <Kpi icon={Clock} color="purple" label="Waiting approval" value={money(b.spent_pending)} sub={`${b.pending_count} expense(s)`} />
        </div>
        <div className="split-bar"><span style={{ width: `${used}%`, background: 'var(--orange)' }} /><span style={{ width: `${100 - used}%`, background: 'var(--green)' }} /></div>
        {(w.valid_until || w.max_entry > 0 || w.category_ids.length > 0) && (
          <Card title="Rules of your budget">
            {w.valid_until && <div className="slip-row"><span>Valid until</span><b>{date(w.valid_until)}</b></div>}
            {w.max_entry > 0 && <div className="slip-row"><span>Maximum per expense</span><b>{money(w.max_entry)}</b></div>}
            {w.category_ids.length > 0 && <div className="slip-row"><span>Allowed for</span><b>{d.categories.map(c => c.name).join(', ')}</b></div>}
          </Card>
        )}
        <Expenses v={v} onOpen={setOpen} />
        <div className="grid grid-2">
          <Card title="Money received" pad={false}>
            <DataTable rows={d.entries} search={false} pageSize={8} empty="Nothing yet." columns={[
              { key: 'entry_date', label: 'Date', render: r => date(r.entry_date) }, { key: 'ref_no', label: 'Ref #', render: r => <span className="mono">{r.ref_no}</span> },
              { key: 'kind', label: 'Type', render: r => <Badge tone={r.kind === 'allot' ? 'green' : 'purple'}>{r.kind === 'allot' ? 'Received' : 'Returned'}</Badge> },
              { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} /> }, { key: 'amount', label: 'Amount', money: true }]} />
          </Card>
          <Card title="Spent on"><ShareList items={d.byCategory} colorIndex={2} /></Card>
        </div>
      </div>
      {form && <ExpenseForm record={form.id ? form : undefined} kind={form.id ? 'variable' : undefined} budget={{ balance: b.balance, categories: d.categories, maxEntry: w.max_entry }} onClose={() => setForm(null)} onSaved={() => { setForm(null); bump(); }} />}
      {open && <MyExpense id={open} canEdit={w.active} onClose={() => setOpen(null)} onEdit={e => { setOpen(null); setForm(e); }} />}
    </>
  );
}

function Expenses({ v, onOpen }) {
  const [q, setQ] = useTableQuery({ status: '', q: '', sort: 'date', dir: 'desc' });
  const search = useDebounced(q.q);
  const list = useServerList('/budgets/me/expenses', { status: q.status, q: search, page: q.page, limit: q.limit, sort: q.sort, dir: q.dir }, [v]);
  const all = useServerList('/budgets/me/expenses', { q: search, limit: 1 }, [v]);
  const t = all.data?.totals;
  return (
    <Card pad={false} title="My expenses">
      <div className="card-toolbar"><div className="search"><Search /><input className="input" placeholder="Search item, ref #, vendor…" value={q.q} onChange={e => setQ({ q: e.target.value })} aria-label="Search my expenses" /></div></div>
      <CardTabs value={q.status} onChange={x => setQ({ status: x })} tabs={[{ value: '', label: 'All', count: t?.count, icon: Receipt }, { value: 'pending', label: 'Not approved', count: t?.pending_count, icon: Clock }, { value: 'approved', label: 'Approved', count: t?.approved_count, icon: Check }, { value: 'rejected', label: 'Rejected', count: t?.rejected_count, icon: XCircle }]} />
      <ServerTable data={list.data} loading={list.loading} query={q} onQuery={setQ} onRowClick={r => onOpen(r.id)} empty="No expenses yet. Tap “Add expense” and attach the receipt." columns={[
        { key: 'expense_date', label: 'Date · Ref #', sort: 'date', render: r => twoLine(date(r.expense_date), <span className="mono">{r.ref_no}</span>) },
        { key: 'item', label: 'Expense', sort: 'item', render: itemCell },
        { key: 'paid_to', label: 'Paid to', render: r => twoLine(r.paid_to, r.payment_method) },
        { key: 'receipt', label: 'Receipt', render: r => <ReceiptCell row={r} /> },
        { key: 'status', label: 'Status', sort: 'status', render: r => <StatusBadge status={r.status} /> },
        { key: 'amount', label: 'Amount', sort: 'amount', money: true }]}
        footer={d => <tr><td colSpan={5}>Spent (not rejected, all rows)</td><td className="num">{money(d.totals.spent)}</td></tr>} />
    </Card>
  );
}

function MyExpense({ id, canEdit, onClose, onEdit }) {
  const [e, setE] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get(`/budgets/me/expenses/${id}`).then(setE).catch(setErr); }, [id]);
  if (err) return <Modal open onClose={onClose} title="Expense"><Notice type="error">{err.message}</Notice></Modal>;
  if (!e) return <Modal open onClose={onClose} title="Expense" size="lg"><Loader /></Modal>;
  return (
    <Modal open onClose={onClose} size="lg" title={`${e.ref_no} · ${e.title}`} subtitle={`${e.category}${e.sub_category ? ' › ' + e.sub_category : ''} · ${date(e.expense_date)}`}
      footer={canEdit && e.status === 'pending' ? <Button icon={Pencil} onClick={() => onEdit(e)}>Edit</Button> : null}>
      <div className="grid grid-2">
        <div className="stack" style={{ gap: 12 }}>
          <div className="detail-amount"><span>{money(e.amount)}</span><StatusBadge status={e.status} /></div>
          <dl className="dl">
            <dt>Paid to</dt><dd>{e.paid_to}</dd><dt>Method</dt><dd>{e.payment_method}</dd><dt>Bill no.</dt><dd>{e.reference_no || '—'}</dd>
            <dt>Notes</dt><dd>{e.description || '—'}</dd><dt>Entered</dt><dd>{dateTime(e.created_at)}</dd>
            {e.reviewed_by_name && <><dt>Checked by</dt><dd>{e.reviewed_by_name} · {dateTime(e.reviewed_at)}</dd></>}
            {e.review_note && <><dt>Note</dt><dd>{e.review_note}</dd></>}
          </dl>
          {e.status === 'rejected' && <Notice type="error">Rejected — this amount was returned to your balance.</Notice>}
        </div>
        <div className="stack" style={{ gap: 12 }}>
          {e.receipt_file_id ? <ReceiptPreview id={e.receipt_file_id} mime={e.receipt_mime} name={e.receipt_name} /> : <div className="notice warn"><AlertTriangle /><div><b>No receipt.</b> Reason: {e.no_receipt_reason || '—'}</div></div>}
          <div className="card card-pad" style={{ padding: 14 }}><div className="row" style={{ gap: 6, marginBottom: 8 }}><History size={16} /><b>History</b></div><HistoryTimeline items={e.history} /></div>
        </div>
      </div>
    </Modal>
  );
}
