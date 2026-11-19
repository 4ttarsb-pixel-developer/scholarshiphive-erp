import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, CalendarClock, CalendarRange, Check, Clock, History, ListChecks, Pause, Pencil, Play, Plus, Power, Repeat, Search, SkipForward, Square, Trash2, Undo2, Wallet, X, XCircle, Zap } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useDebounced, useServerList, useTableQuery } from '../../lib/useServerList.js';
import { Badge, Button, Card, Field, Input, Kpi, Loader, Modal, MonthPicker, MoneyInput, Notice, Segmented, Select, Textarea, useConfirm, useToast } from '../../components/ui.jsx';
import { SimpleBars, useColors } from '../../components/charts.jsx';
import ServerTable, { CardTabs } from '../../components/ServerTable.jsx';
import { money, date, dateTime, monthName, thisMonth, titleCase } from '../../lib/format.js';
import { ExpenseDetail, ExportButtons, HistoryTimeline, ReasonModal, StatusBadge, useBulkReview, useExpenseMeta } from './shared.jsx';
import { ReceiptCell, RowReview, itemCell, twoLine } from './Variable.jsx';
import { ordinal } from './ExpenseForm.jsx';
import CategoryPicker, { categoryPayload, categoryValue, checkCategory } from '../../components/CategoryPicker.jsx';

const FREQ = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', yearly: 'Yearly' };

export default function Constant({ v, openForm, bump }) {
  const [sp, setSp] = useSearchParams();
  const view = ['selection', 'monthly', 'recurring', 'upcoming'].includes(sp.get('view')) ? sp.get('view') : 'selection';
  const [batchOpen, setBatchOpen] = useState(false);
  const setView = x => setSp(p => { const n = new URLSearchParams(p); n.set('view', x); return n; }, { replace: true });
  return (
    <div className="stack">
      <div className="view-switch">
        <Segmented value={view} onChange={setView} options={[
          { value: 'selection', label: <span className="row" style={{ gap: 6 }}><Power size={15} />Expense switches</span> },
          { value: 'monthly', label: <span className="row" style={{ gap: 6 }}><ListChecks size={15} />Monthly list</span> },
          { value: 'recurring', label: <span className="row" style={{ gap: 6 }}><Repeat size={15} />Recurring list</span> },
          { value: 'upcoming', label: <span className="row" style={{ gap: 6 }}><CalendarRange size={15} />Upcoming months</span> }]} />
      </div>
      {view === 'selection' && <ExpenseSwitches v={v} openForm={openForm} bump={bump} />}
      {view === 'monthly' && <MonthlyList v={v} openForm={openForm} initialCategory={sp.get('category_id') || ''} />}
      {view === 'recurring' && <RecurringList v={v} openForm={openForm} bump={bump} onBulk={() => setBatchOpen(true)} />}
      {batchOpen && <BatchConstantSetup onClose={() => setBatchOpen(false)} onSaved={() => { setBatchOpen(false); bump(); }} />}
      {view === 'upcoming' && <Upcoming v={v} bump={bump} />}
    </div>
  );
}

