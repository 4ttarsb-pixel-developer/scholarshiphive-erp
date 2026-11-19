import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Save, CalendarClock, CheckCircle2, Plus, X, UserCheck, User, Wallet, BellRing, Paperclip, RotateCcw } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { useLang } from '../../lib/i18n.jsx';
import { useLayout } from '../../components/Layout.jsx';
import { api } from '../../lib/api.js';
import { Button, Card, Field, FileInput, Input, Loader, MoneyInput, Notice, Select, Textarea, useToast } from '../../components/ui.jsx';
import { PhoneInput, phoneValid } from '../auth/AuthShell.jsx';
import { money, todayStr } from '../../lib/format.js';
import { asOptions, flagOpt } from './SaleForm.jsx';
import { DOC_LABEL } from './SaleDetail.jsx';
import { useFormDef, CustomFields, validateCustom } from '../../lib/forms.jsx';

const STEPS = [
  { title: 'Staff & service', icon: UserCheck },
  { title: 'Client', icon: User },
  { title: 'Payment', icon: Wallet },
  { title: 'Installments & alarm', icon: BellRing },
  { title: 'Documents & notes', icon: Paperclip },
];
const CHANNELS = [['app', 'App notification'], ['email', 'Email'], ['whatsapp', 'WhatsApp']];
const DRAFT = 'sh_sale_draft';
const MAX_FILE = 3 * 1024 * 1024;
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const cents = n => Math.round(Number(n || 0) * 100);

const blank = userId => ({
  employee_id: userId, sale_date: todayStr(), revenue_category: '', service: '', service_other: '', package: '', package_other: '',
  name: '', phone: '+92', email: '', destination: '', destination_other: '',
  total: '', advance: '', count: '2', method: 'Cash', payment_date: todayStr(), reference: '',
  installments: [], reminder_days: '3', channels: ['app'], notes_type: '', notes: '', custom_fields: {},
});

