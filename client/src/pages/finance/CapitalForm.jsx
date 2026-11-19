// Add / edit capital entry — Capital type → movement → source → details → check & save.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Layers, FileText, ClipboardCheck, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useFormDef, listOptions, CustomFields, CustomValues, validateCustom } from '../../lib/forms.jsx';
import { Field, Input, Loader, MoneyInput, Notice, Select, Textarea, useToast } from '../../components/ui.jsx';
import { Wizard, useDraft, ChoiceGrid } from '../../components/Wizard.jsx';
import { money, todayStr, date } from '../../lib/format.js';
import { CAPITAL } from './Capital.jsx';

const METHODS = ['Cash', 'Bank Transfer', 'JazzCash', 'EasyPaisa', 'Online Gateway', 'Card', 'Cheque', 'Other'];
const STEPS = [{ title: 'Capital type', icon: Layers }, { title: 'Details', icon: FileText }, { title: 'Check & save', icon: ClipboardCheck }];
const blank = cls => ({ capital_class: cls || '', type: 'investment', source_type: '', party: '', share_pct: '', amount: '', entry_date: todayStr(), method: 'Bank Transfer', reference_no: '', note: '', custom_fields: {} });

export default function CapitalForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user, isAdmin } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { def, error: defErr } = useFormDef('capital');
  const editing = Boolean(id);
  const draft = useDraft('sh_capital_draft', blank(CAPITAL[params.get('class')] ? params.get('class') : ''), { enabled: !editing, userId: user.id });
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
    api.get('/capital').then(d => {
      const r = d.rows.find(x => String(x.id) === String(id));
      if (!r) throw new Error('Capital entry not found.');
      setF({ ...blank(), ...r, amount: String(r.amount), share_pct: r.share_pct != null ? String(r.share_pct) : '', custom_fields: r.custom_fields || {} });
      setLoaded(true);
    }).catch(e => setLoadErr(e.message));
  }, [editing, id, setF]);

  const sources = useMemo(() => listOptions(def, 'source_type'), [def]);
  const classes = useMemo(() => listOptions(def, 'capital_class'), [def]);

  const validate = s => {
    const e = {};
    if (s === 0) {
      if (!f.capital_class) e.capital_class = 'Choose the capital type.';
      if (!f.type) e.type = 'Choose added or withdrawn.';
      if (!f.source_type) e.source_type = 'Choose where the money came from.';
    }
    if (s === 1) {
      if (f.party.trim().length < 2) e.party = 'Enter the owner / partner / investor name.';
      if (!/^\d+(\.\d{1,2})?$/.test(f.amount) || !(Number(f.amount) > 0)) e.amount = 'Enter the amount (above 0).';
      if (f.share_pct !== '' && !(Number(f.share_pct) >= 0 && Number(f.share_pct) <= 100)) e.share_pct = 'Share must be between 0 and 100%.';
      if (!f.entry_date) e.entry_date = 'Date is required.';
      else if (f.entry_date > todayStr()) e.entry_date = 'Date cannot be in the future.';
      if (f.method && f.method !== 'Cash' && !f.reference_no.trim()) e.reference_no = 'Reference is required for non-cash payments.';
      Object.assign(e, validateCustom(def, f.custom_fields));
    }
    setErrs(e);
    return !Object.keys(e).length;
  };
  const submit = async () => {
    setBusy(true); setApiErr('');
    try {
      if (editing) await api.put(`/capital/${id}`, f); else await api.post('/capital', f);
      draft.clear();
      toast.success('Capital entry saved.');
      nav(`/capital/${f.capital_class === 'equity' || !f.capital_class ? 'entries' : f.capital_class}`, { replace: true });
    } catch (e) { setApiErr(e.message); } finally { setBusy(false); }
  };

  if (!isAdmin) return <Notice type="warn">Only admin can add or change capital entries.</Notice>;
  if (defErr) return <Notice type="error">{defErr.message}</Notice>;
  if (loadErr) return <Notice type="error">{loadErr}</Notice>;
  if (!def || !loaded) return <Loader />;
  const Err = ({ k }) => (errs[k] ? <span className="error">{errs[k]}</span> : null);
  const C = CAPITAL[f.capital_class];

  return (
    <Wizard title={editing ? 'Edit capital entry' : 'Add capital entry'} subtitle="Owner investment, drawings, or money set aside as fixed / working / debt capital." backTo="/capital/entries"
      steps={STEPS} step={step} onStep={i => { setErrs({}); setStep(i); }} validate={validate} onSubmit={submit} busy={busy} submitLabel={editing ? 'Save changes' : 'Save entry'}
      onReset={editing ? undefined : () => { draft.reset(); setStep(0); setErrs({}); }} restored={draft.restored} error={apiErr}>
      {step === 0 && (
        <div className="form">
          <div className="form-section"><span>1</span>Capital type</div>
          <ChoiceGrid value={f.capital_class} onChange={v => set('capital_class', v)} error={errs.capital_class} options={classes.map(o => ({ value: o.value, label: o.label, hint: o.hint, icon: CAPITAL[o.value]?.icon }))} />
          <Err k="capital_class" />
          {C && <div className="formula">{C.formula}</div>}
          <div className="form-section"><span>2</span>Movement</div>
          <ChoiceGrid value={f.type} onChange={v => set('type', v)} options={[{ value: 'investment', label: 'Added (investment)', icon: ArrowUpCircle, hint: 'Money put into the business' }, { value: 'drawing', label: 'Withdrawn (drawing)', icon: ArrowDownCircle, hint: 'Money taken out by the owner / partner' }]} />
          <div className="form-section"><span>3</span>Source</div>
          <div className="chips">{sources.map(s => <button type="button" key={s.value} className={`chip ${f.source_type === s.value ? 'on' : ''}`} onClick={() => set('source_type', s.value)}>{s.label}</button>)}</div>
          <Err k="source_type" />
        </div>
      )}
      {step === 1 && (
        <div className="form">
          <div className="form-grid">
            <Field label="Owner / partner / investor name" required><Input className={errs.party ? 'err' : ''} value={f.party} onChange={e => set('party', e.target.value)} maxLength={160} autoFocus /><Err k="party" /></Field>
            <Field label="Ownership share %" hint="Optional"><Input inputMode="decimal" className={errs.share_pct ? 'err' : ''} value={f.share_pct} onChange={e => set('share_pct', e.target.value.replace(/[^\d.]/g, ''))} /><Err k="share_pct" /></Field>
            <Field label="Amount (PKR)" required><MoneyInput className={`input mono ${errs.amount ? 'err' : ''}`} value={f.amount} onChange={x => set('amount', x)} /><Err k="amount" /></Field>
            <Field label="Date" required><Input type="date" max={todayStr()} className={errs.entry_date ? 'err' : ''} value={f.entry_date} onChange={e => set('entry_date', e.target.value)} /><Err k="entry_date" /></Field>
            <Field label="Payment method"><Select value={f.method} onChange={x => set('method', x)} options={[{ value: '', label: '—' }, ...METHODS]} /></Field>
            <Field label="Reference no." required={Boolean(f.method && f.method !== 'Cash')}><Input className={errs.reference_no ? 'err' : ''} value={f.reference_no} onChange={e => set('reference_no', e.target.value)} maxLength={120} /><Err k="reference_no" /></Field>
            <Field label="Note" full><Textarea rows={2} maxLength={500} value={f.note} onChange={e => set('note', e.target.value)} /></Field>
          </div>
          <CustomFields def={def} values={f.custom_fields} onChange={v => set('custom_fields', v)} errors={errs} />
        </div>
      )}
      {step === 2 && (
        <div className="subcard">
          <div className="field-label">Check before saving</div>
          <dl className="dl">
            <dt>Capital type</dt><dd>{C?.label}</dd>
            <dt>Movement</dt><dd>{f.type === 'investment' ? 'Added (investment)' : 'Withdrawn (drawing)'}</dd>
            <dt>Source</dt><dd>{f.source_type}</dd>
            <dt>Owner / partner</dt><dd data-no-translate>{f.party}{f.share_pct ? ` · ${f.share_pct}%` : ''}</dd>
            <dt>Amount</dt><dd className="strong">{money(f.amount)}</dd>
            <dt>Date</dt><dd>{date(f.entry_date)}</dd>
            <dt>Payment</dt><dd>{f.method || '—'}{f.reference_no ? ` · ${f.reference_no}` : ''}</dd>
            <CustomValues def={def} values={f.custom_fields} />
          </dl>
        </div>
      )}
    </Wizard>
  );
}