// ═════════ Office-based expense switches (LMS-style recurring setup) ═════════
function ExpenseSwitches({ v, openForm, bump }) {
  const { meta, error: metaError, reload: reloadMeta } = useExpenseMeta();
  const { can, isAdmin } = useAuth();
  const toast = useToast();
  const [office, setOffice] = useState('');
  const [search, setSearch] = useState('');
  const [addingOffice, setAddingOffice] = useState(false);
  const [officeName, setOfficeName] = useState('');
  const [officeBusy, setOfficeBusy] = useState(false);
  const [busyItem, setBusyItem] = useState('');
  const [detail, setDetail] = useState(null);
  const offices = meta?.offices || ['Office 1', 'Office 2', 'Office 3', 'Office 4'];
  const canEdit = can('expenses', 'edit');
  const approver = can('expense_approve', 'edit');
  const list = useServerList(office ? '/expenses/recurring/switches' : null, { office }, [v]);
  const dataReady = list.data?.office === office;
  const templates = dataReady ? (list.data?.rows || []) : [];
  const tree = meta?.categories?.constant || [];

  useEffect(() => {
    if (offices.length && !offices.includes(office)) setOffice(offices[0]);
  }, [offices, office]);

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tree.map(category => {
      const inCategory = templates.filter(row => String(row.category_id) === String(category.id));
      let items;
      if (category.allow_custom || !category.subs?.length) {
        items = inCategory.map(record => ({
          key: `${category.id}:custom:${record.id}`,
          label: record.sub_category || record.title,
          categoryName: category.name,
          categoryValue: categoryValue(tree, record),
          template: record,
        }));
        items.push({
          key: `${category.id}:custom:new`,
          label: `Add another ${category.name.toLowerCase()} expense`,
          categoryName: category.name,
          categoryValue: { category_id: String(category.id), sub_category_id: '', sub_category_other: '', save_option: false },
          template: null,
          isCustomNew: true,
        });
      } else {
        items = category.subs.flatMap(sub => {
          const matches = inCategory.filter(row => String(row.sub_category_id || '') === String(sub.id)
            || (!row.sub_category_id && String(row.sub_category || '').toLowerCase() === String(sub.name).toLowerCase()));
          const categoryValueForItem = { category_id: String(category.id), sub_category_id: String(sub.id), sub_category_other: '', save_option: false };
          return matches.length
            ? [...matches.map(record => ({ key: `${category.id}:${sub.id}:${record.id}`, label: sub.name, categoryName: category.name, categoryValue: categoryValueForItem, template: record })),
              { key: `${category.id}:${sub.id}:new`, label: `Add another ${sub.name.toLowerCase()} expense`, categoryName: category.name, categoryValue: categoryValueForItem, template: null, isCustomNew: true }]
            : [{ key: `${category.id}:${sub.id}`, label: sub.name, categoryName: category.name, categoryValue: categoryValueForItem, template: null }];
        });
      }
      if (needle) items = items.filter(item => `${item.label} ${item.categoryName} ${item.template?.paid_to || ''}`.toLowerCase().includes(needle));
      return { category, items };
    }).filter(group => group.items.length);
  }, [tree, templates, search]);

  const toggleItem = async item => {
    if (!canEdit || busyItem) return;
    const record = item.template;
    if (!record) {
      openForm({ presetType: 'constant', lockType: true, initialCategory: item.categoryValue, initialLocation: office });
      return;
    }
    if (record.status !== 'approved') {
      toast.warn('This recurring expense is waiting for approval. An approver must review it first.');
      return;
    }
    if (!approver) {
      toast.warn('Only an expense approver can pause or resume an existing recurring expense.');
      return;
    }
    const state = record.state === 'active' ? 'paused' : 'active';
    setBusyItem(item.key);
    try {
      await api.post(`/expenses/recurring/${record.id}/state`, { state });
      toast.success(state === 'paused' ? `${item.label} paused for ${office}. Past cycles and history were kept.` : `${item.label} resumed for ${office}.`);
      bump();
    } catch (e) { toast.error(e.message); }
    finally { setBusyItem(''); }
  };

  const addOffice = async () => {
    const name = officeName.trim();
    if (name.length < 2) { toast.warn('Enter an office / branch name with at least 2 characters.'); return; }
    setOfficeBusy(true);
    try {
      const result = await api.post('/expenses/offices', { name });
      await reloadMeta();
      setOffice(result.offices?.find(x => x.toLowerCase() === name.toLowerCase()) || name);
      setOfficeName('');
      setAddingOffice(false);
      toast.success(`${name} added. You can now configure its recurring expenses.`);
    } catch (e) { toast.error(e.message); }
    finally { setOfficeBusy(false); }
  };

  if (metaError) return <Notice type="error">{metaError.message}</Notice>;
  if (!meta) return <Loader />;

  return (
    <div className="stack expense-switch-page">
      <Card title="Select recurring expenses" subtitle="Choose an office, then switch on each expense you want to repeat. Turning one on opens the existing constant-expense form." pad={false}>
        <div className="expense-switch-toolbar">
          <div className="expense-office-picker">
            <Building2 size={17} />
            <Select value={office} onChange={setOffice} options={offices.map(name => ({ value: name, label: name }))} ariaLabel="Office / branch" />
          </div>
          {isAdmin && <Button icon={Plus} onClick={() => setAddingOffice(true)}>Add office</Button>}
          <div className="spacer" />
          <div className="search"><Search /><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search rent, utility, internet…" aria-label="Search constant expenses" /></div>
        </div>
        <div className="expense-switch-note"><Power size={15} /> Switch on an expense to complete its details. Approved switches can be paused or resumed; existing monthly records are never deleted by switching off.</div>
        {list.error && <div className="card-body"><Notice type="error">{list.error.message}</Notice></div>}
        {list.loading || (!dataReady && !list.error) ? <Loader /> : dataReady && groups.length ? (
          <div className="expense-switch-groups">
            {groups.map(group => (
              <section className="expense-switch-group" key={group.category.id}>
                <div className="expense-switch-group-head"><b>{group.category.name}</b><span>{group.items.length} item(s)</span></div>
                {group.items.map(item => {
                  const record = item.template;
                  const checked = Boolean(record && record.state === 'active');
                  const isPending = record?.status === 'pending';
                  const needsApprover = Boolean(record && record.status === 'approved' && !approver);
                  const disabled = !canEdit || Boolean(busyItem) || isPending || needsApprover;
                  const status = !record ? 'Not configured' : isPending ? 'Waiting for approval' : record.state === 'active' ? 'Active' : record.state === 'paused' ? 'Paused' : 'Ended';
                  return (
                    <div className="expense-switch-row" key={item.key}>
                      <div className="expense-switch-copy">
                        <b>{item.label}</b>
                        <small>{record ? `${record.paid_to || 'No payee'} · ${money(record.amount)} / ${record.frequency === 'monthly' ? 'month' : FREQ[record.frequency]?.toLowerCase() || 'cycle'}` : item.isCustomNew ? 'Set up a new expense in this category' : group.category.name}</small>
                      </div>
                      <div className="expense-switch-status">
                        {record ? <Badge tone={isPending ? 'orange' : checked ? 'green' : record.state === 'paused' ? 'grey' : 'blue'}>{status}</Badge> : <Badge tone="grey">Not configured</Badge>}
                        {record && <Button size="sm" variant="ghost" onClick={() => setDetail(record.id)}>Details</Button>}
                      </div>
                      <button type="button" role="switch" aria-checked={checked} aria-label={`${checked ? 'Pause' : 'Set up or resume'} ${item.label} for ${office}`}
                        className={`expense-toggle ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
                        disabled={disabled} title={disabled ? (isPending ? 'Waiting for approval' : needsApprover ? 'Approver permission required' : 'Expense edit permission required') : checked ? 'Switch off to pause future cycles' : 'Switch on to set up or resume'}
                        onClick={() => toggleItem(item)}><span /></button>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ) : dataReady ? <div className="empty-state"><Power size={28} /><h3>No matching expense items</h3><p>Change the search text, or add a category / expense item under Expense Categories.</p></div> : null}
      </Card>
      {!canEdit && <Notice type="info">You have view-only access. Ask an admin for permission to set up or change recurring expenses.</Notice>}
      {addingOffice && <Modal open onClose={() => { if (!officeBusy) setAddingOffice(false); }} title="Add office / branch" subtitle="This office will become available across the recurring-expense forms and filters."
        footer={<><Button onClick={() => setAddingOffice(false)} disabled={officeBusy}>Cancel</Button><Button variant="primary" loading={officeBusy} onClick={addOffice}>Save office</Button></>}>
        <Field label="Office / branch name" required><Input autoFocus maxLength={120} value={officeName} onChange={e => setOfficeName(e.target.value)} placeholder="e.g. Islamabad Branch" /></Field>
      </Modal>}
      {detail && <RecurringDetail id={detail} onClose={() => setDetail(null)} onChanged={() => { setDetail(null); bump(); }} onEdit={record => { setDetail(null); openForm({ record, kind: 'template' }); }} />}
    </div>
  );
}

// ═════════ Monthly cycles (approve which ones get paid) ═════════
function MonthlyList({ v, openForm, initialCategory }) {
  const { user, isAdmin, can } = useAuth();
  const { meta } = useExpenseMeta();
  const [month, setMonth] = useState(thisMonth());
  const [q, setQ] = useTableQuery({ status: '', category_id: initialCategory, office: '', q: '', sort: 'date', dir: 'asc' });
  const [open, setOpen] = useState(null);
  const search = useDebounced(q.q);
  const base = { month, category_id: q.category_id, location: q.office, q: search };
  const list = useServerList('/expenses/cycles', { ...base, status: q.status, page: q.page, limit: q.limit, sort: q.sort, dir: q.dir }, [v]);
  const all = useServerList('/expenses/cycles', { ...base, limit: 1 }, [v]); // counts for the tabs (status-free)
  const reload = () => { list.reload(); all.reload(); };
  const approver = can('expense_approve', 'edit');
  const bulk = useBulkReview('/expenses/review/bulk', { onDone: reload });
  useEffect(() => { bulk.setSelected(new Set()); }, [month, q.status, q.page]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = all.data?.totals;
  const tree = meta?.categories?.constant || [];
  const canSelect = r => approver && (isAdmin || r.created_by !== user.id);
  const columns = [
    { key: 'expense_date', label: 'Due date · Ref #', sort: 'date', render: r => (r.status === 'pending' && r.expense_date < new Date().toISOString().slice(0, 10)
      ? <span className="cell-2" title="Due date passed and still not approved"><span className="text-red strong">{date(r.expense_date)}</span><small className="text-red">Overdue · {r.ref_no}</small></span>
      : twoLine(date(r.expense_date), <span className="mono">{r.ref_no}</span>)) },
    { key: 'item', label: 'Expense', sort: 'sub', render: itemCell },
    { key: 'paid_to', label: 'Paid to', sort: 'paid_to', render: r => twoLine(r.paid_to, r.payment_method) },
    { key: 'location', label: 'Office / branch', sort: 'location', render: r => r.location || '—' },
    { key: 'freq', label: 'Repeats', render: r => (r.recurring_ref ? <Badge tone="purple"><Repeat size={11} />{FREQ[r.recurring_frequency] || 'Monthly'}</Badge> : <Badge tone="grey">One-off</Badge>) },
    { key: 'receipt', label: 'Bill', render: r => <ReceiptCell row={r} optional /> },
    { key: 'status', label: 'Status', sort: 'status', render: r => <StatusBadge status={r.status} hold={r.on_hold} /> },
    { key: 'amount', label: 'Amount', sort: 'amount', money: true },
    ...(approver ? [{ key: 'act', label: '', render: r => (r.status === 'pending' && canSelect(r) ? <RowReview row={r} endpoint={`/expenses/${r.id}/review`} onDone={reload} /> : null) }] : []),
  ];
  return (
    <>
      <div className="grid grid-kpi">
        <Kpi icon={CalendarClock} color="purple" label={`${monthName(month)} total`} value={money(t?.amount)} sub={`${t?.count ?? 0} constant expense(s)`} />
        <Kpi icon={Check} color="green" label="Approved" value={money(t?.approved)} sub={`${t?.approved_count ?? 0} approved`} />
        <Kpi icon={Clock} color="orange" label="Not approved" value={money(t?.pending)} sub={`${t?.pending_count ?? 0} waiting`} />
        <Kpi icon={XCircle} color="red" label="Rejected" value={money(t?.rejected)} sub={`${t?.rejected_count ?? 0} rejected`} />
        <Kpi icon={Repeat} color="blue" label="Active recurring" value={all.data?.activeTemplates ?? '—'} sub="running this month" />
      </div>
      <Card pad={false}>
        <div className="card-toolbar">
          <MonthPicker value={month} onChange={m => { setMonth(m); setQ({ page: 1 }); }} />
          <div className="search"><Search /><input className="input" placeholder="Search expense, vendor, ref #…" value={q.q} onChange={e => setQ({ q: e.target.value })} aria-label="Search constant expenses" /></div>
          <div style={{ width: 210 }}><Select value={q.category_id} onChange={x => setQ({ category_id: x })} options={[{ value: '', label: 'All categories' }, ...tree.map(x => ({ value: String(x.id), label: x.name }))]} ariaLabel="Category filter" /></div>
          <div style={{ width: 180 }}><Select value={q.office} onChange={x => setQ({ office: x })} options={[{ value: '', label: 'All offices' }, ...(meta?.offices || ['Office 1','Office 2','Office 3','Office 4']).map(name => ({ value: name, label: name }))]} ariaLabel="Office filter" /></div>
          <div className="spacer" />
          <ExportButtons dataset="constant-cycles" params={{ month, status: q.status, category_id: q.category_id, location: q.office, q: search, sort: q.sort, dir: q.dir }} />
        </div>
        <CardTabs value={q.status} onChange={s => setQ({ status: s })} tabs={[
          { value: '', label: 'All', count: t?.count }, { value: 'pending', label: 'Not approved', count: t?.pending_count, icon: Clock },
          { value: 'approved', label: 'Approved', count: t?.approved_count, icon: Check }, { value: 'rejected', label: 'Rejected', count: t?.rejected_count, icon: XCircle }]} />
        {bulk.bar}
        {list.error && <div className="card-body"><Notice type="error">{list.error.message}</Notice></div>}
        <ServerTable columns={columns} data={list.data} loading={list.loading} query={q} onQuery={setQ} onRowClick={r => setOpen(r.id)}
          selectable={approver} selected={bulk.selected} onSelect={bulk.setSelected} canSelect={canSelect}
          empty={all.data?.activeTemplates ? 'Nothing matches these filters.' : 'No constant expenses yet. Click “Add constant expense” — enter rent, bills, subscriptions once and they appear here every month.'}
          footer={d => <tr><td colSpan={columns.length - 1}>This page ({d.rows.length} rows) · approved {money(d.rows.filter(r => r.status === 'approved').reduce((a, r) => a + r.amount, 0))}</td><td className="num">{money(d.rows.reduce((a, r) => a + r.amount, 0))}</td>{approver && <td />}</tr>} />
        {bulk.modal}
      </Card>
      {open && <ExpenseDetail id={open} onClose={() => setOpen(null)} onChanged={reload} onEdit={e => { setOpen(null); openForm({ record: e, kind: 'cycle' }); }} />}
    </>
  );
}

// ═════════ Recurring master list (enter once, edit later) ═════════
const SETUP_TABS = [
  { value: 'all', label: 'All' }, { value: 'active', label: 'Active', p: { status: 'approved', state: 'active' } }, { value: 'pending', label: 'Not approved', p: { status: 'pending' } },
  { value: 'paused', label: 'Paused', p: { state: 'paused' } }, { value: 'ended', label: 'Ended', p: { state: 'ended' } },
];
function RecurringList({ v, openForm, bump, onBulk }) {
  const { meta } = useExpenseMeta();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useTableQuery({ category_id: '', frequency: '', office: '', q: '', sort: 'created', dir: 'desc' });
  const [open, setOpen] = useState(null);
  const search = useDebounced(q.q);
  const p = SETUP_TABS.find(x => x.value === tab)?.p || {};
  const list = useServerList('/expenses/recurring', { ...p, category_id: q.category_id, frequency: q.frequency, office: q.office, q: search, page: q.page, limit: q.limit, sort: q.sort, dir: q.dir }, [v]);
  const all = useServerList('/expenses/recurring', { limit: 1 }, [v]);
  const t = all.data?.totals;
  const tree = meta?.categories?.constant || [];
  const columns = [
    { key: 'ref_no', label: 'Ref #', sort: 'ref', render: r => <span className="mono">{r.ref_no}</span> },
    { key: 'title', label: 'Expense', sort: 'title', render: r => <div className="cell-2"><b>{r.title}</b><small>{r.category}{r.sub_category && r.sub_category !== r.title ? ` › ${r.sub_category}` : ''}</small></div> },
    { key: 'paid_to', label: 'Paid to' },
    { key: 'location', label: 'Office', render: r => r.location || '—' },
    { key: 'frequency', label: 'Repeats', render: r => <span className="cell-2"><b>{FREQ[r.frequency]}</b><small>{ordinal(r.billing_day)} · from {monthName(r.start_month, true)} {r.start_month.slice(0, 4)}{r.end_month ? ` to ${monthName(r.end_month, true)} ${r.end_month.slice(0, 4)}` : ''}</small></span> },
    { key: 'next_due', label: 'Next due', render: r => (r.next_due ? date(r.next_due) : '—') },
    { key: 'cycles', label: 'Cycles', align: 'center', render: r => <span title={`${r.pending_cycles} not approved`}>{r.cycles}{r.pending_cycles ? <span className="text-orange"> ({r.pending_cycles})</span> : null}</span> },
    { key: 'status', label: 'Status', sort: 'status', render: r => <span className="row" style={{ gap: 4 }}><StatusBadge status={r.status} hold={r.on_hold} />{r.state !== 'active' && <Badge tone="grey">{titleCase(r.state)}</Badge>}{r.auto_approve && <Badge tone="blue" ><Zap size={11} />Auto</Badge>}</span> },
    { key: 'per_month', label: 'Per month', money: true },
    { key: 'amount', label: 'Amount', sort: 'amount', money: true },
  ];
  return (
    <>
      <div className="grid grid-kpi">
        <Kpi icon={Wallet} color="purple" label="Monthly commitment" value={money(t?.per_month)} sub="Active & approved, per month" />
        <Kpi icon={CalendarRange} color="blue" label="Yearly commitment" value={money((t?.per_month || 0) * 12)} sub="If nothing changes" />
        <Kpi icon={Repeat} color="green" label="Active" value={t?.active ?? '—'} sub={`${t?.count ?? 0} set up in total`} />
        <Kpi icon={Clock} color="orange" label="Not approved" value={t?.pending ?? '—'} sub={`${t?.paused ?? 0} paused`} />
      </div>
      <Card pad={false}>
        <div className="card-toolbar">
          <div className="search"><Search /><input className="input" placeholder="Search title, vendor, ref #…" value={q.q} onChange={e => setQ({ q: e.target.value })} aria-label="Search recurring expenses" /></div>
          <div style={{ width: 230 }}><Select value={q.category_id} onChange={x => setQ({ category_id: x })} options={[{ value: '', label: 'All categories' }, ...tree.map(x => ({ value: String(x.id), label: x.name }))]} ariaLabel="Category filter" /></div>
          <div style={{ width: 170 }}><Select value={q.frequency} onChange={x => setQ({ frequency: x })} options={[{ value: '', label: 'Any frequency' }, ...Object.entries(FREQ).map(([value, label]) => ({ value, label }))]} ariaLabel="Frequency filter" /></div>
          <div style={{ width: 150 }}><Select value={q.office} onChange={x => setQ({ office: x })} options={[{value:'',label:'All offices'}, ...(meta?.offices || ['Office 1','Office 2','Office 3','Office 4']).map(name=>({value:name,label:name}))]} ariaLabel="Office filter" /></div>
          <div className="spacer" />
          <Button size="sm" variant="primary" icon={Plus} onClick={onBulk}>Set up multiple</Button>
          <ExportButtons dataset="recurring" params={{ ...p, category_id: q.category_id, frequency: q.frequency, office: q.office, q: search }} />
        </div>
        <CardTabs value={tab} onChange={x => { setTab(x); setQ({ page: 1 }); }} tabs={SETUP_TABS.map(x => ({ value: x.value, label: x.label, count: x.value === 'all' ? t?.count : x.value === 'active' ? t?.active : x.value === 'pending' ? t?.pending : x.value === 'paused' ? t?.paused : undefined }))} />
        <ServerTable columns={columns} data={list.data} loading={list.loading} query={q} onQuery={setQ} onRowClick={r => setOpen(r.id)}
          empty="No recurring constant expenses here. Add rent, utilities, subscriptions, retainers… once and they repeat automatically." />
      </Card>
      {open && <RecurringDetail id={open} onClose={() => setOpen(null)} onChanged={() => { list.reload(); all.reload(); bump(); }} onEdit={r => { setOpen(null); openForm({ record: r, kind: 'template' }); }} />}
    </>
  );
}


const blankBulkRow = id => ({ id, category: { category_id: '', sub_category_id: '', sub_category_other: '', save_option: false }, amount: '', paid_to: '', title: '', location: '', reference_no: '', billing_day: '1' });

function BatchConstantSetup({ onClose, onSaved }) {
  const { meta, error: metaError } = useExpenseMeta();
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([blankBulkRow(1), blankBulkRow(2)]);
  const [nextId, setNextId] = useState(3);
  const [settings, setSettings] = useState({ frequency: 'monthly', start_month: thisMonth(), payment_method: 'Bank Transfer', reminder_days: '3', reminder_channels: ['app', 'email'], auto_approve: false });
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const tree = meta?.categories?.constant || [];
  const setCommon = (key, value) => setSettings(s => ({ ...s, [key]: value }));
  const patchRow = (id, patch) => setRows(list => list.map(r => r.id === id ? { ...r, ...patch } : r));
  const patchCategory = (id, category) => patchRow(id, { category });
  const toggleChannel = channel => setSettings(s => ({ ...s, reminder_channels: s.reminder_channels.includes(channel) ? s.reminder_channels.filter(x => x !== channel) : [...s.reminder_channels, channel] }));
  const save = async () => {
    setErr('');
    const active = rows.filter(r => r.category.category_id || r.amount || r.paid_to.trim() || r.title.trim());
    const nextErrors = {};
    if (!active.length) { setErr('Add at least one expense row.'); return; }
    if (!settings.reminder_channels.length) { setErr('Choose at least one reminder channel.'); return; }
    const items = [];
    for (const row of active) {
      const ce = checkCategory(tree, row.category);
      const re = {};
      if (!(Number(row.amount) > 0)) re.amount = 'Enter an amount';
      if (!row.paid_to.trim()) re.paid_to = 'Enter vendor / payee';
      if (!row.location.trim()) re.location = 'Select an office / branch';
      if (Object.keys(ce).length || Object.keys(re).length) nextErrors[row.id] = { ...ce, ...re };
      const cat = tree.find(x => String(x.id) === String(row.category.category_id));
      const sub = cat?.subs?.find(x => String(x.id) === String(row.category.sub_category_id));
      const itemName = sub?.name || row.category.sub_category_other?.trim() || cat?.name || '';
      items.push({
        ...categoryPayload(row.category), title: row.title.trim() || itemName, amount: row.amount, paid_to: row.paid_to.trim(),
        payment_method: settings.payment_method, location: row.location.trim(), reference_no: row.reference_no.trim(),
        frequency: settings.frequency, billing_day: Number(row.billing_day), start_month: settings.start_month,
        reminder_days: Number(settings.reminder_days), reminder_channels: settings.reminder_channels, auto_approve: settings.auto_approve,
      });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setErr('Please complete the highlighted fields. Empty rows are ignored.'); return; }
    setBusy(true);
    try {
      const result = await api.post('/expenses/recurring/bulk', { items });
      toast.success(`${result.count} fixed expense(s) saved${result.generated ? ` · ${result.generated} monthly cycle(s) created` : ' · sent for approval'}.`);
      onSaved?.(result);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };
  const approver = can('expense_approve', 'edit');
  return (
    <Modal open onClose={onClose} size="xl" title="Set up multiple fixed expenses" subtitle="Add your regular expenses together. Each row can have its own due day; the schedule and reminder preferences are shared." 
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!meta || Boolean(metaError)} onClick={save}>Save all expenses</Button></>}>
      {metaError ? <Notice type="error">{metaError.message}</Notice> : !meta ? <Loader /> : <div className="stack bulk-constant-setup">
        {err && <Notice type="error">{err}</Notice>}
        <div className="form-section"><span>1</span>Common schedule & reminders</div>
        <div className="form-grid">
          <Field label="Repeat frequency" required><Select value={settings.frequency} onChange={x => setCommon('frequency', x)} options={meta.frequencies} ariaLabel="Recurring frequency" /></Field>
          <Field label="Start from" required><MonthPicker value={settings.start_month} onChange={x => setCommon('start_month', x)} /></Field>
          <Field label="Default payment method"><Select value={settings.payment_method} onChange={x => setCommon('payment_method', x)} options={meta.methods} ariaLabel="Default payment method" /></Field>
          <Field label="Remind me before due date"><Select value={settings.reminder_days} onChange={x => setCommon('reminder_days', x)} options={[{ value: '0', label: 'On due date' }, { value: '1', label: '1 day before' }, { value: '3', label: '3 days before' }, { value: '7', label: '7 days before' }, { value: '14', label: '14 days before' }, { value: '30', label: '30 days before' }]} ariaLabel="Reminder lead time" /></Field>
        </div>
        <Field label="Send reminders through" hint="In-app notifications work automatically. Email needs SMTP settings; WhatsApp needs Meta Cloud API credentials and an approved template.">
          <div className="row wrap" style={{ gap: 14 }}>
            {[['app', 'In-app'], ['email', 'Email'], ['whatsapp', 'WhatsApp']].map(([value, label]) => <label className="check" key={value}><input type="checkbox" checked={settings.reminder_channels.includes(value)} onChange={() => toggleChannel(value)} /><span>{label}</span></label>)}
          </div>
        </Field>
        {approver && <label className="check option-card"><input type="checkbox" checked={settings.auto_approve} onChange={e => setCommon('auto_approve', e.target.checked)} /><span><b><Zap size={14} style={{ verticalAlign: -2 }} /> Auto-approve all new monthly cycles</b><br /><small className="muted">Only turn this on for fixed, predictable payments that do not need monthly review.</small></span></label>}
        <div className="form-section"><span>2</span>Expense details</div>
        <div className="bulk-constant-list">
          {rows.map((row, index) => (
            <div className="bulk-constant-row" key={row.id}>
              <div className="bulk-constant-row-head"><b>Expense {index + 1}</b>{rows.length > 1 && <Button size="xs" variant="ghost" icon={Trash2} onClick={() => setRows(list => list.filter(x => x.id !== row.id))}>Remove</Button>}</div>
              <div className="bulk-constant-grid">
                <div className="bulk-category-picker"><CategoryPicker tree={tree} value={row.category} onChange={value => patchCategory(row.id, value)} errors={{ category: errors[row.id]?.category, item: errors[row.id]?.item, other: errors[row.id]?.other }} canSave={can('expenses', 'edit')} /></div>
                <Field label="Amount (PKR) *" error={errors[row.id]?.amount}><MoneyInput value={row.amount} onChange={value => patchRow(row.id, { amount: value })} /></Field>
                <Field label="Paid to / vendor *" error={errors[row.id]?.paid_to}><input className="input" value={row.paid_to} maxLength={160} onChange={e => patchRow(row.id, { paid_to: e.target.value })} placeholder="Landlord, internet provider…" /></Field>
                <Field label="Due day"><Select value={row.billing_day} onChange={value => patchRow(row.id, { billing_day: value })} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: ordinal(i + 1) }))} ariaLabel={`Due day for expense ${index + 1}`} /></Field>
                <Field label="Short title (optional)"><input className="input" value={row.title} maxLength={160} onChange={e => patchRow(row.id, { title: e.target.value })} placeholder="e.g. Office rent" /></Field>
                <Field label="Office *" error={errors[row.id]?.location}><Select value={row.location} onChange={value => patchRow(row.id, { location: value })} options={[{value:"",label:"Select office / branch"}, ...(meta.offices || ['Office 1','Office 2','Office 3','Office 4']).map(name=>({value:name,label:name}))]} ariaLabel={`Office for expense ${index + 1}`} /></Field>
                <Field label="Account / reference no."><input className="input" value={row.reference_no} maxLength={80} onChange={e => patchRow(row.id, { reference_no: e.target.value })} placeholder="Optional account ID" /></Field>
              </div>
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Button variant="secondary" icon={Plus} disabled={rows.length >= 50} onClick={() => { setRows(list => [...list, blankBulkRow(nextId)]); setNextId(x => x + 1); }}>Add another expense</Button>
          <span className="small muted">{rows.filter(r => r.category.category_id || r.amount || r.paid_to.trim()).length} row(s) ready to configure · up to 50</span>
        </div>
      </div>}
    </Modal>
  );
}

function RecurringDetail({ id, onClose, onChanged, onEdit }) {
  const { user, isAdmin, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [cycle, setCycle] = useState(null);
  const load = () => api.get(`/expenses/recurring/${id}`).then(setD).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const approver = can('expense_approve', 'edit');
  const act = async (key, fn, msg) => { setBusy(key); try { const r = await fn(); toast.success(typeof msg === 'function' ? msg(r) : msg); onChanged(); await load(); } catch (e) { toast.error(e.message); } finally { setBusy(''); } };
  if (!d) return <Modal open onClose={onClose} title="Constant expense" size="lg"><Loader /></Modal>;
  const own = d.created_by === user.id;
  const mayReview = approver && (isAdmin || !own);
  const mayEdit = isAdmin || (can('expenses', 'edit') && d.status === 'pending' && own);
  return (
    <>
      <Modal open onClose={onClose} size="xl" title={`${d.ref_no} · ${d.title}`} subtitle={`${d.category}${d.sub_category ? ' › ' + d.sub_category : ''}`}
        footer={<>
          {isAdmin && <Button variant="danger" icon={Trash2} onClick={async () => { if (await confirm({ title: 'Delete this constant expense?', message: 'Only possible while no month has been approved or rejected. Otherwise use End.', danger: true, ok: 'Delete' })) act('del', () => api.del(`/expenses/recurring/${id}`), 'Deleted.').then(onClose); }}>Delete</Button>}
          {mayEdit && <Button icon={Pencil} onClick={() => onEdit(d)}>Edit</Button>}
          <div className="spacer" />
          {approver && d.state === 'active' && <Button icon={Pause} loading={busy === 'paused'} onClick={() => act('paused', () => api.post(`/expenses/recurring/${id}/state`, { state: 'paused' }), 'Paused — no new months are created until you resume.')}>Pause</Button>}
          {approver && d.state !== 'active' && <Button icon={Play} loading={busy === 'active'} onClick={() => act('active', () => api.post(`/expenses/recurring/${id}/state`, { state: 'active' }), 'Resumed.')}>Resume</Button>}
          {approver && d.state !== 'ended' && <Button icon={Square} loading={busy === 'ended'} onClick={async () => { if (await confirm({ title: 'End this constant expense?', message: `No cycles will be created after ${monthName(thisMonth())}. Past months stay in the books.`, ok: 'End it' })) act('ended', () => api.post(`/expenses/recurring/${id}/state`, { state: 'ended' }), 'Ended.'); }}>End</Button>}
          {mayReview && d.status !== 'rejected' && <Button icon={X} onClick={() => setRejecting(true)}>Reject</Button>}
          {mayReview && d.status !== 'approved' && <Button variant="success" icon={Check} loading={busy === 'approve'} onClick={() => act('approve', () => api.post(`/expenses/recurring/${id}/review`, { status: 'approved' }), r => `Approved — ${r.generated} cycle(s) created.`)}>Approve</Button>}
        </>}>
        <div className="grid grid-main">
          <div className="stack" style={{ gap: 14 }}>
            <div className="detail-amount"><span>{money(d.amount)}<small> / {d.frequency === 'monthly' ? 'month' : FREQ[d.frequency].toLowerCase()}</small></span><span className="row" style={{ gap: 6 }}><StatusBadge status={d.status} /><Badge tone={d.state === 'active' ? 'green' : 'grey'}>{titleCase(d.state)}</Badge></span></div>
            {own && approver && !isAdmin && d.status === 'pending' && <Notice type="info">You set this up, so another approver must approve it.</Notice>}
            {d.status === 'pending' && <Notice type="warn">No monthly cycles are created until this is approved.</Notice>}
            <dl className="dl">
              <dt>Schedule</dt><dd>{FREQ[d.frequency]} on the {ordinal(d.billing_day)} · from {monthName(d.start_month)}{d.end_month ? ` to ${monthName(d.end_month)}` : ' (no end)'}</dd>
              <dt>Next due</dt><dd>{d.next_due ? date(d.next_due) : '—'}</dd>
              <dt>Reminder</dt><dd>{Number(d.reminder_days ?? 3) === 0 ? 'On due date' : `${d.reminder_days ?? 3} day(s) before`} · {(d.reminder_channels || ['app', 'email']).map(x => ({ app: 'In-app', email: 'Email', whatsapp: 'WhatsApp' }[x] || x)).join(', ')}</dd>
              <dt>Per month</dt><dd>{money(d.per_month)}</dd>
              <dt>Auto-approve</dt><dd>{d.auto_approve ? 'Yes — each new cycle is approved automatically' : 'No — approve each cycle'}</dd>
              <dt>Paid to</dt><dd>{d.paid_to}</dd><dt>Method</dt><dd>{d.payment_method}</dd>
              <dt>Office</dt><dd>{d.location || 'Not assigned'}</dd><dt>Reference</dt><dd>{d.reference_no || '—'}</dd>
              <dt>Description</dt><dd>{d.description || '—'}</dd>
              <dt>Entered by</dt><dd>{d.entered_by} · {dateTime(d.created_at)}</dd>
              {d.reviewed_by_name && <><dt>Reviewed</dt><dd>{d.reviewed_by_name} · {dateTime(d.reviewed_at)}{d.review_note ? ` · “${d.review_note}”` : ''}</dd></>}
            </dl>
            <Card title="Monthly cycles" subtitle={`${d.cycles.length} shown`} pad={false}>
              <table className="tbl"><thead><tr><th>Month</th><th>Ref #</th><th>Due</th><th>Status</th><th className="num">Amount</th></tr></thead><tbody>
                {d.cycles.map(c => <tr key={c.id} className="clickable" onClick={() => setCycle(c.id)}><td>{monthName(c.cycle_month)}</td><td className="mono">{c.ref_no}</td><td>{date(c.expense_date)}</td><td><StatusBadge status={c.status} /></td><td className="num">{money(c.amount)}</td></tr>)}
                {!d.cycles.length && <tr><td colSpan={5} className="tbl-empty">No cycles yet.</td></tr>}
              </tbody></table>
            </Card>
          </div>
          <div className="stack" style={{ gap: 14 }}>
            {d.overrides.length > 0 && <Card title="Changed future months">{d.overrides.map(o => <div key={o.cycle_month} className="list-row"><span>{monthName(o.cycle_month)}</span><span>{o.action === 'skip' ? <Badge tone="grey">Skipped</Badge> : <b>{money(o.amount)}</b>}{o.note && <small className="muted"> · {o.note}</small>}</span></div>)}</Card>}
            <Card title={<span className="row" style={{ gap: 6 }}><History size={16} />History</span>}><HistoryTimeline items={d.history} /></Card>
          </div>
        </div>
      </Modal>
      <ReasonModal open={rejecting} busy={busy === 'reject'} onClose={() => setRejecting(false)} onSubmit={note => act('reject', () => api.post(`/expenses/recurring/${id}/review`, { status: 'rejected', note }), 'Rejected.').then(() => setRejecting(false))} />
      {cycle && <ExpenseDetail id={cycle} onClose={() => setCycle(null)} onChanged={() => { onChanged(); load(); }} />}
    </>
  );
}

// ═════════ Upcoming months (manage future cycles) ═════════
function Upcoming({ v, bump }) {
  const c = useColors();
  const { can } = useAuth();
  const toast = useToast();
  const [months, setMonths] = useState(6);
  const data = useServerList('/expenses/recurring/upcoming', { months }, [v]);
  const [edit, setEdit] = useState(null);
  const approver = can('expense_approve', 'edit');
  const override = async (item, month, action, amount, note) => {
    try { await api.post(`/expenses/recurring/${item.recurring_id}/override`, { month, action, amount, note }); toast.success(action === 'skip' ? `${item.title} skipped for ${monthName(month)}.` : action === 'clear' ? 'Back to the normal amount.' : 'Amount changed for that month.'); setEdit(null); data.reload(); bump(); }
    catch (e) { toast.error(e.message); }
  };
  if (!data.data) return <Loader />;
  const ms = data.data.months;
  return (
    <>
      <Card title="Coming up" subtitle="Approved constant expenses for the next months (skips and changed amounts included)" actions={<Segmented value={months} onChange={setMonths} options={[{ value: 3, label: '3 months' }, { value: 6, label: '6 months' }, { value: 12, label: '12 months' }]} />}>
        <SimpleBars data={ms.map(m => ({ month: m.month, total: m.total }))} height={220} keys={[{ key: 'total', label: 'Constant expenses', color: c.c4 }]} />
      </Card>
      <div className="grid grid-3">
        {ms.map(m => (
          <Card key={m.month} title={m.label} subtitle={`${m.count} expense(s)`} actions={<b className="mono">{money(m.total)}</b>}>
            {m.items.length ? m.items.map(it => (
              <div key={it.recurring_id} className={`up-item ${it.skipped ? 'skipped' : ''}`}>
                <div style={{ minWidth: 0 }}>
                  <b>{it.title}</b>
                  <small>{date(it.due_date)} · {it.category}</small>
                  <div className="row" style={{ gap: 4, marginTop: 3 }}>
                    {it.template_status === 'pending' && <Badge tone="orange">Setup not approved</Badge>}
                    {it.skipped && <Badge tone="grey">Skipped</Badge>}
                    {it.override?.action === 'amount' && <Badge tone="blue">Changed from {money(it.base_amount)}</Badge>}
                    {it.cycle && <StatusBadge status={it.cycle.status} />}
                  </div>
                </div>
                <div className="up-side">
                  <b className="mono">{it.skipped ? '—' : money(it.amount)}</b>
                  {approver && !(it.cycle && it.cycle.status !== 'pending') && (
                    <span className="row" style={{ gap: 2 }}>
                      {it.override ? <Button size="sm" variant="ghost" icon={Undo2} title="Undo change" aria-label="Undo change" onClick={() => override(it, m.month, 'clear')} />
                        : <><Button size="sm" variant="ghost" icon={Pencil} title="Change amount for this month" aria-label="Change amount" onClick={() => setEdit({ it, month: m.month, amount: String(it.amount), note: '' })} />
                          <Button size="sm" variant="ghost" icon={SkipForward} title="Skip this month" aria-label="Skip month" onClick={() => override(it, m.month, 'skip', null, 'Skipped from Upcoming')} /></>}
                    </span>
                  )}
                </div>
              </div>
            )) : <div className="muted small">Nothing due.</div>}
          </Card>
        ))}
      </div>
      {edit && (
        <Modal open onClose={() => setEdit(null)} size="sm" title={`${edit.it.title} — ${monthName(edit.month)}`} subtitle={`Normal amount ${money(edit.it.base_amount)}`}
          footer={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={!(Number(edit.amount) > 0)} onClick={() => override(edit.it, edit.month, 'amount', edit.amount, edit.note)}>Save for this month</Button></>}>
          <div className="form">
            <Field label="Amount for this month only (PKR)" required><MoneyInput value={edit.amount} onChange={x => setEdit(s => ({ ...s, amount: x }))} autoFocus /></Field>
            <Field label="Note"><Textarea rows={2} maxLength={300} value={edit.note} onChange={e => setEdit(s => ({ ...s, note: e.target.value }))} placeholder="e.g. Rent increase from landlord" /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
