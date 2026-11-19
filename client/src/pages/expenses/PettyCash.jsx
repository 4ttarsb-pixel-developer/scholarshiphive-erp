import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, BookOpen, CalendarDays, Check, Clock, FileWarning, History, Pencil, Plus, PlusCircle, Search, Settings2, ShieldCheck, Trash2, Wallet, X, XCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useDebounced, useServerList, useTableQuery } from '../../lib/useServerList.js';
import { Badge, Button, Card, DateRange, Field, Kpi, Loader, Modal, MoneyInput, Notice, Select, useConfirm, useToast } from '../../components/ui.jsx';
import { BarsLines, Donut, ShareList, useColors } from '../../components/charts.jsx';
import ServerTable, { CardTabs, FilterChips } from '../../components/ServerTable.jsx';
import { money, date, dateTime, monthEnd, monthStart } from '../../lib/format.js';
import { ExportButtons, HistoryTimeline, ReasonModal, ReceiptPreview, StatusBadge, loadMeta, useBulkReview, useExpenseMeta } from './shared.jsx';
import { ReceiptCell, RowReview, itemCell, twoLine } from './Variable.jsx';
import { PettyForm, TopupForm } from './PettyForm.jsx';

const TITLES = {
  overview: ['Petty Cash', 'Small office purchases. Top-ups add to the balance; every purchase is subtracted.'],
  entries: ['Petty Cash Entries', 'Every purchase with its receipt — approvers verify each one.'],
  topups: ['Top-ups', 'Cash handed to the petty cash holder.'],
  cashbook: ['Petty Cash Book', 'Running balance: every top-up in and every purchase out.'],
};
const dayLabel = k => (/^\d{4}-\d{2}-\d{2}$/.test(k) ? new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : k);

export default function PettyCash() {
  const { tab = 'overview' } = useParams();
  const { can } = useAuth();
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const [v, setV] = useState(0);
  const [adding, setAdding] = useState(false);
  const [topup, setTopup] = useState(false);
  const sum = useServerList('/petty/summary', range, [v]);
  const bump = () => setV(x => x + 1);
  if (!TITLES[tab]) return <Navigate to="/petty-cash" replace />;
  const s = sum.data;
  const [t, sub] = TITLES[tab];
  const edit = can('petty_cash', 'edit');
  return (
    <>
      <div className="page-head">
        <div><h1>{t}</h1><p>{sub}</p></div>
        <div className="page-actions">
          {s && <span className={`balance-pill ${s.balance <= 0 ? 'bad' : s.lowBalance ? 'warn' : 'ok'}`}><Wallet size={15} />Balance {money(s.balance)}</span>}
          <DateRange from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
          {can('cashflow', 'edit') && <Link className="btn" to="/cash-flow/budgets?allot=petty"><PlusCircle />Add top-up</Link>}
          {edit && <Button variant="primary" icon={Plus} onClick={() => setAdding(true)} disabled={s && s.balance <= 0} title={s && s.balance <= 0 ? 'Balance is empty — add a top-up first' : undefined}>Add purchase</Button>}
        </div>
      </div>
      {s?.lowBalance && s.balance > 0 && <div style={{ marginBottom: 14 }}><Notice type="warn">Petty cash is running low ({money(s.balance)} left, alert level {money(s.settings.low_balance)}). Add a top-up soon.</Notice></div>}
      {s && s.balance <= 0 && <div style={{ marginBottom: 14 }}><Notice type="error">Petty cash balance is empty. A top-up is needed before recording purchases (Cash Flow Manager → Budget Allotment).</Notice></div>}
      {tab === 'overview' && <Overview sum={sum} range={range} v={v} />}
      {tab === 'entries' && <Entries range={range} v={v} reload={bump} balance={s?.balance ?? 0} />}
      {tab === 'topups' && <Topups range={range} v={v} reload={bump} />}
      {tab === 'cashbook' && <CashBook range={range} v={v} />}
      {adding && <PettyForm balance={s?.balance ?? 0} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); bump(); }} />}
      {topup && <TopupForm onClose={() => setTopup(false)} onSaved={() => { setTopup(false); bump(); }} />}
    </>
  );
}

