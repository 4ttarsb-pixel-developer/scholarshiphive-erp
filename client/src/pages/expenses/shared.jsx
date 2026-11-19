import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Download, ExternalLink, FileText, History, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { api, fileUrl, qs } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Badge, Button, Field, Loader, Modal, Notice, Textarea, useConfirm, useToast } from '../../components/ui.jsx';
import { money, date, dateTime, monthName, titleCase, catPath } from '../../lib/format.js';

// ── Expense meta (categories, methods…) cached for the whole session ──
let metaCache = null;
let metaPromise = null;
export function loadMeta(force) {
  if (force) { metaCache = null; metaPromise = null; }
  if (!metaPromise) metaPromise = api.get('/expenses/meta').then(d => { metaCache = d; return d; }).catch(e => { metaPromise = null; throw e; });
  return metaPromise;
}
export function useExpenseMeta() {
  const [meta, setMeta] = useState(metaCache);
  const [error, setError] = useState(null);
  useEffect(() => { let alive = true; loadMeta().then(d => alive && setMeta(d)).catch(e => alive && setError(e)); return () => { alive = false; }; }, []);
  return { meta, error, reload: () => loadMeta(true).then(setMeta) };
}

/** Expense / petty status chip ("pending" reads as "Not approved" / "To verify"). */
export function StatusBadge({ status, petty, hold }) {
  if (hold && status === 'pending') return <Badge tone="grey">On hold</Badge>;
  const label = status === 'pending' ? (petty ? 'To verify' : 'Not approved') : titleCase(status);
  return <Badge status={status}>{label}</Badge>;
}

export const typeBadge = t => <Badge tone={t === 'constant' ? 'purple' : 'cyan'}>{t === 'constant' ? 'Constant' : 'Variable'}</Badge>;

export function ExportButtons({ dataset, params }) {
  const href = f => `/api/export/${dataset}${qs({ ...params, page: undefined, limit: undefined, format: f })}`;
  return (
    <div className="row" style={{ gap: 6 }}>
      <a className="btn btn-sm" href={href('csv')} download title="Excel-ready CSV with totals"><Download />CSV</a>
      <a className="btn btn-sm" href={href('pdf')} download title="Branded PDF report"><FileText />PDF</a>
    </div>
  );
}

export function ReceiptPreview({ id, mime, name }) {
  return (
    <div className="card" style={{ padding: 10 }}>
      {mime?.startsWith('image/') ? <img src={fileUrl(id)} alt="Receipt" style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 8, background: 'var(--surface-2)' }} />
        : <div className="row" style={{ padding: 16 }}><FileText size={30} color="var(--primary)" /><div><b>{name}</b><div className="small muted">PDF receipt</div></div></div>}
      <div className="row" style={{ marginTop: 8 }}><a className="btn btn-sm" href={fileUrl(id)} target="_blank" rel="noreferrer"><ExternalLink />Open full size</a><a className="btn btn-sm" href={fileUrl(id, true)}>Download</a></div>
    </div>
  );
}

const ACTION_TEXT = {
  'expense.create': 'Created', 'expense.update': 'Edited', 'expense.review': 'Status changed', 'expense.delete': 'Deleted',
  'recurring.create': 'Created', 'recurring.update': 'Edited', 'recurring.review': 'Status changed', 'recurring.state': 'State changed', 'recurring.override': 'Future cycle changed', 'recurring.generate': 'Cycles generated',
  'petty.create': 'Created', 'petty.update': 'Edited', 'petty.review': 'Receipt checked', 'petty.topup': 'Top-up added', 'petty.topup_review': 'Top-up status changed',
  'expense.hold': 'Put on hold', 'expense.release': 'Hold released',
};
function describe(h) {
  const d = h.details || {};
  if (d.from && d.to) return `${titleCase(d.from)} → ${titleCase(d.to)}${d.note ? ` · “${d.note}”` : ''}${d.bulk ? ' (bulk)' : ''}`;
  if (d.changes && Object.keys(d.changes).length) return Object.entries(d.changes).map(([k, c]) => `${titleCase(k)}: ${c.from ?? '—'} → ${c.to ?? '—'}`).join(' · ');
  if (d.hold_until !== undefined || (d.note && !d.from)) return [d.hold_until ? `until ${date(d.hold_until)}` : '', d.note ? `“${d.note}”` : '', d.bulk ? '(bulk)' : ''].filter(Boolean).join(' ');
  if (d.month) return `${monthName(d.month)}: ${d.action}${d.amount ? ` ${money(d.amount)}` : ''}${d.note ? ` · ${d.note}` : ''}`;
  if (d.amount) return `${money(d.amount)}${d.status ? ` · ${titleCase(d.status)}` : ''}`;
  return '';
}
export function HistoryTimeline({ items }) {
  if (!items?.length) return <div className="muted small">No history yet.</div>;
  return (
    <ul className="timeline">
      {items.map(h => (
        <li key={h.id}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}><b>{ACTION_TEXT[h.action] || h.action}</b><span className="muted small nowrap">{dateTime(h.created_at)}</span></div>
          <div className="small">{h.user_name}{h.ip ? <span className="muted"> · {h.ip}</span> : null}</div>
          {describe(h) && <div className="small muted" style={{ wordBreak: 'break-word' }}>{describe(h)}</div>}
        </li>
      ))}
    </ul>
  );
}

