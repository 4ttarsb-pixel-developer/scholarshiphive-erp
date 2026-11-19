// Add / edit asset — step by step: Liquidity → Category → Sub-category → details → value & payment → check & save.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Layers, FileText, Wallet, ClipboardCheck, ChevronRight } from 'lucide-react';
import { useAuth } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { useFormDef, listOptions, CustomFields, CustomValues, validateCustom, clearFormCache } from '../../lib/forms.jsx';
import { Field, Input, Loader, MoneyInput, Notice, Segmented, Select, Textarea, useToast } from '../../components/ui.jsx';
import { Wizard, useDraft, ChoiceGrid } from '../../components/Wizard.jsx';
import { money, todayStr, titleCase, date } from '../../lib/format.js';
import { LIQ } from './shared.jsx';

const METHODS = ['Cash', 'Bank Transfer', 'JazzCash', 'EasyPaisa', 'Online Gateway', 'Card', 'Cheque', 'Other'];
const STEPS = [{ title: 'Liquidity & category', icon: Layers }, { title: 'Asset details', icon: FileText }, { title: 'Value & payment', icon: Wallet }, { title: 'Check & save', icon: ClipboardCheck }];
const OTHER = '__other__';
const blank = liq => ({
  liquidity: liq || '', category: '', sub_category: '', sub_other: '', asset_type: '', name: '', quantity: '1', serial_no: '', location: '', custodian: '',
  purchase_date: todayStr(), cost: '', current_value: '', depreciation_rate: '', vendor: '', payment_method: '', reference_no: '', warranty_until: '',
  status: 'active', disposed_date: '', disposal_value: '', notes: '', custom_fields: {},
});