function Overview({ sum, range, v }) {
  const c = useColors();
  const nav = useNavigate();
  const { isAdmin } = useAuth();
  const recent = useServerList('/petty', { ...range, limit: 6, sort: 'date', dir: 'desc' }, [v]);
  const s = sum.data;
  const trend = useMemo(() => (s?.trend || []).map(x => ({ ...x, label: s.granularity === 'day' ? dayLabel(x.key) : x.key })), [s]);
  if (sum.error) return <Notice type="error">{sum.error.message}</Notice>;
  if (!s) return <Loader />;
  const used = s.topups > 0 ? Math.min(100, Math.round((s.spent / s.topups) * 100)) : 0;
  const toEntries = p => nav(`/petty-cash/entries?${new URLSearchParams(p)}`);
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi icon={Wallet} color={s.balance > 0 ? (s.lowBalance ? 'orange' : 'green') : 'red'} label="Current balance" value={money(s.balance)} sub="All top-ups − all purchases" />
        <Kpi icon={BookOpen} color="blue" label="Opening (this period)" value={money(s.opening)} sub={`Closing ${money(s.closing)}`} />
        <Kpi icon={ArrowDownCircle} color="cyan" label="Top-ups in" value={money(s.periodTopups)} sub={s.pendingTopups.n ? `${s.pendingTopups.n} waiting approval` : `All time ${money(s.topups)}`} />
        <Kpi icon={ArrowUpCircle} color="orange" label="Spent" value={money(s.periodSpent)} sub={`≈ ${money(Math.round(s.avgPerDay))} per day`} />
        <Kpi icon={ShieldCheck} color="purple" label="Receipts to verify" value={s.pending} sub={`${s.verified} verified · ${s.rejected} rejected`} />
        <Kpi icon={FileWarning} color="red" label="Without receipt" value={s.noReceipt} sub={<Link to="/petty-cash/entries?receipt=missing">Review →</Link>} />
      </div>
      <div className="grid grid-main">
        <Card title="Money in vs money out" subtitle={`${s.granularity === 'day' ? 'Daily' : 'Monthly'} · top-ups and purchases`}>
          <BarsLines data={trend} xKey="label" height={260} bars={[{ key: 'topup', label: 'Top-ups', color: c.c2 }, { key: 'spent', label: 'Spent', color: c.c3 }]} />
          <div className="split-bar" style={{ marginTop: 10 }} title={`${used}% of all top-ups used`}><span style={{ width: `${used}%`, background: c.c3 }} /><span style={{ width: `${100 - used}%`, background: c.c2 }} /></div>
          <div className="row small muted" style={{ justifyContent: 'space-between', marginTop: 4 }}><span>{used}% of all top-ups spent</span><span>{money(s.balance)} left</span></div>
        </Card>
        <Card title="Spent by category" subtitle="Click to see the entries">
          <Donut data={s.byCategory} center={money(s.periodSpent, { short: true })} centerSub="This period" height={190} onSelect={it => it.id && toEntries({ category_id: it.id })} />
          <ShareList items={s.byCategory.slice(0, 5)} onSelect={it => it.id && toEntries({ category_id: it.id })} />
        </Card>
      </div>
      <div className="grid grid-3">
        <Card title="Top items" subtitle="Click to see the entries"><ShareList items={s.bySub} colorIndex={2} onSelect={it => toEntries(it.id ? { sub_category_id: it.id } : { sub_category: it.name })} /></Card>
        <Card title="Who spends" subtitle="By person who bought"><ShareList items={s.byBuyer} colorIndex={4} onSelect={it => toEntries({ purchased_by: it.name })} /></Card>
        <Card title="Paid with"><ShareList items={s.byMode} colorIndex={1} /></Card>
      </div>
      <div className="grid grid-main">
        <Card title="Latest purchases" pad={false} actions={<Link className="btn btn-sm" to="/petty-cash/entries">All entries</Link>}>
          <ServerTable data={recent.data} loading={recent.loading} empty="No purchases in this period." columns={[
            { key: 'entry_date', label: 'Date', render: r => date(r.entry_date) }, { key: 'item', label: 'Item', render: itemCell }, { key: 'purchased_by', label: 'Bought by' },
            { key: 'status', label: 'Receipt', render: r => <StatusBadge status={r.status} petty /> }, { key: 'amount', label: 'Amount', money: true }]} />
        </Card>
        {isAdmin ? <PettySettings settings={s.settings} onSaved={sum.reload} /> : (
          <Card title="Rules"><div className="slip-row"><span>Max per entry</span><b>{s.settings.max_entry ? money(s.settings.max_entry) : 'No limit'}</b></div><div className="slip-row"><span>Receipt required above</span><b>{s.settings.receipt_required_above ? money(s.settings.receipt_required_above) : 'Always'}</b></div><div className="slip-row"><span>Low balance alert</span><b>{money(s.settings.low_balance)}</b></div></Card>
        )}
      </div>
    </div>
  );
}