/** Asks for a reason, then rejects. */
export function ReasonModal({ open, title = 'Reason for rejecting', onClose, onSubmit, busy, ok = 'Reject' }) {
  const [note, setNote] = useState('');
  useEffect(() => { if (open) setNote(''); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" loading={busy} disabled={note.trim().length < 3} onClick={() => onSubmit(note.trim())}>{ok}</Button></>}>
      <Field label="Reason (sent to the person who entered it)" required><Textarea rows={3} autoFocus maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Bill amount does not match the receipt" /></Field>
    </Modal>
  );
}

/** Sticky bar shown while rows are selected. */
export function BulkBar({ count, onApprove, onReject, onClear, busy, approveLabel = 'Approve selected', rejectLabel = 'Reject selected' }) {
  if (!count) return null;
  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <b>{count} selected</b>
      <div className="spacer" />
      <Button size="sm" variant="success" icon={Check} loading={busy === 'approve'} onClick={onApprove}>{approveLabel}</Button>
      <Button size="sm" icon={X} loading={busy === 'reject'} onClick={onReject}>{rejectLabel}</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
}

/** Bulk approve / reject helper for expenses or petty entries. */
export function useBulkReview(endpoint, { onDone, approveStatus = 'approved' } = {}) {
  const toast = useToast();
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState(false);
  const run = async (status, note) => {
    setBusy(status === 'rejected' ? 'reject' : 'approve');
    try {
      const r = await api.post(endpoint, { ids: [...selected], status, note });
      if (r.updated) toast.success(`${r.updated} record(s) ${status === 'verified' ? 'verified' : status}.`);
      if (r.skipped?.length) toast.warn(`${r.skipped.length} skipped: ${[...new Set(r.skipped.map(s => s.reason))].join('; ')}`);
      setSelected(new Set()); setAsking(false); onDone?.();
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  return {
    selected, setSelected, busy,
    bar: <BulkBar count={selected.size} busy={busy} onApprove={() => run(approveStatus)} onReject={() => setAsking(true)} onClear={() => setSelected(new Set())}
      approveLabel={approveStatus === 'verified' ? 'Mark receipts valid' : 'Approve selected'} rejectLabel={approveStatus === 'verified' ? 'Not valid' : 'Reject selected'} />,
    modal: <ReasonModal open={asking} busy={busy === 'reject'} onClose={() => setAsking(false)} onSubmit={note => run('rejected', note)} />,
  };
}

/** Full details of one expense (constant cycle or variable) with approval actions and history. */
export function ExpenseDetail({ id, onClose, onChanged, onEdit }) {
  const { user, isAdmin, can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [e, setE] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const load = () => api.get(`/expenses/${id}`).then(setE).catch(setError);
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const approver = can('expense_approve', 'edit');
  const [holding, setHolding] = useState(false);
  const control = async (action, note, hold_until) => {
    setBusy(action);
    try { const r = await api.post('/cashflow/control/bulk', { ids: [id], action, note, hold_until }); if (r.updated) toast.success(action === 'hold' ? 'Payment put on hold.' : 'Hold released.'); else toast.warn(r.skipped?.[0]?.reason || 'Nothing changed.'); setHolding(false); onChanged?.(); await load(); }
    catch (x) { toast.error(x.message); } finally { setBusy(''); }
  };
  const review = async (status, note) => {
    setBusy(status);
    try { await api.post(`/expenses/${id}/review`, { status, note }); toast.success(status === 'pending' ? 'Moved back to “Not approved”.' : `Expense ${status}.`); setRejecting(false); onChanged?.(); await load(); }
    catch (x) { toast.error(x.message); } finally { setBusy(''); }
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete this expense?', message: `${e.ref_no} · ${e.title} · ${money(e.amount)}${e.recurring_id ? '. This month’s cycle will be skipped (it will not come back).' : ''}`, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/expenses/${id}`); toast.success('Expense deleted.'); onChanged?.(); onClose(); } catch (x) { toast.error(x.message); }
  };
  if (error) return <Modal open onClose={onClose} title="Expense"><Notice type="error">{error.message}</Notice></Modal>;
  if (!e) return <Modal open onClose={onClose} title="Expense" size="lg"><Loader /></Modal>;
  const own = e.created_by === user.id;
  const mayReview = approver && (isAdmin || !own);
  const mayEdit = isAdmin || (can('expenses', 'edit') && e.status === 'pending' && own);
  return (
    <>
      <Modal open onClose={onClose} size="lg" title={`${e.ref_no} · ${e.title}`} subtitle={<span className="row" style={{ gap: 6 }}>{typeBadge(e.expense_type)}<span>{catPath(e.category, e.sub_category)}</span></span>}
        footer={<>
          {isAdmin && <Button variant="danger" icon={Trash2} onClick={del}>Delete</Button>}
          {mayEdit && onEdit && <Button icon={Pencil} onClick={() => onEdit(e)}>Edit</Button>}
          <div className="spacer" />
          {mayReview && can('cashflow') && e.status === 'pending' && (e.on_hold ? <Button icon={RotateCcw} loading={busy === 'release'} onClick={() => control('release')}>Release hold</Button> : <Button icon={History} onClick={() => setHolding(true)}>Hold payment</Button>)}
          {mayReview && e.status !== 'pending' && <Button icon={RotateCcw} loading={busy === 'pending'} onClick={() => review('pending')}>Back to not approved</Button>}
          {mayReview && e.status !== 'rejected' && <Button icon={X} onClick={() => setRejecting(true)}>Reject</Button>}
          {mayReview && e.status !== 'approved' && <Button variant="success" icon={Check} loading={busy === 'approved'} onClick={() => review('approved')}>Approve</Button>}
        </>}>
        <div className="grid grid-2">
          <div className="stack" style={{ gap: 12 }}>
            <div className="detail-amount"><span>{money(e.amount)}</span><StatusBadge status={e.status} hold={e.on_hold} /></div>
            {e.budget_holder_name && <Notice type="info">Paid from the expense budget of <b>{e.budget_holder_name}</b>.</Notice>}
            {e.on_hold && e.status === 'pending' && <Notice type="warn">On hold{e.hold_until ? ` until ${date(e.hold_until)}` : ''}{e.held_by_name ? ` by ${e.held_by_name}` : ''}{e.hold_note ? ` — ${e.hold_note}` : ''}.</Notice>}
            <dl className="dl">
              <dt>{e.expense_type === 'constant' ? 'Due date' : 'Expense date'}</dt><dd>{date(e.expense_date)}{e.cycle_month && <span className="muted"> · {monthName(e.cycle_month)} cycle</span>}</dd>
              {e.recurring_ref && <><dt>Recurring</dt><dd>{e.recurring_ref} · {titleCase(e.recurring_frequency)}</dd></>}
              <dt>Category</dt><dd>{e.category}</dd>
              <dt>Expense item</dt><dd>{e.sub_category || '—'}</dd>
              <dt>Paid to</dt><dd>{e.paid_to || '—'}</dd>
              <dt>Payment method</dt><dd>{e.payment_method}</dd>
              <dt>Department</dt><dd>{e.location || '—'}</dd>
              <dt>Bill / reference</dt><dd>{e.reference_no || '—'}</dd>
              <dt>Description</dt><dd>{e.description || '—'}</dd>
              <dt>Entered by</dt><dd>{e.entered_by || 'System'} · {dateTime(e.created_at)}</dd>
              {e.reviewed_by_name && <><dt>Reviewed</dt><dd>{e.reviewed_by_name} · {dateTime(e.reviewed_at)}</dd></>}
              {e.review_note && <><dt>Review note</dt><dd>{e.review_note}</dd></>}
            </dl>
          </div>
          <div className="stack" style={{ gap: 12 }}>
            {own && approver && !isAdmin && e.status === 'pending' && <Notice type="info">You entered this expense, so another approver must approve it.</Notice>}
            {e.receipt_duplicate_of && <Notice type="warn">This exact receipt file was uploaded before — possible duplicate claim.</Notice>}
            {e.receipt_file_id ? <ReceiptPreview id={e.receipt_file_id} mime={e.receipt_mime} name={e.receipt_name} />
              : <div className="notice warn"><AlertTriangle /><div><b>No receipt attached.</b>{e.no_receipt_reason ? <> Reason: {e.no_receipt_reason}</> : e.expense_type === 'constant' ? ' Attach the bill when it arrives (Edit).' : null}</div></div>}
            <div className="card card-pad" style={{ padding: 14 }}>
              <div className="row" style={{ gap: 6, marginBottom: 8 }}><History size={16} /><b>History</b></div>
              <HistoryTimeline items={e.history} />
            </div>
          </div>
        </div>
      </Modal>
      <ReasonModal open={rejecting} busy={busy === 'rejected'} onClose={() => setRejecting(false)} onSubmit={note => review('rejected', note)} />
      <ReasonModal open={holding} title="Why is this payment on hold?" ok="Put on hold" busy={busy === 'hold'} onClose={() => setHolding(false)} onSubmit={note => control('hold', note)} />
    </>
  );
}
