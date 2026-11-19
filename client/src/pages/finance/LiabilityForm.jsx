// Add / edit liability — Category → Sub-category → lender → terms (live preview) → check & save.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layers, User, Percent, ClipboardCheck, Landmark, Truck, Receipt, CreditCard, Users, FileClock, HandCoins, Building, CircleEllipsis } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useFormDef, listOptions, CustomFields, CustomValues, validateCustom } from '../../lib/forms.jsx';
import { Field, Input, Loader, MoneyInput, Notice, Segmented, Select, Textarea, useToast } from '../../components/ui.jsx';
import { Wizard, useDraft, ChoiceGrid } from '../../components/Wizard.jsx';
import { PhoneInput, phoneValid } from '../auth/AuthShell.jsx';
import { money, todayStr, titleCase, date } from '../../lib/format.js';

const STEPS = [{ title: 'Category', icon: Layers }, { title: 'Lender / creditor', icon: User }, { title: 'Amount & terms', icon: Percent }, { title: 'Check & save', icon: ClipboardCheck }];
const OTHER = '__other__';
const CAT_ICON = { 'Bank Loan': Landmark, 'Owner / Personal Loan': Users, 'Trade Payables': Truck, 'Accrued Expenses': FileClock, 'Tax Payable': Receipt, 'Customer Advances': HandCoins, 'Credit Card': CreditCard, 'Lease / Installment Purchase': Building };
const blank = () => ({
  category: '', sub_category: '', sub_other: '', type: '', title: '', lender: '', contact_phone: '+92', reference_no: '', purpose: '', collateral: '',
  principal: '', interest_type: 'none', annual_rate: '', compounding: 'monthly', start_date: todayStr(), term_months: '12', notes: '', custom_fields: {},
});
const addMonths = (d, m) => { const [y, mo, day] = d.split('-').map(Number); const t = new Date(Date.UTC(y, mo - 1 + m, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(day, last)); return t.toISOString().slice(0, 10); };

export function previewPlan(f) {
  const P = Number(f.principal || 0), n = Math.max(1, Number(f.term_months || 1)), r = Number(f.annual_rate || 0) / 100;
  let total = P;
  if (f.interest_type === 'simple') total = P + P * r * (n / 12);
  if (f.interest_type === 'compound' && r > 0) { const k = { monthly: 12, quarterly: 4, yearly: 1 }[f.compounding] || 12; const i = Math.pow(1 + r / k, k / 12) - 1; total = ((P * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1)) * n; }
  const inst = total / n;
  // installments due within 12 months from today = current part
  const horizon = addMonths(todayStr(), 12);
  let due12 = 0;
  for (let k = 1; k <= n; k++) if (addMonths(f.start_date || todayStr(), k) <= horizon) due12 += inst;
  const round = x => Math.round(x * 100) / 100;
  return { total: round(total), interest: round(total - P), installment: round(inst), current: round(Math.min(total, due12)), nonCurrent: round(Math.max(0, total - due12)), end: addMonths(f.start_date || todayStr(), n) };
}

export default function LiabilityForm() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { def, error: defErr } = useFormDef('liabilities');
  const editing = Boolean(id);
  const draft = useDraft('sh_liability_draft', blank(), { enabled: !editing, userId: user.id });
  const { form: f, setForm: setF } = draft;
  const [loaded, setLoaded] = useState(!editing);
  const [loadErr, setLoadErr] = useState('');
  const [step, setStep] = useState(0);
  const [errs, setErrs] = useState({});
  const [apiErr, setApiErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(o => ({ ...o, [k]: v?.target ? v.target.value : v }));

  useEffect(() => {
    if (!editing) return;
    api.get(`/liabilities/${id}`).then(l => {
      setF({ ...blank(), ...l, principal: String(l.principal), annual_rate: l.annual_rate ? String(l.annual_rate) : '', term_months: String(l.term_months), contact_phone: l.contact_phone || '+92', sub_other: '', custom_fields: l.custom_fields || {} });
      setLoaded(true);
    }).catch(e => setLoadErr(e.message));
  }, [editing, id, setF]);

  const cats = useMemo(() => listOptions(def, 'category'), [def]);
  const subs = useMemo(() => listOptions(def, 'sub_category', 'category', f.category), [def, f.category]);
  const subKnown = !f.sub_category || subs.some(s => s.value === f.sub_category);
  const subChoice = f.sub_category === OTHER || (!subKnown && f.sub_category) ? OTHER : f.sub_category;
  const subValue = subChoice === OTHER ? (f.sub_category === OTHER ? f.sub_other : f.sub_category) : f.sub_category;
  const pickCategory = v => setF(o => ({ ...o, category: v, sub_category: o.category === v ? o.sub_category : '', type: cats.find(c => c.value === v)?.meta?.type || o.type || 'other' }));
  const pv = previewPlan(f);
  const phoneEmpty = !f.contact_phone || f.contact_phone.replace(/\D/g, '').length <= 3;

  const validate = s => {
    const e = {};
    if (s === 0) {
      if (!f.category) e.category = 'Choose what kind of liability this is.';
      if (subChoice === OTHER && (subValue || '').trim().length < 2) e.sub_other = 'Write the sub-category name.';
      if (!f.type) e.type = 'Choose the liability type.';
    }
    if (s === 1) {
      if (f.title.trim().length < 3) e.title = 'Enter a title (at least 3 characters), e.g. “HBL business loan”.';
      if (f.lender.trim().length < 2) e.lender = 'Enter the lender / creditor name.';
      if (!phoneEmpty && !phoneValid(f.contact_phone)) e.contact_phone = 'Enter a valid phone number, or leave it empty.';
    }
    if (s === 2) {
      if (!/^\d+(\.\d{1,2})?$/.test(f.principal) || !(Number(f.principal) > 0)) e.principal = 'Enter the principal amount (above 0).';
      if (f.interest_type !== 'none' && !(Number(f.annual_rate) > 0 && Number(f.annual_rate) <= 100)) e.annual_rate = 'Enter the yearly interest rate (0.01 – 100).';
      if (!f.start_date) e.start_date = 'Start date is required.';
      if (!/^\d+$/.test(String(f.term_months)) || Number(f.term_months) < 1 || Number(f.term_months) > 600) e.term_months = 'Term must be 1 to 600 months.';
      Object.assign(e, validateCustom(def, f.custom_fields));
    }
    setErrs(e);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    setBusy(true); setApiErr('');
    const body = { ...f, sub_category: (subValue || '').trim(), contact_phone: phoneEmpty ? '' : f.contact_phone, annual_rate: f.interest_type === 'none' ? '0' : f.annual_rate };
    delete body.sub_other;
    try {
      if (editing) await api.put(`/liabilities/${id}`, body); else await api.post('/liabilities', body);
      draft.clear();
      toast.success('Saved. It now shows in Expenses → Loans and the balance sheet.');
      nav('/liabilities/all', { replace: true });
    } catch (e) { setApiErr(e.message); } finally { setBusy(false); }
  };

  if (defErr) return <Notice type="error">{defErr.message}</Notice>;
  if (loadErr) return <Notice type="error">{loadErr}</Notice>;
  if (!def || !loaded) return <Loader />;
  const Err = ({ k }) => (errs[k] ? <span className="error">{errs[k]}</span> : null);

  return (
    <Wizard title={editing ? 'Edit liability' : 'Add liability / loan'} subtitle="Choose the category first, then its sub-category, then fill the details." backTo={editing ? '/liabilities/all' : '/liabilities'}
      steps={STEPS} step={step} onStep={i => { setErrs({}); setStep(i); }} validate={validate} onSubmit={submit} busy={busy} submitLabel={editing ? 'Save changes' : 'Save liability'}
      onReset={editing ? undefined : () => { draft.reset(); setStep(0); setErrs({}); }} restored={draft.restored} error={apiErr}>
      {step === 0 && (
        <div className="form">
          <div className="form-section"><span>1</span>Liability category</div>
          <ChoiceGrid value={f.category} onChange={pickCategory} error={errs.category} options={cats.map(c => ({ value: c.value, label: c.label, icon: CAT_ICON[c.value] || CircleEllipsis, hint: c.meta?.type ? titleCase(c.meta.type) : undefined }))} />
          <Err k="category" />
          {f.category && <>
            <div className="form-section"><span>2</span>Sub-category <small className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(optional)</small></div>
            <div className="chips">
              {subs.map(s => <button type="button" key={s.value} className={`chip ${subChoice === s.value ? 'on' : ''}`} onClick={() => set('sub_category', subChoice === s.value ? '' : s.value)}>{s.label}</button>)}
              <button type="button" className={`chip ${subChoice === OTHER ? 'on' : ''}`} onClick={() => set('sub_category', subChoice === OTHER ? '' : OTHER)}>Other — write it</button>
            </div>
            {subChoice === OTHER && <Field label="Write the sub-category" required><Input className={errs.sub_other ? 'err' : ''} maxLength={120} value={f.sub_category === OTHER ? f.sub_other : f.sub_category} onChange={e => setF(o => ({ ...o, sub_category: OTHER, sub_other: e.target.value }))} autoFocus /><Err k="sub_other" /></Field>}
            <Field label="Liability type" required hint="Loan = borrowed money · Payable = owed to a supplier / for a service · Other"><Segmented value={f.type} onChange={x => set('type', x)} options={[{ value: 'loan', label: 'Loan' }, { value: 'payable', label: 'Payable' }, { value: 'other', label: 'Other' }]} /><Err k="type" /></Field>
          </>}
        </div>
      )}

      {step === 1 && (
        <div className="form-grid">
          <Field label="Title" required full hint="Short name you will recognise, e.g. “HBL running finance 2026”"><Input className={errs.title ? 'err' : ''} value={f.title} onChange={e => set('title', e.target.value)} maxLength={160} autoFocus /><Err k="title" /></Field>
          <Field label="Lender / creditor" required><Input className={errs.lender ? 'err' : ''} value={f.lender} onChange={e => set('lender', e.target.value)} maxLength={160} placeholder="Bank, person or supplier" /><Err k="lender" /></Field>
          <Field label="Lender phone" hint="Optional"><div className={errs.contact_phone ? 'has-error' : ''}><PhoneInput value={f.contact_phone} onChange={x => set('contact_phone', x)} /></div><Err k="contact_phone" /></Field>
          <Field label="Account / reference no."><Input value={f.reference_no} onChange={e => set('reference_no', e.target.value)} maxLength={120} /></Field>
          <Field label="Purpose"><Input value={f.purpose} onChange={e => set('purpose', e.target.value)} maxLength={300} placeholder="e.g. New branch setup" /></Field>
          <Field label="Collateral / security" full><Input value={f.collateral} onChange={e => set('collateral', e.target.value)} maxLength={200} placeholder="e.g. Office vehicle, personal guarantee" /></Field>
        </div>
      )}

      {step === 2 && (
        <div className="form">
          <div className="form-grid">
            <Field label="Principal amount (PKR)" required><MoneyInput className={`input mono ${errs.principal ? 'err' : ''}`} value={f.principal} onChange={x => set('principal', x)} /><Err k="principal" /></Field>
            <Field label="Start date" required><Input type="date" className={errs.start_date ? 'err' : ''} value={f.start_date} onChange={e => set('start_date', e.target.value)} /><Err k="start_date" /></Field>
            <Field label="Interest" required full><Segmented value={f.interest_type} onChange={x => set('interest_type', x)} options={[{ value: 'none', label: 'No interest' }, { value: 'simple', label: 'Simple interest' }, { value: 'compound', label: 'Compound interest' }]} /></Field>
            {f.interest_type !== 'none' && <Field label="Annual interest rate %" required><Input inputMode="decimal" className={errs.annual_rate ? 'err' : ''} value={f.annual_rate} onChange={e => set('annual_rate', e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 14" /><Err k="annual_rate" /></Field>}
            {f.interest_type === 'compound' && <Field label="Compounding"><Select value={f.compounding} onChange={x => set('compounding', x)} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }, { value: 'yearly', label: 'Yearly' }]} /></Field>}
            <Field label="Term (months)" required><Input inputMode="numeric" className={errs.term_months ? 'err' : ''} value={f.term_months} onChange={e => set('term_months', e.target.value.replace(/\D/g, '').slice(0, 3))} /><Err k="term_months" /></Field>
            <Field label="Notes" full><Textarea rows={2} maxLength={1000} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field>
          </div>
          <CustomFields def={def} values={f.custom_fields} onChange={v => set('custom_fields', v)} errors={errs} />
          {Number(f.principal) > 0 && Number.isFinite(pv.total) && <Preview pv={pv} />}
        </div>
      )}

      {step === 3 && (
        <div className="form">
          <div className="subcard">
            <div className="field-label">Check before saving</div>
            <dl className="dl">
              <dt>Category</dt><dd>{f.category}{subValue ? ` › ${subValue}` : ''} · {titleCase(f.type)}</dd>
              <dt>Title</dt><dd data-no-translate>{f.title}</dd>
              <dt>Lender</dt><dd data-no-translate>{f.lender}{!phoneEmpty ? ` · ${f.contact_phone}` : ''}</dd>
              <dt>Principal</dt><dd className="strong">{money(f.principal)}</dd>
              <dt>Interest</dt><dd>{f.interest_type === 'none' ? 'No interest' : `${titleCase(f.interest_type)} · ${f.annual_rate}%`}</dd>
              <dt>Start → end</dt><dd>{date(f.start_date)} → {date(pv.end)} ({f.term_months} months)</dd>
              <CustomValues def={def} values={f.custom_fields} />
            </dl>
          </div>
          <Preview pv={pv} />
        </div>
      )}
    </Wizard>
  );
}

function Preview({ pv }) {
  return (
    <div className="card card-pad" style={{ padding: 14 }}>
      <div className="slip-row"><span>Total payable</span><b>{money(pv.total)}</b></div>
      <div className="slip-row"><span>Total interest</span><b>{money(pv.interest)}</b></div>
      <div className="slip-row"><span>Current part (due within 12 months)</span><b>{money(pv.current)}</b></div>
      <div className="slip-row"><span>Non-current part (after 12 months)</span><b>{money(pv.nonCurrent)}</b></div>
      <div className="slip-row total"><span>Monthly installment</span><span>{money(pv.installment)}</span></div>
    </div>
  );
}