function PettySettings({ settings, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ low_balance: String(settings.low_balance), max_entry: String(settings.max_entry), receipt_required_above: String(settings.receipt_required_above) });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.put('/petty/settings', f); toast.success('Petty cash rules saved.'); loadMeta(true).catch(() => {}); onSaved(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Card title={<span className="row" style={{ gap: 6 }}><Settings2 size={16} />Petty cash rules</span>} subtitle="Admin only">
      <div className="form">
        <Field label="Low balance alert (PKR)" hint="Approvers get an email when the balance drops to this"><MoneyInput value={f.low_balance} onChange={x => setF(s => ({ ...s, low_balance: x }))} /></Field>
        <Field label="Maximum per entry (PKR)" hint="0 = no limit. Admins can always enter more."><MoneyInput value={f.max_entry} onChange={x => setF(s => ({ ...s, max_entry: x }))} /></Field>
        <Field label="Receipt required above (PKR)" hint="Below this, “No receipt + reason” is allowed. 0 = reason always allowed."><MoneyInput value={f.receipt_required_above} onChange={x => setF(s => ({ ...s, receipt_required_above: x }))} /></Field>
        <Button variant="primary" loading={busy} onClick={save}>Save rules</Button>
      </div>
    </Card>
  );
}

function Entries({ range, v, reload, balance }) {
  const { user, isAdmin, can } = useAuth();
  const { meta } = useExpenseMeta();
  const [sp] = useSearchParams();
  const [q, setQ, resetQ] = useTableQuery({ status: sp.get('status') || '', category_id: sp.get('category_id') || '', sub_category_id: sp.get('sub_category_id') || '', sub_category: sp.get('sub_category') || '', mode: '', purchased_by: sp.get('purchased_by') || '', receipt: sp.get('receipt') || '', q: '', sort: 'date', dir: 'desc' });
  const [open, setOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const search = useDebounced(q.q);
  const filters = { ...range, category_id: q.category_id, sub_category_id: q.sub_category_id, sub_category: q.sub_category, mode: q.mode, purchased_by: q.purchased_by, receipt: q.receipt, q: search };
  const list = useServerList('/petty', { ...filters, status: q.status, page: q.page, limit: q.limit, sort: q.sort, dir: q.dir }, [v]);
  const all = useServerList('/petty', { ...filters, limit: 1 }, [v]);
  const refresh = () => { list.reload(); all.reload(); reload(); };
  const approver = can('expense_approve', 'edit');
  const bulk = useBulkReview('/petty/review/bulk', { onDone: refresh, approveStatus: 'verified' });
  useEffect(() => { bulk.setSelected(new Set()); }, [q.status, q.page, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps
  const tree = meta?.categories?.petty || [];
  const cat = tree.find(x => String(x.id) === String(q.category_id));
  const t = all.data?.totals;
  const canSelect = r => approver && (isAdmin || r.created_by !== user.id);
  const chips = [
    { key: 'cat', label: 'Category', value: cat?.name, onRemove: () => setQ({ category_id: '', sub_category_id: '', sub_category: '' }) },
    { key: 'sub', label: 'Item', value: cat?.subs.find(s => String(s.id) === String(q.sub_category_id))?.name || q.sub_category, onRemove: () => setQ({ sub_category_id: '', sub_category: '' }) },
    { key: 'by', label: 'Bought by', value: q.purchased_by, onRemove: () => setQ({ purchased_by: '' }) },
    { key: 'mode', label: 'Paid with', value: q.mode, onRemove: () => setQ({ mode: '' }) },
    { key: 'rc', label: 'Receipt', value: q.receipt === 'missing' ? 'Missing' : q.receipt === 'attached' ? 'Attached' : '', onRemove: () => setQ({ receipt: '' }) },
  ];
  const columns = [
    { key: 'entry_date', label: 'Date · Voucher', sort: 'date', render: r => twoLine(date(r.entry_date), <span className="mono">{r.ref_no}</span>) },
    { key: 'item', label: 'What was bought', sort: 'sub', render: itemCell },
    { key: 'purchased_by', label: 'Bought by', sort: 'buyer', render: r => twoLine(r.purchased_by, [r.vendor, r.payment_mode].filter(Boolean).join(' · ')) },
    { key: 'related_to', label: 'For', className: 'hide-md', render: r => r.related_to || <span className="muted">—</span> },
    { key: 'receipt', label: 'Receipt', render: r => <ReceiptCell row={r} /> },
    { key: 'status', label: 'Valid?', sort: 'status', render: r => <StatusBadge status={r.status} petty /> },
    { key: 'amount', label: 'Amount', sort: 'amount', money: true },
    ...(approver ? [{ key: 'act', label: '', render: r => (r.status === 'pending' && canSelect(r) ? <RowReview row={r} endpoint={`/petty/${r.id}/review`} onDone={refresh} approveStatus="verified" /> : null) }] : []),
  ];
  return (
    <div className="stack">
      <Card pad={false} className="filter-card">
        <div className="filters">
          <div className="search wide"><Search /><input className="input" placeholder="Search item, voucher #, person, shop, student…" value={q.q} onChange={e => setQ({ q: e.target.value })} aria-label="Search petty cash" /></div>
          <Select value={q.category_id} onChange={x => setQ({ category_id: x, sub_category_id: '', sub_category: '' })} options={[{ value: '', label: 'All categories' }, ...tree.map(x => ({ value: String(x.id), label: x.name }))]} ariaLabel="Category filter" />
          <Select value={q.sub_category_id} disabled={!cat || !cat.subs.length} onChange={x => setQ({ sub_category_id: x, sub_category: '' })} placeholder={cat ? 'All items' : 'Pick a category first'} options={[{ value: '', label: 'All items' }, ...(cat?.subs || []).map(s => ({ value: String(s.id), label: s.name }))]} searchable ariaLabel="Item filter" />
          <Select value={q.mode} onChange={x => setQ({ mode: x })} options={[{ value: '', label: 'Any payment' }, ...(meta?.pettyModes || [])]} ariaLabel="Paid with filter" />
          <Select value={q.receipt} onChange={x => setQ({ receipt: x })} options={[{ value: '', label: 'Any receipt' }, { value: 'attached', label: 'Receipt attached' }, { value: 'missing', label: 'No receipt' }]} ariaLabel="Receipt filter" />
        </div>
        <div className="filters-foot"><FilterChips items={chips} onClear={() => resetQ({ sort: q.sort, dir: q.dir })} /></div>
      </Card>
      <Card pad={false}>
        <CardTabs value={q.status} onChange={x => setQ({ status: x })} right={<ExportButtons dataset="petty" params={{ ...filters, status: q.status, sort: q.sort, dir: q.dir }} />} tabs={[
          { value: '', label: 'All', count: t?.count, icon: Wallet }, { value: 'pending', label: 'To verify', count: t?.pending_count, icon: Clock },
          { value: 'verified', label: 'Verified', count: t?.verified_count, icon: Check }, { value: 'rejected', label: 'Not valid', count: t?.rejected_count, icon: XCircle }]} />
        {bulk.bar}
        {list.error && <div className="card-body"><Notice type="error">{list.error.message}</Notice></div>}
        <ServerTable columns={columns} data={list.data} loading={list.loading} query={q} onQuery={setQ} onRowClick={r => setOpen(r.id)}
          selectable={approver} selected={bulk.selected} onSelect={bulk.setSelected} canSelect={canSelect} empty="No petty cash purchases match."
          footer={d => <tr><td colSpan={columns.length - 1}>Spent (not rejected, all filtered rows)</td><td className="num">{money(d.totals.spent)}</td>{approver && <td />}</tr>} />
        {bulk.modal}
      </Card>
      {open && <PettyDetail id={open} onClose={() => setOpen(null)} reload={refresh} onEdit={p => { setOpen(null); setEditing(p); }} />}
      {editing && <PettyForm record={editing} balance={balance} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function PettyDetail({ id, onClose, reload, onEdit }) {
  const { user, isAdmin, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [p, setP] = useState(null);
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const load = () => api.get(`/petty/${id}`).then(setP).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p) return <Modal open onClose={onClose} title="Petty cash entry" size="lg"><Loader /></Modal>;
  const own = p.created_by === user.id;
  const mayReview = can('expense_approve', 'edit') && (isAdmin || !own);
  const mayEdit = isAdmin || (can('petty_cash', 'edit') && own && p.status === 'pending');
  const review = async (status, note) => {
    setBusy(status);
    try { await api.post(`/petty/${p.id}/review`, { status, note }); toast.success(status === 'verified' ? 'Receipt marked valid.' : status === 'rejected' ? 'Not valid — amount returned to the balance.' : 'Moved back to “to verify”.'); setRejecting(false); reload(); await load(); }
    catch (x) { toast.error(x.message); } finally { setBusy(''); }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete entry?', message: `${p.ref_no} · ${p.title} · ${money(p.amount)}. The amount returns to the balance.`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/petty/${p.id}`); toast.success('Deleted.'); reload(); onClose(); } catch (x) { toast.error(x.message); }
  };
  return (
    <>
      <Modal open onClose={onClose} size="lg" title={`${p.ref_no} · ${p.title}`} subtitle={`${p.category}${p.sub_category ? ' › ' + p.sub_category : ''} · ${date(p.entry_date)}`}
        footer={<>
          {isAdmin && <Button variant="danger" icon={Trash2} onClick={del}>Delete</Button>}
          {mayEdit && <Button icon={Pencil} onClick={() => onEdit(p)}>Edit</Button>}
          <div className="spacer" />
          {mayReview && p.status !== 'rejected' && <Button icon={X} onClick={() => setRejecting(true)}>Receipt not valid</Button>}
          {mayReview && p.status !== 'verified' && <Button variant="success" icon={Check} loading={busy === 'verified'} onClick={() => review('verified')}>Receipt is valid</Button>}
        </>}>
        <div className="grid grid-2">
          <div className="stack" style={{ gap: 12 }}>
            <div className="detail-amount"><span>{money(p.amount)}</span><StatusBadge status={p.status} petty /></div>
            <dl className="dl">
              <dt>What was bought</dt><dd>{p.title}</dd><dt>Category</dt><dd>{p.category}</dd><dt>Item</dt><dd>{p.sub_category || '—'}</dd>
              <dt>Bought by</dt><dd>{p.purchased_by}</dd><dt>Shop / vendor</dt><dd>{p.vendor || '—'}</dd><dt>Paid with</dt><dd>{p.payment_mode}</dd>
              <dt>Student / client</dt><dd>{p.related_to || '—'}</dd><dt>Department</dt><dd>{p.location || '—'}</dd>
              <dt>Notes</dt><dd>{p.description || '—'}</dd>
              <dt>Entered by</dt><dd>{p.entered_by} · {dateTime(p.created_at)}</dd>
              {p.reviewed_by_name && <><dt>Checked by</dt><dd>{p.reviewed_by_name} · {dateTime(p.reviewed_at)}</dd></>}
              {p.review_note && <><dt>Note</dt><dd>{p.review_note}</dd></>}
            </dl>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            {own && !isAdmin && can('expense_approve', 'edit') && p.status === 'pending' && <Notice type="info">You entered this, so another approver must verify it.</Notice>}
            {p.receipt_duplicate_of && <Notice type="warn">This exact receipt file was already uploaded before — possible duplicate.</Notice>}
            {p.receipt_file_id ? <ReceiptPreview id={p.receipt_file_id} mime={p.receipt_mime} name={p.receipt_name} /> : <div className="notice warn"><AlertTriangle /><div><b>No receipt.</b> Reason: {p.no_receipt_reason || '—'}</div></div>}
            <div className="card card-pad" style={{ padding: 14 }}><div className="row" style={{ gap: 6, marginBottom: 8 }}><History size={16} /><b>History</b></div><HistoryTimeline items={p.history} /></div>
          </div>
        </div>
      </Modal>
      <ReasonModal open={rejecting} title="Why is the receipt not valid?" ok="Mark not valid" busy={busy === 'rejected'} onClose={() => setRejecting(false)} onSubmit={note => review('rejected', note)} />
    </>
  );
}

function Topups({ range, v, reload }) {
  const { user, isAdmin, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useTableQuery({ status: '', sort: 'date', dir: 'desc' });
  const list = useServerList('/petty/topups', { ...range, status: q.status, page: q.page, limit: q.limit, sort: q.sort, dir: q.dir }, [v]);
  const all = useServerList('/petty/topups', { ...range, limit: 1 }, [v]);
  const t = all.data?.totals;
  const approver = can('expense_approve', 'edit');
  const refresh = () => { list.reload(); all.reload(); reload(); };
  const del = async r => {
    if (!(await confirm({ title: 'Delete top-up?', message: `${r.ref_no} · ${money(r.amount)}`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/petty/topups/${r.id}`); toast.success('Deleted.'); refresh(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="stack">
    <Notice type="info">Top-ups are now added in <b>Cash Flow Manager → Budget Allotment</b>, together with employee budgets — so every amount given out is approved in one place. {can('cashflow') ? <Link to="/cash-flow/budgets?allot=petty">Add a top-up there →</Link> : 'Ask an admin or the cash-flow manager.'} Old top-ups stay listed here.</Notice>
    <Card pad={false}>
      <CardTabs value={q.status} onChange={x => setQ({ status: x })} right={<ExportButtons dataset="petty-topups" params={range} />} tabs={[
        { value: '', label: 'All', count: t?.count }, { value: 'pending', label: 'Not approved', count: t?.pending_count, icon: Clock }, { value: 'approved', label: 'Approved', count: t?.approved_count, icon: Check }, { value: 'rejected', label: 'Rejected', count: t?.rejected_count, icon: XCircle }]} />
      <ServerTable data={list.data} loading={list.loading} query={q} onQuery={setQ} empty="No top-ups in this period." columns={[
        { key: 'expense_date', label: 'Date', sort: 'date', render: r => date(r.expense_date) }, { key: 'ref_no', label: 'Ref #', sort: 'ref', render: r => <span className="mono">{r.ref_no}</span> },
        { key: 'paid_to', label: 'Given to', sort: 'given_to' }, { key: 'payment_method', label: 'From' }, { key: 'reference_no', label: 'Reference', render: r => r.reference_no || '—' },
        { key: 'entered_by', label: 'Entered by' }, { key: 'status', label: 'Status', sort: 'status', render: r => <StatusBadge status={r.status} /> }, { key: 'amount', label: 'Amount', sort: 'amount', money: true },
        { key: 'act', label: '', render: r => <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          {approver && r.status === 'pending' && (isAdmin || r.created_by !== user.id) && <RowReview row={r} endpoint={`/petty/topups/${r.id}/review`} onDone={refresh} />}
          {isAdmin && <Button size="sm" variant="ghost" icon={Trash2} title="Delete" aria-label="Delete top-up" onClick={() => del(r)} />}</span> }]}
        footer={d => <tr><td colSpan={7}>Approved (all filtered rows)</td><td className="num">{money(d.totals.approved)}</td><td /></tr>} />
    </Card>
    </div>
  );
}

function CashBook({ range, v }) {
  const [q, setQ] = useTableQuery({ dir: 'asc', limit: 50 });
  const list = useServerList('/petty/ledger', { ...range, page: q.page, limit: q.limit, dir: q.dir }, [v]);
  const d = list.data;
  return (
    <div className="stack">
      <div className="grid grid-kpi">
        <Kpi icon={CalendarDays} color="blue" label="Opening balance" value={money(d?.opening)} sub={`On ${date(range.from)}`} />
        <Kpi icon={ArrowDownCircle} color="green" label="Top-ups in (+)" value={money(d?.credits)} />
        <Kpi icon={ArrowUpCircle} color="orange" label="Purchases out (−)" value={money(d?.debits)} />
        <Kpi icon={BookOpen} color="purple" label="Closing balance" value={money(d?.closing)} sub={`On ${date(range.to)}`} />
      </div>
      <Card pad={false} title="Cash book" subtitle="Rejected purchases and unapproved top-ups are not counted" actions={<ExportButtons dataset="petty-ledger" params={range} />}>
        <div className="card-toolbar"><Select value={q.dir} onChange={x => setQ({ dir: x })} options={[{ value: 'asc', label: 'Oldest first' }, { value: 'desc', label: 'Newest first' }]} ariaLabel="Order" /></div>
        <ServerTable data={d} loading={list.loading} query={q} onQuery={setQ} pageSizes={[25, 50, 100, 200]} empty="No movements in this period." columns={[
          { key: 'd', label: 'Date', render: r => date(r.d) }, { key: 'ref_no', label: 'Ref #', render: r => <span className="mono">{r.ref_no}</span> },
          { key: 'kind', label: 'Type', render: r => (r.kind === 'topup' ? <Badge tone="green">Top-up</Badge> : <Badge tone="orange">Purchase</Badge>) },
          { key: 'title', label: 'Details', render: r => <div className="cell-2"><b>{r.title}</b><small>{r.category || ''}</small></div> }, { key: 'party', label: 'Given to / bought by' },
          { key: 'credit', label: 'In (+)', render: r => (r.credit ? <span className="text-green">{money(r.credit)}</span> : '—'), align: 'right' },
          { key: 'debit', label: 'Out (−)', render: r => (r.debit ? <span className="text-orange">{money(r.debit)}</span> : '—'), align: 'right' },
          { key: 'balance', label: 'Balance', render: r => <b>{money(r.balance)}</b>, align: 'right' }]} />
      </Card>
    </div>
  );
}