/** New Sale / Deal — 5 steps: staff & service → client → payment → installments & alarm → documents & notes. */
export default function NewSale() {
  const { user } = useAuth();
  const { tx } = useLang();
  const layout = useLayout();
  const nav = useNavigate();
  const toast = useToast();
  const [meta, setMeta] = useState(null);
  const [staff, setStaff] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [step, setStep] = useState(0);
  const [errs, setErrs] = useState({});
  const [apiErr, setApiErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState({});
  const { def: customDef } = useFormDef('sales');
  const top = useRef(null);
  const [init] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      if (d && d.user === user.id && d.form && (d.form.name || d.form.total || d.form.service)) return { form: { ...blank(user.id), ...d.form }, restored: true };
    } catch { /* storage blocked */ }
    return { form: blank(user.id), restored: false };
  });
  const [restored, setRestored] = useState(init.restored);
  const [f, setF] = useState(init.form);
  const set = (k, val) => setF(o => ({ ...o, [k]: val?.target ? val.target.value : val }));

  useEffect(() => {
    Promise.all([api.get('/revenue/meta'), api.get('/revenue/staff')])
      .then(([m, s]) => { setMeta(m); setStaff(s); })
      .catch(e => setLoadErr(e.message));
  }, []);
  // Keep a draft while typing (only on this device) — survives an accidental refresh.
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT, JSON.stringify({ user: user.id, form: f })); } catch { /* ignore */ } }, 400);
    return () => clearTimeout(t);
  }, [f, user.id]);
  useEffect(() => { top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [step]);

  const total = Number(f.total) || 0;
  const adv = Number(f.advance) || 0;
  const pending = Math.max(0, Math.round((total - adv) * 100) / 100);
  const person = staff.find(s => String(s.id) === String(f.employee_id));
  const commission = person ? Math.round(total * Number(person.commission_pct || 0)) / 100 : 0;
  const instSum = f.installments.reduce((a, i) => a + cents(i.amount), 0) / 100;

  const generate = (count = f.count) => {
    const n = Math.min(36, Math.max(1, Number(count) || 1));
    if (pending <= 0) { set('installments', []); return; }
    const each = Math.floor((pending / n) * 100) / 100;
    set('installments', Array.from({ length: n }, (_, i) => ({ due_date: addDays(f.sale_date, 30 * (i + 1)), amount: String(i === n - 1 ? Math.round((pending - each * (n - 1)) * 100) / 100 : each) })));
  };

  const validate = s => {
    const e = {};
    if (s === 0) {
      if (!f.employee_id) e.employee_id = 'Select the sales staff member.';
      if (!f.sale_date) e.sale_date = 'Sale date is required.';
      else if (f.sale_date > todayStr()) e.sale_date = 'Sale date cannot be in the future.';
      if (!f.revenue_category) e.revenue_category = 'Select a revenue category.';
      if (!f.service) e.service = 'Select a service.';
      else if (f.service === 'Other' && f.service_other.trim().length < 2) e.service_other = 'Write the service name.';
      if (!f.package) e.package = 'Select a package.';
      else if (f.package === 'Other' && f.package_other.trim().length < 2) e.package_other = 'Write the package name.';
    }
    if (s === 1) {
      const n = f.name.trim();
      if (n.length < 2) e.name = 'Enter the student / client name (at least 2 letters).';
      else if (!/^[\p{L} .'-]+$/u.test(n)) e.name = 'Name can only contain letters, spaces, dots and hyphens.';
      if (!phoneValid(f.phone)) e.phone = 'Enter a valid phone number for the selected country code.';
      if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Enter a valid email address.';
      if (!f.destination) e.destination = 'Select the study destination.';
      else if (f.destination === 'Other' && f.destination_other.trim().length < 2) e.destination_other = 'Write the country name.';
    }
    if (s === 2) {
      if (!(total > 0)) e.total = 'Enter the total package amount.';
      else if (total > 1e9) e.total = 'Amount is too large.';
      if (f.advance !== '' && (adv < 0 || adv > total)) e.advance = 'Advance must be between 0 and the total.';
      if (pending > 0 && !(Number(f.count) >= 1 && Number(f.count) <= 36)) e.count = 'Installments must be between 1 and 36.';
      if (adv > 0) {
        if (!f.method) e.method = 'Select the payment method.';
        if (f.method !== 'Cash' && !f.reference.trim()) e.reference = 'Reference / receipt no. is required for non-cash payments.';
        if (!f.payment_date) e.payment_date = 'Payment date is required.';
        else if (f.payment_date < f.sale_date) e.payment_date = 'Payment date cannot be before the sale date.';
      }
    }
    if (s === 4) Object.assign(e, validateCustom(customDef, f.custom_fields));
    if (s === 3 && pending > 0) {
      if (!f.installments.length) e.inst = 'Generate the installment schedule.';
      else if (f.installments.some(i => !i.due_date || !(Number(i.amount) > 0))) e.inst = 'Every installment needs a due date and an amount above 0.';
      else if (f.installments.some(i => i.due_date < f.sale_date)) e.inst = 'An installment cannot be due before the sale date.';
      else if (Math.abs(instSum - pending) > 1) e.inst = tx('Installments add up to {a} but the pending amount is {b}.', { a: money(instSum), b: money(pending) });
    }
    setErrs(e);
    return !Object.keys(e).length;
  };

  const next = () => {
    if (!validate(step)) return;
    if (step === 2) {
      const n = Number(f.count) || 1;
      const sameTotal = Math.abs(instSum - pending) <= 1 && f.installments.length === n;
      if (!sameTotal) generate(n);
    }
    setStep(step + 1);
  };
  const back = () => { setErrs({}); setStep(s => Math.max(0, s - 1)); };
  const goto = i => { if (i < step) { setErrs({}); setStep(i); } };

  const reset = () => { try { localStorage.removeItem(DRAFT); } catch { /* ignore */ } setF(blank(user.id)); setFiles({}); setStep(0); setErrs({}); setRestored(false); };

  const submit = async () => {
    for (let s = 0; s < 5; s++) if (!validate(s)) { setStep(s); return; }
    setBusy(true); setApiErr('');
    const body = {
      employee_id: Number(f.employee_id), sale_date: f.sale_date, revenue_category: f.revenue_category,
      service: f.service, service_other: f.service_other.trim(), package: f.package, package_other: f.package_other.trim(),
      destination: f.destination, destination_other: f.destination_other.trim(),
      client: { name: f.name.trim(), phone: f.phone, email: f.email.trim() || null, country: 'Pakistan' },
      total_amount: total, initial_amount: adv || '', payment_method: f.method, payment_date: f.payment_date || f.sale_date, reference: f.reference.trim(), require_reference: adv > 0 && f.method !== 'Cash',
      installments: pending > 0 ? f.installments.map(i => ({ due_date: i.due_date, amount: Number(i.amount) })) : [],
      reminder_days: Number(f.reminder_days), reminder_channels: f.channels, notes_type: f.notes_type, notes: f.notes.trim(), custom_fields: f.custom_fields || {},
    };
    let sale;
    try { sale = await api.post('/revenue/sales', body); } catch (e) { setApiErr(e.message); setBusy(false); return; }
    // Documents go one per request (keeps every upload small).
    const failed = [];
    for (const [type, file] of Object.entries(files)) {
      if (!file) continue;
      try { await api.upload(`/revenue/sales/${sale.id}/documents`, { [type]: file }); } catch (e) { failed.push(`${tx(DOC_LABEL[type])}: ${e.message}`); }
    }
    try { localStorage.removeItem(DRAFT); } catch { /* ignore */ }
    setBusy(false);
    layout?.bump?.();
    if (failed.length) toast.error(`${tx('Sale saved, but some documents did not upload')} — ${failed.join(' · ')}`);
    else toast.success(tx('Sale {inv} saved. Commission and salary update automatically.', { inv: sale.invoice_no }));
    nav(`/revenue/sales?open=${sale.id}`, { replace: true });
  };

  if (loadErr) return <Notice type="error">{loadErr}</Notice>;
  if (!meta) return <Loader />;
  const Err = ({ k }) => (errs[k] ? <span className="error">{errs[k]}</span> : null);
  const pick = (k, label, list, { other, searchable, render } = {}) => (
    <>
      <Field label={label} required>
        <div className={errs[k] ? 'has-error' : ''}><Select value={f[k]} onChange={x => set(k, x)} options={asOptions(list)} searchable={searchable} renderOption={render} /></div>
        <Err k={k} />
      </Field>
      {other && f[k] === 'Other' && (
        <Field label={other} required>
          <Input className={errs[`${k}_other`] ? 'err' : ''} value={f[`${k}_other`]} onChange={e => set(`${k}_other`, e.target.value)} maxLength={k === 'service' ? 120 : 80} autoFocus />
          <Err k={`${k}_other`} />
        </Field>
      )}
    </>
  );

  return (
    <div className="wizard" ref={top}>
      <div className="page-head">
        <div className="row" style={{ gap: 10 }}>
          <button className="icon-btn" onClick={() => nav('/revenue/sales')} aria-label="Back"><ArrowLeft /></button>
          <div><h1>Enter Revenue</h1><p>Record a sale, the money received and the payment plan.</p></div>
        </div>
        <div className="page-actions"><Button icon={RotateCcw} onClick={reset}>Clear form</Button></div>
      </div>
      {restored && <Notice type="info">Your unsaved draft was restored on this device. Documents must be chosen again.</Notice>}

      <ol className="wizard-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <button type="button" onClick={() => goto(i)} disabled={i >= step} aria-current={i === step ? 'step' : undefined}>
              <span className="step-dot">{i < step ? <CheckCircle2 size={16} /> : <s.icon size={15} />}</span>
              <span className="step-label"><small>{tx('Step {n}', { n: i + 1 })}</small>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <Card>
        {step === 0 && (
          <div className="form-grid">
            <Field label="Employee (sales staff)" required hint={person ? tx('Commission {pct}% of the total', { pct: Number(person.commission_pct || 0) }) : undefined}>
              <Select value={f.employee_id} onChange={x => set('employee_id', x)} searchable options={staff.map(s => ({ value: s.id, label: s.full_name + (s.id === user.id ? ` (${tx('you')})` : ''), hint: s.employee_code }))} />
              <Err k="employee_id" />
            </Field>
            <Field label="Sale date" required><Input type="date" className={errs.sale_date ? 'err' : ''} value={f.sale_date} max={todayStr()} onChange={e => set('sale_date', e.target.value)} /><Err k="sale_date" /></Field>
            {pick('revenue_category', 'Revenue category', meta.categories)}
            {pick('service', 'Service provided', meta.services, { other: 'Write the service name', searchable: true })}
            {pick('package', 'Package', meta.packages, { other: 'Write the package name' })}
          </div>
        )}

        {step === 1 && (
          <div className="form-grid">
            <Field label="Student / client name" required full><Input className={errs.name ? 'err' : ''} placeholder="e.g. Ayesha Khan" value={f.name} onChange={e => set('name', e.target.value)} maxLength={160} autoFocus /><Err k="name" /></Field>
            <Field label="Client phone" required hint={errs.phone ? undefined : 'Select country code, then number without the first 0'}><div className={errs.phone ? 'has-error' : ''}><PhoneInput value={f.phone} onChange={x => set('phone', x)} /></div><Err k="phone" /></Field>
            <Field label="Client email" hint="Optional"><Input type="email" className={errs.email ? 'err' : ''} placeholder="optional" value={f.email} onChange={e => set('email', e.target.value)} maxLength={160} /><Err k="email" /></Field>
            {pick('destination', 'Country (study destination)', meta.countries, { other: 'Write the country name', searchable: true, render: flagOpt })}
          </div>
        )}

        {step === 2 && (
          <div className="form">
            <div className="form-grid">
              <Field label="Total package (PKR)" required><MoneyInput className={`input mono ${errs.total ? 'err' : ''}`} value={f.total} onChange={x => set('total', x)} placeholder="e.g. 250000" /><Err k="total" /></Field>
              <Field label="Advance received (PKR)" hint="Leave empty if nothing was received yet"><MoneyInput className={`input mono ${errs.advance ? 'err' : ''}`} value={f.advance} onChange={x => set('advance', x)} placeholder="0" /><Err k="advance" /></Field>
              <Field label="Number of installments (for the pending amount)"><Input type="number" min="1" max="36" className={errs.count ? 'err' : ''} value={f.count} onChange={e => set('count', e.target.value)} disabled={pending <= 0} /><Err k="count" /></Field>
              <Field label="Pending amount"><div className="input readonly strong text-orange">{money(pending)}</div></Field>
            </div>
            {adv > 0 && (
              <div className="subcard">
                <div className="field-label">Advance payment details</div>
                <div className="form-grid">
                  <Field label="Payment method" required><Select value={f.method} onChange={x => set('method', x)} options={asOptions(meta.methods)} /><Err k="method" /></Field>
                  <Field label="Payment date" required><Input type="date" className={errs.payment_date ? 'err' : ''} value={f.payment_date} min={f.sale_date} max={todayStr()} onChange={e => set('payment_date', e.target.value)} /><Err k="payment_date" /></Field>
                  <Field label="Reference / receipt no." required={f.method !== 'Cash'} full><Input className={errs.reference ? 'err' : ''} value={f.reference} onChange={e => set('reference', e.target.value)} maxLength={120} placeholder={f.method === 'Cash' ? 'optional' : 'e.g. TID / cheque no.'} /><Err k="reference" /></Field>
                </div>
              </div>
            )}
            {person && total > 0 && (
              <div className="callout">
                {tx('Commission for {name}', { name: person.full_name })}: <b className="text-green">{money(commission)}</b>{' '}
                <span className="muted small">({Number(person.commission_pct || 0)}% · {tx('added to salary automatically when money is received')})</span>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="form">
            {pending <= 0 ? <Notice type="success">Full amount received — no installments needed.</Notice> : (
              <>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div className="small">{tx('Pending {amount} in {n} installment(s)', { amount: money(pending), n: f.installments.length })}</div>
                  <Button size="sm" icon={CalendarClock} onClick={() => generate()}>Auto-generate (30 days gap)</Button>
                </div>
                {f.installments.map((i, idx) => (
                  <div key={idx} className="plan-row">
                    <span className="muted small">#{idx + 1}</span>
                    <Input type="date" value={i.due_date} min={f.sale_date} aria-label="Due date" onChange={e => set('installments', f.installments.map((x, j) => (j === idx ? { ...x, due_date: e.target.value } : x)))} />
                    <MoneyInput value={i.amount} aria-label="Amount" onChange={val => set('installments', f.installments.map((x, j) => (j === idx ? { ...x, amount: val } : x)))} />
                    <Button size="sm" variant="ghost" icon={X} aria-label="Remove installment" disabled={f.installments.length <= 1} onClick={() => set('installments', f.installments.filter((_, j) => j !== idx))} />
                  </div>
                ))}
                <div className="row">
                  <Button size="sm" icon={Plus} disabled={f.installments.length >= 36} onClick={() => {
                    const last = f.installments[f.installments.length - 1];
                    const left = Math.round((pending - instSum) * 100) / 100;
                    set('installments', [...f.installments, { due_date: addDays(last?.due_date || f.sale_date, 30), amount: left > 0 ? String(left) : '' }]);
                  }}>Add installment</Button>
                  <span className={`small strong ${Math.abs(instSum - pending) > 1 ? 'text-red' : 'text-green'}`} style={{ marginInlineStart: 'auto' }}>
                    {Math.abs(instSum - pending) > 1 ? tx('Difference: {amount}', { amount: money(pending - instSum) }) : tx('Adds up to {amount} ✓', { amount: money(instSum) })}
                  </span>
                </div>
                {errs.inst && <Notice type="error">{errs.inst}</Notice>}
              </>
            )}
            <div className="form-grid">
              <Field label="Alarm / reminder before the due date"><Select value={String(f.reminder_days)} onChange={x => set('reminder_days', x)} options={meta.remindDays.map(d => ({ value: String(d), label: d === 0 ? 'On the due date' : tx('{n} day(s) before', { n: d }) }))} /></Field>
              <Field label="Reminder via" hint="App notifications go to you, the sales staff member and revenue managers">
                <div className="row" style={{ paddingTop: 6 }}>
                  {CHANNELS.map(([k, l]) => (
                    <label key={k} className="check"><input type="checkbox" checked={f.channels.includes(k)} onChange={e => set('channels', e.target.checked ? [...new Set([...f.channels, k])] : f.channels.filter(x => x !== k))} /><span>{l}</span></label>
                  ))}
                </div>
              </Field>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="form">
            <div className="form-grid">
              {Object.entries(DOC_LABEL).map(([k, l]) => (
                <Field key={k} label={l} hint="Optional">
                  <FileInput file={files[k] || null} accept="application/pdf,image/jpeg,image/png,image/webp,.docx" hint="PDF, JPG, PNG, WEBP or DOCX · max 3 MB" image={files[k]?.type?.startsWith('image/')}
                    onChange={file => {
                      if (file && file.size > MAX_FILE) { toast.error(tx('{name} is larger than 3 MB.', { name: file.name })); return; }
                      setFiles(o => ({ ...o, [k]: file }));
                    }} />
                </Field>
              ))}
            </div>
            <Field label="Note"><Select value={f.notes_type} onChange={x => set('notes_type', x)} placeholder="Select a note…" options={[{ value: '', label: '—' }, ...asOptions(meta.noteTypes)]} /></Field>
            <Field label={f.notes_type.startsWith('Other') ? 'Write note' : 'Extra note (optional)'} required={f.notes_type.startsWith('Other')}>
              <Textarea rows={3} maxLength={1000} value={f.notes} onChange={e => set('notes', e.target.value)} />
            </Field>
            <CustomFields def={customDef} values={f.custom_fields || {}} onChange={v => set('custom_fields', v)} errors={errs} />
            <Summary f={f} total={total} adv={adv} pending={pending} person={person} files={files} />
            {apiErr && <Notice type="error">{apiErr}</Notice>}
          </div>
        )}

        <div className="wizard-foot">
          <Button icon={ArrowLeft} disabled={step === 0 || busy} onClick={back}>Back</Button>
          {step < 4
            ? <Button variant="primary" onClick={next}>Next<ArrowRight size={16} /></Button>
            : <Button variant="primary" icon={Save} loading={busy} onClick={submit}>Save sale</Button>}
        </div>
      </Card>
    </div>
  );
}

function Summary({ f, total, adv, pending, person, files }) {
  const { tx } = useLang();
  const docs = useMemo(() => Object.entries(files).filter(([, v]) => v).map(([k]) => tx(DOC_LABEL[k])), [files, tx]);
  const val = (v, o) => (v === 'Other' ? o : v);
  return (
    <div className="subcard">
      <div className="field-label">Check before saving</div>
      <dl className="dl">
        <dt>Client</dt><dd data-no-translate>{f.name} · {f.phone}{f.email ? ` · ${f.email}` : ''}</dd>
        <dt>Service</dt><dd>{val(f.service, f.service_other)} · {val(f.package, f.package_other)}</dd>
        <dt>Destination</dt><dd>{val(f.destination, f.destination_other)}</dd>
        <dt>Sales staff</dt><dd data-no-translate>{person?.full_name || '—'}</dd>
        <dt>Total</dt><dd className="strong">{money(total)}</dd>
        <dt>Advance</dt><dd>{money(adv)}{adv > 0 ? ` · ${f.method}` : ''}</dd>
        <dt>Pending</dt><dd>{money(pending)}{pending > 0 ? ` · ${tx('{n} installment(s)', { n: f.installments.length })}` : ''}</dd>
        <dt>Documents</dt><dd>{docs.length ? docs.join(', ') : '—'}</dd>
      </dl>
    </div>
  );
}
