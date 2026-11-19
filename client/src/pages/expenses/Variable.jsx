import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, BarChart3, Check, Clock, FileText, Hash, Receipt, Search, TrendingUp, X, XCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { api, fileUrl } from '../../lib/api.js';
import { useDebounced, useServerList, useTableQuery } from '../../lib/useServerList.js';
import { Button, Card, Kpi, Notice, Select, useToast } from '../../components/ui.jsx';
import { BarsLines, Donut, ShareList, useColors } from '../../components/charts.jsx';
import ServerTable, { CardTabs, FilterChips } from '../../components/ServerTable.jsx';
import { money, date } from '../../lib/format.js';
import { ExpenseDetail, ExportButtons, ReasonModal, StatusBadge, useBulkReview, useExpenseMeta } from './shared.jsx';

const dayLabel = k => (/^\d{4}-\d{2}-\d{2}$/.test(k) ? new Date(k + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : k);

/** Quick approve / reject buttons inside a table row. */
export function RowReview({ row, endpoint, onDone, approveStatus = 'approved' }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState(false);
  const go = async (status, note) => {
    setBusy(status);
    try { await api.post(endpoint, { status, note }); toast.success(status === 'rejected' ? 'Rejected.' : approveStatus === 'verified' ? 'Receipt marked valid.' : 'Approved.'); setAsking(false); onDone?.(); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  return (
    <span className="row-actions" onClick={e => e.stopPropagation()}>
      <Button size="sm" variant="success" icon={Check} loading={busy === approveStatus} onClick={() => go(approveStatus)} title={approveStatus === 'verified' ? 'Receipt is valid' : 'Approve'} aria-label="Approve" />
      <Button size="sm" icon={X} onClick={() => setAsking(true)} title="Reject" aria-label="Reject" />
      <ReasonModal open={asking} busy={busy === 'rejected'} onClose={() => setAsking(false)} onSubmit={note => go('rejected', note)} />
    </span>
  );
}

export function ReceiptCell({ row, optional }) {
  if (!row.receipt_file_id) {
    if (optional) return <span className="muted" title="No bill attached yet">—</span>;
    return <span className="rc-cell warn" title={row.no_receipt_reason ? `No receipt: ${row.no_receipt_reason}` : 'No receipt'}><AlertTriangle size={14} />None</span>;
  }
  return <a href={fileUrl(row.receipt_file_id)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="rc-cell" title={row.receipt_name || 'Open receipt'}><FileText size={14} />View{row.receipt_duplicate_of && <AlertTriangle size={14} color="var(--orange)" aria-label="Possible duplicate" />}</a>;
}

/** "Vendor" with a small second line. */
export const twoLine = (a, b) => <div className="cell-2"><span>{a || '—'}</span><small>{b}</small></div>;

export const itemCell = r => <div className="cell-2"><b>{r.sub_category || r.category}</b><small>{r.budget_holder_name ? `Budget · ${r.budget_holder_name} · ` : ''}{r.sub_category ? r.category : ''}{r.title && r.title !== r.sub_category ? `${r.sub_category ? ' · ' : ''}${r.title}` : ''}</small></div>;

export default function Variable({ range, v, openForm }) {
  const { user, isAdmin, can } = useAuth();
  const { meta } = useExpenseMeta();
  const [sp] = useSearchParams();
  const c = useColors();
  const [q, setQ, resetQ] = useTableQuery({ status: '', category_id: sp.get('category_id') || '', sub_category_id: '', sub_category: '', method: '', location: '', receipt: '', q: '', sort: 'date', dir: 'desc' });
  const [open, setOpen] = useState(null);
  const search = useDebounced(q.q);
  const filters = { type: 'variable', ...range, status: q.status, category_id: q.category_id, sub_category_id: q.sub_category_id, sub_category: q.sub_category, method: q.method, location: q.location, receipt: q.receipt, q: search };
  const list = useServerList('/expenses', { ...filters, page: q.page, limit: q.limit, sort: q.sort, dir: q.dir }, [v]);
  const an = useServerList('/expenses/analytics', { ...filters, status: '' }, [v]);
  const reload = () => { list.reload(); an.reload(); };
  const approver = can('expense_approve', 'edit');
  const bulk = useBulkReview('/expenses/review/bulk', { onDone: reload });
  useEffect(() => { bulk.setSelected(new Set()); }, [q.status, q.category_id, q.page, range.from, range.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = meta?.categories?.variable || [];
  const cat = tree.find(x => String(x.id) === String(q.category_id));
  const subName = cat?.subs.find(s => String(s.id) === String(q.sub_category_id))?.name || q.sub_category;
  const k = an.data?.kpi;
  const chips = [
    { key: 'cat', label: 'Category', value: cat?.name, onRemove: () => setQ({ category_id: '', sub_category_id: '', sub_category: '' }) },
    { key: 'sub', label: 'Item', value: subName, onRemove: () => setQ({ sub_category_id: '', sub_category: '' }) },
    { key: 'method', label: 'Method', value: q.method, onRemove: () => setQ({ method: '' }) },
    { key: 'loc', label: 'Department', value: q.location, onRemove: () => setQ({ location: '' }) },
    { key: 'rc', label: 'Receipt', value: q.receipt === 'missing' ? 'Missing' : q.receipt === 'attached' ? 'Attached' : '', onRemove: () => setQ({ receipt: '' }) },
    { key: 'q', label: 'Search', value: q.q, onRemove: () => setQ({ q: '' }) },
  ];
  const trend = useMemo(() => (an.data?.trend || []).map(t => ({ ...t, label: an.data.granularity === 'day' ? dayLabel(t.key) : t.key })), [an.data]);
  const canSelect = r => approver && (isAdmin || r.created_by !== user.id);
  const pickCat = it => setQ(String(q.category_id) === String(it.id) ? { category_id: '', sub_category_id: '', sub_category: '' } : { category_id: it.id ? String(it.id) : '', sub_category_id: '', sub_category: '' });
  const pickSub = it => (it.id ? setQ({ sub_category_id: String(q.sub_category_id) === String(it.id) ? '' : String(it.id), sub_category: '' }) : setQ({ sub_category: q.sub_category === it.name ? '' : it.name, sub_category_id: '' }));

  const columns = [
    { key: 'expense_date', label: 'Date · Ref #', sort: 'date', render: r => twoLine(date(r.expense_date), <span className="mono">{r.ref_no}</span>) },
    { key: 'item', label: 'Expense item', sort: 'sub', render: itemCell },
    { key: 'paid_to', label: 'Paid to', sort: 'paid_to', render: r => twoLine(r.paid_to, [r.location, r.payment_method].filter(Boolean).join(' · ')) },
    { key: 'entered_by', label: 'Entered by', sort: 'entered_by', className: 'hide-md', render: r => r.entered_by || '—' },
    { key: 'receipt', label: 'Receipt', render: r => <ReceiptCell row={r} /> },
    { key: 'status', label: 'Status', sort: 'status', render: r => <StatusBadge status={r.status} hold={r.on_hold} /> },
    { key: 'amount', label: 'Amount', sort: 'amount', money: true },
    ...(approver ? [{ key: 'act', label: '', render: r => (r.status === 'pending' && canSelect(r) ? <RowReview row={r} endpoint={`/expenses/${r.id}/review`} onDone={reload} /> : null) }] : []),
  ];

  return (
    <div className="stack">
      <Card pad={false} className="filter-card">
        <div className="filters">
          <div className="search wide"><Search /><input className="input" placeholder="Search title, ref #, vendor, item, bill no…" value={q.q} onChange={e => setQ({ q: e.target.value })} aria-label="Search expenses" /></div>
          <Select value={q.category_id} onChange={x => setQ({ category_id: x, sub_category_id: '', sub_category: '' })} options={[{ value: '', label: 'All categories' }, ...tree.map(x => ({ value: String(x.id), label: x.name }))]} searchable ariaLabel="Category filter" />
          <Select value={q.sub_category_id} disabled={!cat || !cat.subs.length} onChange={x => setQ({ sub_category_id: x, sub_category: '' })} placeholder={cat ? 'All items' : 'Pick a category first'} options={[{ value: '', label: 'All items' }, ...(cat?.subs || []).map(s => ({ value: String(s.id), label: s.name }))]} searchable ariaLabel="Expense item filter" />
          <Select value={q.method} onChange={x => setQ({ method: x })} options={[{ value: '', label: 'All methods' }, ...(meta?.methods || [])]} ariaLabel="Payment method filter" />
          <Select value={q.location} onChange={x => setQ({ location: x })} options={[{ value: '', label: 'All departments' }, ...(meta?.departments || [])]} ariaLabel="Department filter" />
          <Select value={q.receipt} onChange={x => setQ({ receipt: x })} options={[{ value: '', label: 'Any receipt' }, { value: 'attached', label: 'Receipt attached' }, { value: 'missing', label: 'No receipt' }]} ariaLabel="Receipt filter" />
        </div>
        <div className="filters-foot"><FilterChips items={chips} onClear={() => resetQ({ sort: q.sort, dir: q.dir })} /></div>
      </Card>

      {an.error && <Notice type="error">{an.error.message}</Notice>}
      <div className="grid grid-kpi">
        <Kpi icon={TrendingUp} color="blue" label="Total (filtered)" value={money(k?.amount)} sub={`${k?.count ?? 0} entries`} />
        <Kpi icon={Check} color="green" label="Approved" value={money(k?.approved)} sub={`${k?.approved_count ?? 0} entries`} />
        <Kpi icon={Clock} color="orange" label="Not approved" value={money(k?.pending)} sub={`${k?.pending_count ?? 0} waiting`} />
        <Kpi icon={XCircle} color="red" label="Rejected" value={money(k?.rejected)} sub={`${k?.rejected_count ?? 0} entries`} />
        <Kpi icon={Hash} color="purple" label="Average entry" value={money(Math.round(k?.average || 0))} sub={`Largest ${money(k?.largest)}`} />
      </div>

      <div className="grid grid-main">
        <Card title="Spending trend" subtitle={`${an.data?.granularity === 'day' ? 'Daily' : 'Monthly'} · approved vs not approved`}>
          <BarsLines data={trend} xKey="label" height={300} bars={[{ key: 'approved', label: 'Approved', color: c.c2 }, { key: 'pending', label: 'Not approved', color: c.c3 }]} />
        </Card>
        <Card title="By category" subtitle="Click to filter">
          <Donut data={an.data?.byCategory || []} center={money(k?.amount, { short: true })} centerSub="This view" onSelect={pickCat} active={q.category_id} height={180} />
          <ShareList items={(an.data?.byCategory || []).slice(0, 4)} onSelect={pickCat} active={q.category_id} />
        </Card>
      </div>
      <div className="grid grid-3">
        <Card title="Top expense items" subtitle="Click to filter"><ShareList items={an.data?.bySub || []} colorIndex={1} onSelect={pickSub} active={q.sub_category_id || q.sub_category} /></Card>
        <Card title="By payment method" subtitle="Click to filter"><ShareList items={an.data?.byMethod || []} colorIndex={3} onSelect={it => setQ({ method: q.method === it.name ? '' : it.name })} active={q.method} /></Card>
        <Card title="By department" subtitle="Click to filter"><ShareList items={an.data?.byLocation || []} colorIndex={5} onSelect={it => it.name !== 'Not set' && setQ({ location: q.location === it.name ? '' : it.name })} active={q.location} /></Card>
      </div>

      <Card pad={false}>
        <CardTabs value={q.status} onChange={s => setQ({ status: s })} right={<ExportButtons dataset="variable-expenses" params={{ ...filters, sort: q.sort, dir: q.dir }} />} tabs={[
          { value: '', label: 'All', count: k?.count, icon: Receipt }, { value: 'pending', label: 'Not approved', count: k?.pending_count, icon: Clock },
          { value: 'approved', label: 'Approved', count: k?.approved_count, icon: Check }, { value: 'rejected', label: 'Rejected', count: k?.rejected_count, icon: XCircle }]} />
        {bulk.bar}
        {list.error && <div className="card-body"><Notice type="error">{list.error.message}</Notice></div>}
        <ServerTable columns={columns} data={list.data} loading={list.loading} query={q} onQuery={setQ} onRowClick={r => setOpen(r.id)}
          selectable={approver} selected={bulk.selected} onSelect={bulk.setSelected} canSelect={canSelect}
          empty={search || q.category_id || q.status ? 'No expenses match these filters. Clear a filter or change the dates.' : 'No variable expenses in this period yet.'}
          footer={d => <tr><td colSpan={columns.length + (approver ? 1 : 0) - (approver ? 2 : 1)}>This page ({d.rows.length} rows) · all {d.total} filtered rows = {money(d.totals.amount)}</td><td className="num">{money(d.rows.reduce((a, r) => a + r.amount, 0))}</td>{approver && <td />}</tr>} />
        {bulk.modal}
      </Card>
      {open && <ExpenseDetail id={open} onClose={() => setOpen(null)} onChanged={reload} onEdit={e => { setOpen(null); openForm({ record: e, kind: 'variable' }); }} />}
      <div className="hint row" style={{ gap: 6 }}><BarChart3 size={14} />Charts and totals follow the same filters as the table. Exports (CSV / PDF) include every row that matches.</div>
    </div>
  );
}
