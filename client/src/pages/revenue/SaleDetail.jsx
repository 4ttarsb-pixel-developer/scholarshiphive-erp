import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  Banknote, CircleDollarSign, Clock, RotateCcw, FileDown, Pencil, Trash2, Receipt, Share2, Paperclip, CheckCircle2, CalendarClock, History, FileText, ExternalLink, AlertTriangle, Plus, Wand2, X,
} from 'lucide-react';
import { useLoad } from '../../lib/auth.jsx';
import { useLang } from '../../lib/i18n.jsx';
import { api, fileUrl } from '../../lib/api.js';
import { Badge, Button, Card, Field, FileInput, Flag, Input, Kpi, Loader, Modal, MoneyInput, Notice, Select, useConfirm, useToast } from '../../components/ui.jsx';
import { money, date, dateTime, titleCase, todayStr } from '../../lib/format.js';
import { HistoryTimeline } from '../expenses/shared.jsx';
import SaleForm from './SaleForm.jsx';

export const DOC_LABEL = { passport: 'Passport', transcript: 'Academic transcripts', offer_letter: 'Offer letter', other: 'Other document' };
const CHANNEL = { app: 'App notification', email: 'Email', whatsapp: 'WhatsApp' };

/** Sale receipt: QR, money, payment plan (mark paid), documents, history, WhatsApp share. */
export default function SaleDetail({ id, edit, onClose, onPay, onRefund, onChanged, version }) {
  const { data: s, loading, error, reload } = useLoad(`/revenue/sales/${id}`, [version]);
  const { tx } = useLang();
  const [editing, setEditing] = useState(false);
  const [plan, setPlan] = useState(false);
  const [qr, setQr] = useState('');
  const [meta, setMeta] = useState(null);
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  useEffect(() => { api.get('/revenue/meta').then(setMeta).catch(() => {}); }, []);
  useEffect(() => {
    if (s) QRCode.toDataURL(`ScholarshipHive|${s.invoice_no}|${s.customer_name}|${s.total_amount}|${s.status}`, { margin: 1, width: 160 }).then(setQr).catch(() => {});
  }, [s?.invoice_no, s?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { reload(); onChanged?.(); };
  const del = async () => {
    if (!(await confirm({ title: 'Delete this sale?', message: `${s.invoice_no} — all payments, refunds, plan and documents are deleted. Approved salaries are not changed.`, danger: true, ok: 'Delete sale' }))) return;
    try { await api.del(`/revenue/sales/${id}`); toast.success('Sale deleted.'); onChanged?.(); onClose(); } catch (e) { toast.error(e.message); }
  };
  const markPaid = async () => {
    if (method !== 'Cash' && !reference.trim() && !(await confirm({ title: 'No reference number?', message: 'For bank / online payments a reference or receipt number helps later. Continue without it?', ok: 'Continue' }))) return;
    setBusy('pay');
    try { await api.post(`/revenue/sales/${id}/installments/pay`, { method, reference }); toast.success('Installment marked paid.'); setReference(''); changed(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const share = () => {
    const next = s.installments.find(i => !i.paid);
    const text = [`*ScholarshipHive — ${tx('Receipt')}*`, `${tx('Invoice')}: ${s.invoice_no}`, `${tx('Client')}: ${s.customer_name}`, `${tx('Service')}: ${s.service || s.package}`,
      `${tx('Total')}: ${money(s.total_amount)}`, `${tx('Received')}: ${money(s.paid)}`, `${tx('Pending')}: ${money(s.outstanding)}`, next ? `${tx('Next due')}: ${money(next.remaining)} — ${date(next.due_date)}` : ''].filter(Boolean).join('\n');
    const phone = String(s.customer_phone || '').replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  if (error) return <Modal open onClose={onClose} drawer title="Sale"><Notice type="error">{error.message}</Notice></Modal>;
  const nextIdx = s ? s.installments.findIndex(i => !i.paid) : -1;
  return (
    <>
      <Modal open onClose={onClose} drawer title={s ? <span data-no-translate>{s.invoice_no} · {s.customer_name}</span> : 'Sale'} subtitle={s ? `${s.service || s.package} · ${date(s.sale_date)}` : ''}
        footer={s && !editing && <>
          <a className="btn" href={`/api/revenue/sales/${id}/invoice`} download><FileDown />Receipt PDF</a>
          {s.customer_phone && <Button icon={Share2} onClick={share}>WhatsApp</Button>}
          {edit && <><Button icon={Pencil} onClick={() => setEditing(true)}>Edit</Button><Button icon={Trash2} variant="danger" onClick={del}>Delete</Button>
            {s.paid - s.refunded > 0 && <Button icon={RotateCcw} onClick={() => onRefund(s)}>Refund</Button>}
            {s.outstanding > 0 && <Button variant="primary" icon={Receipt} onClick={() => onPay(s)}>Record payment</Button>}</>}
        </>}>
        {loading && !s ? <Loader /> : editing ? <SaleForm sale={s} onDone={saved => { setEditing(false); if (saved) changed(); }} /> : (
          <div className="stack">
            <div className="receipt-head">
              <div className="stack" style={{ gap: 8, flex: 1 }}>
                <div className="row" style={{ gap: 8 }}><CheckCircle2 size={18} color="var(--green)" /><b>Receipt</b><Badge status={s.status}>{s.status}</Badge></div>
                <div className="grid grid-kpi" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
                  <Kpi icon={CircleDollarSign} color="blue" label="Total" value={money(s.total_amount)} />
                  <Kpi icon={Banknote} color="green" label="Received" value={money(s.paid)} />
                  <Kpi icon={Clock} color="orange" label="Outstanding" value={money(s.outstanding)} />
                </div>
              </div>
              {qr && <img src={qr} alt="QR code" className="receipt-qr" />}
            </div>
            <dl className="dl">
              <dt>Client</dt><dd data-no-translate>{s.customer_name}{s.customer_phone && ` · ${s.customer_phone}`}{s.customer_email && ` · ${s.customer_email}`}</dd>
              <dt>Destination</dt><dd className="row" style={{ gap: 6 }}><Flag country={s.destination} />{s.destination}</dd>
              <dt>Category</dt><dd>{s.revenue_category}</dd>
              <dt>Service</dt><dd>{s.service || '—'}</dd>
              <dt>Package</dt><dd>{s.package}</dd>
              <dt>Sales staff</dt><dd data-no-translate>{s.employee_name} ({s.employee_code})</dd>
              <dt>Next due</dt><dd>{s.status === 'Paid' || s.status === 'Refunded' ? '—' : s.due ? <span className={s.status === 'Overdue' ? 'text-red strong' : ''}>{date(s.due)}</span> : '—'}</dd>
              <dt>Reminders</dt><dd>{s.reminder_days === 0 ? 'On the due date' : tx('{n} day(s) before', { n: s.reminder_days })} · {(s.reminder_channels || []).map(c => tx(CHANNEL[c] || c)).join(', ')}</dd>
              {s.refunded > 0 && <><dt>Refunded</dt><dd className="text-red">{money(s.refunded)}</dd></>}
              <dt>Note</dt><dd>{s.notes_type && <Badge tone="blue">{s.notes_type}</Badge>} <span data-no-translate>{s.notes || (s.notes_type ? '' : '—')}</span></dd>
            </dl>

            <Card title={<span className="row" style={{ gap: 6 }}><CalendarClock size={16} />Payment plan</span>} pad={false}
              actions={edit && <Button size="sm" icon={Pencil} onClick={() => setPlan(true)}>{s.installments.length ? 'Edit plan' : 'Add plan'}</Button>}>
              {s.installments.length ? (
                <>
                  {edit && nextIdx >= 0 && (
                    <div className="card-body pay-bar">
                      <span className="small">{tx('Next: {amount} due {date}', { amount: money(s.installments[nextIdx].remaining), date: date(s.installments[nextIdx].due_date) })}</span>
                      <div style={{ width: 160 }}><Select value={method} onChange={setMethod} options={meta?.methods || ['Cash']} ariaLabel="Payment method" /></div>
                      <Input style={{ width: 160 }} placeholder="Reference (optional)" value={reference} onChange={e => setReference(e.target.value)} />
                      <Button size="sm" variant="success" icon={CheckCircle2} loading={busy === 'pay'} onClick={markPaid}>Mark paid</Button>
                    </div>
                  )}
                  <div className="table-wrap"><table className="tbl">
                    <thead><tr><th>#</th><th>Due date</th><th className="num">Amount</th><th className="num">Paid</th><th className="num">Remaining</th><th>Status</th></tr></thead>
                    <tbody>{s.installments.map((i, k) => (
                      <tr key={i.id} className={k === nextIdx ? 'selected' : ''}>
                        <td>{i.seq === 0 ? 'Advance' : i.seq}</td><td className={i.overdue ? 'text-red strong' : ''}>{date(i.due_date)}</td>
                        <td className="num">{money(i.amount)}</td><td className="num">{money(i.paid_amount)}</td><td className="num">{money(i.remaining)}</td>
                        <td>{i.paid ? <Badge tone="green">Paid</Badge> : i.overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone="orange">Pending</Badge>}</td>
                      </tr>))}</tbody>
                  </table></div>
                </>
              ) : <div className="card-body muted small">No installment plan. {s.due ? `Balance due ${date(s.due)}.` : ''}</div>}
            </Card>

            <Card title="Payments" pad={false}>
              <div className="table-wrap"><table className="tbl">
                <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Entered by</th><th className="num">Amount</th></tr></thead>
                <tbody>{s.payments.length ? s.payments.map(p => <tr key={p.id}><td>{date(p.payment_date)}</td><td>{p.method}</td><td data-no-translate>{p.reference || '—'}</td><td data-no-translate>{p.entered_by || '—'}</td><td className="num">{money(p.amount)}</td></tr>)
                  : <tr><td colSpan={5} className="tbl-empty">No payment yet.</td></tr>}</tbody>
              </table></div>
            </Card>
            {s.refunds.length > 0 && <Card title="Refunds" pad={false}>
              <div className="table-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Reason</th><th className="num">Amount</th></tr></thead>
                <tbody>{s.refunds.map(r => <tr key={r.id}><td>{date(r.refund_date)}</td><td className="wrap" data-no-translate>{r.reason}</td><td className="num">{money(r.amount)}</td></tr>)}</tbody></table></div>
            </Card>}

            <Documents sale={s} edit={edit} onChanged={changed} />

            <Card title={<span className="row" style={{ gap: 6 }}><History size={16} />History</span>}><HistoryTimeline items={s.history.map(h => ({ ...h, action: titleCase(h.action.replace(/^sale\./, '').replace('.', ' ')) }))} /></Card>
          </div>
        )}
      </Modal>
      {plan && s && <ScheduleModal sale={s} onClose={() => setPlan(false)} onSaved={() => { setPlan(false); changed(); }} />}
    </>
  );
}

function Documents({ sale, edit, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [type, setType] = useState('passport');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const upload = async () => {
    if (!file) return;
    setBusy(true);
    try { await api.upload(`/revenue/sales/${sale.id}/documents`, { [type]: file }); toast.success('Document attached.'); setFile(null); onChanged(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const del = async d => {
    if (!(await confirm({ title: 'Delete document?', message: d.original_name, danger: true, ok: 'Delete' }))) return;
    try { await api.del(`/revenue/sales/${sale.id}/documents/${d.id}`); toast.success('Deleted.'); onChanged(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Card title={<span className="row" style={{ gap: 6 }}><Paperclip size={16} />Documents</span>}>
      {sale.documents.length ? sale.documents.map(d => (
        <div key={d.id} className="list-row">
          <a href={fileUrl(d.file_id)} target="_blank" rel="noreferrer" className="row" style={{ gap: 6, minWidth: 0 }}><FileText size={15} /><span>{DOC_LABEL[d.doc_type]}:</span> <span data-no-translate className="truncate">{d.original_name}</span><ExternalLink size={12} /></a>
          <span className="row" style={{ gap: 4 }}>{d.duplicate_of && <Badge tone="orange"><AlertTriangle size={12} />Duplicate file</Badge>}
            {edit && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del(d)} aria-label="Delete document" />}</span>
        </div>
      )) : <div className="muted small">No documents attached.</div>}
      {edit && (
        <div className="doc-upload">
          <div style={{ width: 190 }}><Select value={type} onChange={setType} options={Object.entries(DOC_LABEL).map(([value, label]) => ({ value, label }))} ariaLabel="Document type" /></div>
          <div style={{ flex: 1, minWidth: 200 }}><FileInput file={file} onChange={setFile} accept="application/pdf,image/jpeg,image/png,image/webp,.docx" label="Choose file" hint="PDF, JPG, PNG, WEBP or DOCX · max 3 MB" image={file?.type?.startsWith('image/')} /></div>
          <Button variant="primary" icon={Paperclip} loading={busy} disabled={!file} onClick={upload}>Attach</Button>
        </div>
      )}
    </Card>
  );
}

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** Edit the whole plan — amounts must add up to the total. */
function ScheduleModal({ sale, onClose, onSaved }) {
  const toast = useToast();
  const { tx } = useLang();
  const [meta, setMeta] = useState(null);
  const [rows, setRows] = useState(() => (sale.installments.length ? sale.installments.map(i => ({ due_date: i.due_date, amount: String(i.amount), paid: i.paid }))
    : [{ due_date: sale.sale_date, amount: String(sale.paid || ''), paid: sale.paid > 0 }, { due_date: addDays(todayStr(), 30), amount: String(sale.outstanding || ''), paid: false }].filter(r => Number(r.amount) > 0)));
  const [days, setDays] = useState(String(sale.reminder_days ?? 3));
  const [channels, setChannels] = useState(sale.reminder_channels || ['app']);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/revenue/meta').then(setMeta).catch(() => {}); }, []);
  const total = rows.reduce((a, r) => a + Math.round(Number(r.amount || 0) * 100), 0) / 100;
  const diff = Math.round((sale.total_amount - total) * 100) / 100;
  const set = (i, k, val) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
  const split = () => {
    const paidRows = rows.filter(r => r.paid);
    const open = rows.filter(r => !r.paid);
    const rest = sale.total_amount - paidRows.reduce((a, r) => a + Number(r.amount || 0), 0);
    const n = Math.max(1, open.length);
    const each = Math.floor((rest / n) * 100) / 100;
    setRows([...paidRows, ...Array.from({ length: n }, (_, i) => ({ due_date: open[i]?.due_date || addDays(todayStr(), 30 * (i + 1)), amount: String(i === n - 1 ? Math.round((rest - each * (n - 1)) * 100) / 100 : each), paid: false }))]);
  };
  const save = async () => {
    setErr('');
    if (Math.abs(diff) > 1) { setErr(tx('Installments add up to {a} but the total is {b}.', { a: money(total), b: money(sale.total_amount) })); return; }
    if (rows.some(r => !r.due_date || !(Number(r.amount) > 0))) { setErr('Every installment needs a due date and an amount above 0.'); return; }
    setBusy(true);
    try { await api.put(`/revenue/sales/${sale.id}/schedule`, { installments: rows.map(r => ({ due_date: r.due_date, amount: r.amount })), reminder_days: days, reminder_channels: channels }); toast.success('Payment plan saved.'); onSaved(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Payment plan · ${sale.invoice_no}`} subtitle={`Total ${money(sale.total_amount)} · received ${money(sale.paid)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save plan</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <Notice type="info">Payments are counted from the first row down. Rows already covered by money received are marked “Paid”.</Notice>
        {rows.map((r, i) => (
          <div key={i} className="plan-row">
            <span className="muted small">{i === 0 && sale.installments[0]?.seq === 0 ? 'Advance' : `#${i + 1}`}</span>
            <Input type="date" value={r.due_date} min={sale.sale_date} onChange={e => set(i, 'due_date', e.target.value)} aria-label="Due date" />
            <MoneyInput value={r.amount} onChange={x => set(i, 'amount', x)} aria-label="Amount" />
            {r.paid ? <Badge tone="green">Paid</Badge> : <Button size="sm" variant="ghost" icon={X} onClick={() => setRows(rs => rs.filter((_, j) => j !== i))} aria-label="Remove installment" />}
          </div>
        ))}
        <div className="row">
          <Button size="sm" icon={Plus} onClick={() => setRows(rs => [...rs, { due_date: addDays(rs[rs.length - 1]?.due_date || todayStr(), 30), amount: diff > 0 ? String(diff) : '', paid: false }])}>Add installment</Button>
          <Button size="sm" icon={Wand2} onClick={split}>Split remaining equally</Button>
          <span className={`small strong ${Math.abs(diff) > 1 ? 'text-red' : 'text-green'}`} style={{ marginInlineStart: 'auto' }}>{Math.abs(diff) > 1 ? tx('Difference: {amount}', { amount: money(diff) }) : tx('Adds up to {amount} ✓', { amount: money(total) })}</span>
        </div>
        <div className="form-grid">
          <Field label="Alarm / reminder before the due date"><Select value={days} onChange={setDays} options={(meta?.remindDays || [0, 1, 2, 3, 5, 7, 10]).map(d => ({ value: String(d), label: d === 0 ? 'On the due date' : tx('{n} day(s) before', { n: d }) }))} /></Field>
          <Field label="Reminder via">
            <div className="row" style={{ paddingTop: 6 }}>{Object.entries(CHANNEL).map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={channels.includes(k)} onChange={e => setChannels(c => (e.target.checked ? [...c, k] : c.filter(x => x !== k)))} /><span>{l}</span></label>)}</div>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export const _fmt = { dateTime };