export default function AssetForm() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { def, error: defErr } = useFormDef('assets');
  const editing = Boolean(id);
  const draft = useDraft('sh_asset_draft', blank(LIQ[params.get('liquidity')] ? params.get('liquidity') : ''), { enabled: !editing, userId: user.id });
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
    api.get(`/assets/${id}`).then(a => {
      setF({ ...blank(), ...a, cost: String(a.cost), current_value: String(a.current_value), quantity: String(a.quantity || 1), depreciation_rate: a.depreciation_rate ? String(a.depreciation_rate) : '',
        disposal_value: a.disposal_value != null ? String(a.disposal_value) : '', warranty_until: a.warranty_until || '', disposed_date: a.disposed_date || '', sub_other: '', custom_fields: a.custom_fields || {} });
      setLoaded(true);
    }).catch(e => setLoadErr(e.message));
  }, [editing, id, setF]);

  const cats = useMemo(() => listOptions(def, 'category', 'liquidity', f.liquidity), [def, f.liquidity]);
  const subs = useMemo(() => listOptions(def, 'sub_category', 'category', f.category), [def, f.category]);
  // keep a saved sub-category that is not (or no longer) in the list
  const subKnown = !f.sub_category || subs.some(s => s.value === f.sub_category);
  const subChoice = f.sub_category === OTHER || (!subKnown && f.sub_category) ? OTHER : f.sub_category;
  const catMeta = cats.find(c => c.value === f.category)?.meta || {};

  const pickLiquidity = v => setF(o => ({ ...o, liquidity: v, category: o.liquidity === v ? o.category : '', sub_category: o.liquidity === v ? o.sub_category : '', asset_type: o.liquidity === v ? o.asset_type : '' }));
  const pickCategory = v => setF(o => ({ ...o, category: v, sub_category: o.category === v ? o.sub_category : '', asset_type: cats.find(c => c.value === v)?.meta?.asset_type || (o.liquidity === 'low' ? 'fixed' : 'current') }));

  const cost = Number(f.cost) || 0;
  const cur = f.current_value === '' ? cost : Number(f.current_value) || 0;
  const subValue = subChoice === OTHER ? (f.sub_category === OTHER ? f.sub_other : f.sub_category) : f.sub_category;

  const validate = s => {
    const e = {};
    if (s === 0) {
      if (!f.liquidity) e.liquidity = 'Choose how liquid this asset is.';
      if (!f.category) e.category = 'Choose a category.';
      if (subChoice === OTHER && (subValue || '').trim().length < 2) e.sub_other = 'Write the sub-category name.';
      if (!f.asset_type) e.asset_type = 'Choose the asset type.';
    }
    if (s === 1) {
      const n = f.name.trim();
      if (n.length < 2) e.name = 'Enter the asset name (at least 2 characters).';
      else if (n.length > 160) e.name = 'Asset name is too long (max 160).';
      if (!/^\d+$/.test(String(f.quantity)) || Number(f.quantity) < 1 || Number(f.quantity) > 100000) e.quantity = 'Quantity must be a whole number from 1 to 100000.';
      Object.assign(e, validateCustom(def, f.custom_fields));
    }
    if (s === 2) {
      if (!f.purchase_date) e.purchase_date = 'Purchase date is required.';
      else if (f.purchase_date > todayStr()) e.purchase_date = 'Purchase date cannot be in the future.';
      if (f.cost === '' || !/^\d+(\.\d{1,2})?$/.test(f.cost)) e.cost = 'Enter the cost (numbers only, e.g. 25000).';
      else if (cost > 999999999999) e.cost = 'Amount is too large.';
      if (f.current_value !== '' && !/^\d+(\.\d{1,2})?$/.test(f.current_value)) e.current_value = 'Current value must be a number.';
      if (f.depreciation_rate !== '' && !(Number(f.depreciation_rate) >= 0 && Number(f.depreciation_rate) <= 100)) e.depreciation_rate = 'Depreciation must be between 0 and 100%.';
      if (f.payment_method && f.payment_method !== 'Cash' && !f.reference_no.trim()) e.reference_no = 'Reference is required for non-cash payments (TID / cheque no.).';
      if (f.warranty_until && f.purchase_date && f.warranty_until < f.purchase_date) e.warranty_until = 'Warranty cannot end before the purchase date.';
      if (f.status === 'disposed') {
        if (!f.disposed_date) e.disposed_date = 'Enter the date it was sold / disposed.';
        else if (f.disposed_date < f.purchase_date) e.disposed_date = 'Disposed date cannot be before the purchase date.';
        else if (f.disposed_date > todayStr()) e.disposed_date = 'Disposed date cannot be in the future.';
        if (f.disposal_value !== '' && !/^\d+(\.\d{1,2})?$/.test(f.disposal_value)) e.disposal_value = 'Sold-for amount must be a number.';
      }
    }
    setErrs(e);
    return !Object.keys(e).length;
  };

  const submit = async () => {
    setBusy(true); setApiErr('');
    const body = { ...f, sub_category: (subValue || '').trim(), current_value: f.current_value === '' ? f.cost : f.current_value, require_reference: Boolean(f.payment_method && f.payment_method !== 'Cash') };
    delete body.sub_other;
    try {
      if (editing) await api.put(`/assets/${id}`, body); else await api.post('/assets', body);
      draft.clear(); clearFormCache('assets');
      toast.success(editing ? 'Asset updated.' : 'Asset saved — it now counts in the balance sheet.');
      nav(`/assets/${f.liquidity || 'register'}`, { replace: true });
    } catch (e) { setApiErr(e.message); } finally { setBusy(false); }
  };

  if (defErr) return <Notice type="error">{defErr.message}</Notice>;
  if (loadErr) return <Notice type="error">{loadErr}</Notice>;
  if (!def || !loaded) return <Loader />;
  const Err = ({ k }) => (errs[k] ? <span className="error">{errs[k]}</span> : null);

  return (
    <Wizard title={editing ? 'Edit asset' : 'Add asset'} subtitle="First choose the main field, then its sub-field — the form guides you step by step." backTo={editing ? '/assets/register' : '/assets'}
      steps={STEPS} step={step} onStep={i => { setErrs({}); setStep(i); }} validate={validate} onSubmit={submit} busy={busy} submitLabel={editing ? 'Save changes' : 'Save asset'}
      onReset={editing ? undefined : () => { draft.reset(); setStep(0); setErrs({}); }} restored={draft.restored} error={apiErr}>
      {step === 0 && (
        <div className="form">
          <div className="form-section"><span>1</span>Liquidity — how fast can it become cash?</div>
          <ChoiceGrid value={f.liquidity} onChange={pickLiquidity} error={errs.liquidity}
            options={listOptions(def, 'liquidity').map(o => ({ value: o.value, label: o.label, hint: o.hint || LIQ[o.value]?.hint, icon: LIQ[o.value]?.icon }))} />
          <Err k="liquidity" />
          {f.liquidity && <>
            <div className="form-section"><span>2</span>Category</div>
            {cats.length ? <div className="chips">{cats.map(c => <button type="button" key={c.value} className={`chip ${f.category === c.value ? 'on' : ''}`} aria-pressed={f.category === c.value} onClick={() => pickCategory(c.value)}>{c.label}</button>)}</div>
              : <Notice type="warn">No categories under this level yet. Admin can add them in Admin Settings → Forms & Fields.</Notice>}
            <Err k="category" />
          </>}
          {f.category && <>
            <div className="form-section"><span>3</span>Sub-category <small className="muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 600 }}>(optional)</small></div>
            <div className="chips">
              {subs.map(s => <button type="button" key={s.value} className={`chip ${subChoice === s.value ? 'on' : ''}`} onClick={() => set('sub_category', subChoice === s.value ? '' : s.value)}>{s.label}</button>)}
              <button type="button" className={`chip ${subChoice === OTHER ? 'on' : ''}`} onClick={() => set('sub_category', subChoice === OTHER ? '' : OTHER)}>Other — write it</button>
            </div>
            {subChoice === OTHER && <Field label="Write the sub-category" required><Input className={errs.sub_other ? 'err' : ''} maxLength={120} value={f.sub_category === OTHER ? f.sub_other : f.sub_category} onChange={e => setF(o => ({ ...o, sub_category: OTHER, sub_other: e.target.value }))} autoFocus /><Err k="sub_other" /></Field>}
            <div className="form-grid">
              <Field label="Asset type" required hint={catMeta.asset_type ? `Suggested for ${f.category}: ${titleCase(catMeta.asset_type)}` : 'Fixed = long-term · Current = cash & receivables · Intangible = software, brand'}>
                <Segmented value={f.asset_type} onChange={x => set('asset_type', x)} options={[{ value: 'current', label: 'Current' }, { value: 'fixed', label: 'Fixed' }, { value: 'intangible', label: 'Intangible' }]} />
                <Err k="asset_type" />
              </Field>
            </div>
            <PathLine f={{ ...f, sub_category: subValue }} />
          </>}
        </div>
      )}

      {step === 1 && (
        <div className="form">
          <PathLine f={{ ...f, sub_category: subValue }} />
          <div className="form-grid">
            <Field label="Asset name" required full hint="What exactly is it? e.g. “10 Dell laptops (Core i5)” or “Meezan current account”"><Input className={errs.name ? 'err' : ''} value={f.name} onChange={e => set('name', e.target.value)} maxLength={160} autoFocus /><Err k="name" /></Field>
            <Field label="Quantity" required><Input inputMode="numeric" className={errs.quantity ? 'err' : ''} value={f.quantity} onChange={e => set('quantity', e.target.value.replace(/\D/g, '').slice(0, 6))} /><Err k="quantity" /></Field>
            <Field label="Serial / reference no." hint="Serial, IMEI, account no., registration no."><Input value={f.serial_no} onChange={e => set('serial_no', e.target.value)} maxLength={120} /></Field>
            <Field label="Location" hint="Office / branch / room"><Input value={f.location} onChange={e => set('location', e.target.value)} maxLength={120} /></Field>
            <Field label="Custodian (kept by)" hint="Person responsible for it"><Input value={f.custodian} onChange={e => set('custodian', e.target.value)} maxLength={120} /></Field>
          </div>
          <CustomFields def={def} values={f.custom_fields} onChange={v => set('custom_fields', v)} errors={errs} />
        </div>
      )}

      {step === 2 && (
        <div className="form">
          <div className="form-grid">
            <Field label="Purchase / acquired date" required><Input type="date" max={todayStr()} className={errs.purchase_date ? 'err' : ''} value={f.purchase_date} onChange={e => set('purchase_date', e.target.value)} /><Err k="purchase_date" /></Field>
            <Field label="Cost (PKR)" required hint={Number(f.quantity) > 1 && cost ? `${money(cost / Number(f.quantity))} each` : 'Total price paid'}><MoneyInput className={`input mono ${errs.cost ? 'err' : ''}`} value={f.cost} onChange={x => set('cost', x)} /><Err k="cost" /></Field>
            <Field label="Current value (PKR)" hint="Leave empty = same as cost"><MoneyInput className={`input mono ${errs.current_value ? 'err' : ''}`} value={f.current_value} onChange={x => set('current_value', x)} /><Err k="current_value" /></Field>
            <Field label="Depreciation % per year" hint="Optional — e.g. 20 for computers"><Input inputMode="decimal" className={errs.depreciation_rate ? 'err' : ''} value={f.depreciation_rate} onChange={e => set('depreciation_rate', e.target.value.replace(/[^\d.]/g, ''))} /><Err k="depreciation_rate" /></Field>
            <Field label="Bought from (vendor)"><Input value={f.vendor} onChange={e => set('vendor', e.target.value)} maxLength={160} /></Field>
            <Field label="Payment method"><Select value={f.payment_method} onChange={x => set('payment_method', x)} options={[{ value: '', label: '—' }, ...METHODS]} /></Field>
            <Field label="Payment reference" required={Boolean(f.payment_method && f.payment_method !== 'Cash')}><Input className={errs.reference_no ? 'err' : ''} value={f.reference_no} onChange={e => set('reference_no', e.target.value)} maxLength={120} placeholder="TID / cheque no. / invoice no." /><Err k="reference_no" /></Field>
            <Field label="Warranty until"><Input type="date" min={f.purchase_date} className={errs.warranty_until ? 'err' : ''} value={f.warranty_until} onChange={e => set('warranty_until', e.target.value)} /><Err k="warranty_until" /></Field>
            <Field label="Status" full><Segmented value={f.status} onChange={x => set('status', x)} options={[{ value: 'active', label: 'Active' }, { value: 'disposed', label: 'Disposed / sold' }]} /></Field>
            {f.status === 'disposed' && <>
              <Field label="Disposed / sold date" required><Input type="date" min={f.purchase_date} max={todayStr()} className={errs.disposed_date ? 'err' : ''} value={f.disposed_date} onChange={e => set('disposed_date', e.target.value)} /><Err k="disposed_date" /></Field>
              <Field label="Sold for (PKR)" hint="Optional"><MoneyInput className={`input mono ${errs.disposal_value ? 'err' : ''}`} value={f.disposal_value} onChange={x => set('disposal_value', x)} /><Err k="disposal_value" /></Field>
            </>}
            <Field label="Notes" full><Textarea rows={2} maxLength={1000} value={f.notes} onChange={e => set('notes', e.target.value)} /></Field>
          </div>
          {cost > 0 && <div className="callout">Depreciation so far: <b>{money(Math.max(0, cost - cur))}</b> · {cost ? Math.round((Math.max(0, cost - cur) / cost) * 1000) / 10 : 0}% of cost</div>}
        </div>
      )}

      {step === 3 && (
        <div className="form">
          <div className="subcard">
            <div className="field-label">Check before saving</div>
            <dl className="dl">
              <dt>Classification</dt><dd><PathLine f={{ ...f, sub_category: subValue }} inline /></dd>
              <dt>Asset</dt><dd data-no-translate>{f.name} {Number(f.quantity) > 1 ? `× ${f.quantity}` : ''}</dd>
              <dt>Type</dt><dd>{titleCase(f.asset_type)}</dd>
              <dt>Acquired</dt><dd>{date(f.purchase_date)}</dd>
              <dt>Cost</dt><dd className="strong">{money(cost)}</dd><dt>Current value</dt><dd>{money(cur)}</dd>
              <dt>Payment</dt><dd>{f.payment_method || '—'}{f.reference_no ? ` · ${f.reference_no}` : ''}</dd>
              <dt>Location</dt><dd data-no-translate>{[f.location, f.custodian].filter(Boolean).join(' · ') || '—'}</dd>
              <CustomValues def={def} values={f.custom_fields} />
              <dt>Status</dt><dd>{f.status === 'disposed' ? `Disposed · ${date(f.disposed_date)}` : 'Active'}</dd>
            </dl>
          </div>
          <Notice type="info">After saving, this asset shows in Assets, the balance sheet (Capital & Equity) and Cash Flow. Only admin can edit or delete it later.</Notice>
        </div>
      )}
    </Wizard>
  );
}

function PathLine({ f, inline }) {
  if (!f.liquidity) return null;
  const parts = [LIQ[f.liquidity]?.label, f.category, f.sub_category && f.sub_category !== OTHER ? f.sub_category : null].filter(Boolean);
  return (
    <div className="path-line" style={inline ? { display: 'inline-flex' } : undefined}>
      {!inline && <span>Selected:</span>}
      {parts.map((p, i) => <span key={p} className="row" style={{ gap: 6 }}>{i > 0 && <ChevronRight />}<b data-no-translate={i > 0 ? '' : undefined}>{p}</b></span>)}
    </div>
  );
}
