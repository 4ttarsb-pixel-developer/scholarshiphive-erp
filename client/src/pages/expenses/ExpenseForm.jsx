import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Info, Repeat, Zap } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Button, Field, FileInput, Input, Loader, Modal, MonthPicker, MoneyInput, Notice, Select, Textarea, useToast } from '../../components/ui.jsx';
import CategoryPicker, { categoryPayload, categoryValue, checkCategory } from '../../components/CategoryPicker.jsx';
import { money, monthName, thisMonth, todayStr, addMonth } from '../../lib/format.js';
import { useExpenseMeta } from './shared.jsx';
import { useFormDef, CustomFields, validateCustom } from '../../lib/forms.jsx';

const STEP = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
export const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

/** Department dropdown with "Other" → free text. */
export function DepartmentField({ value, onChange, departments }) {
  const known = !value || departments.includes(value);
  const [other, setOther] = useState(!known);
  return (
    <Field label="Department / branch" hint="Helps compare spending by team">
      <Select value={other ? '__other' : value || ''} placeholder="Select department"
        options={[{ value: '', label: '— Not set —' }, ...departments.map(d => ({ value: d, label: d })), { value: '__other', label: 'Other — write your own…' }]}
        onChange={x => { if (x === '__other') { setOther(true); onChange(''); } else { setOther(false); onChange(x); } }} ariaLabel="Department" />
      {other && <Input style={{ marginTop: 6 }} maxLength={120} value={value} onChange={e => onChange(e.target.value)} placeholder="e.g. Islamabad branch" autoFocus />}
    </Field>
  );
}

/**
 * One form for constant (recurring) and variable expenses.
 * kind: undefined → new (choose type) · 'variable' → edit a variable expense · 'cycle' → edit one constant month · 'template' → edit a recurring constant expense
 */
/** budget = { balance, categories, maxEntry } → "My Budget" mode: variable only, saved against the employee's own budget. */
export default function ExpenseForm({ record, kind, presetType = 'variable', lockType = false, initialCategory, initialLocation = '', onClose, onSaved, budget }) {
  const { meta, error: metaErr } = useExpenseMeta();
  const { can } = useAuth();
  const toast = useToast();
  const editing = Boolean(record);
  const [type, setType] = useState(budget ? 'variable' : kind === 'template' || kind === 'cycle' ? 'constant' : kind === 'variable' ? 'variable' : presetType);
  const isTemplate = type === 'constant' && kind !== 'cycle';
  const tree = budget ? budget.categories || [] : meta?.categories?.[type] || [];
  const [cat, setCat] = useState(() => initialCategory || { category_id: '', sub_category_id: '', sub_category_other: '', save_option: false });
  const [f, setF] = useState(() => ({
    title: record?.title || '', amount: record?.amount != null ? String(record.amount) : '', paid_to: record?.paid_to || '',
    payment_method: record?.payment_method || (type === 'constant' ? 'Bank Transfer' : 'Cash'), location: record?.location || initialLocation || '', reference_no: record?.reference_no || '',
    description: record?.description || '', expense_date: record?.expense_date || todayStr(),
    frequency: record?.frequency || 'monthly', billing_day: String(record?.billing_day || 1), start_month: record?.start_month || thisMonth(),
    end_month: record?.end_month || '', has_end: Boolean(record?.end_month), auto_approve: Boolean(record?.auto_approve),
    reminder_days: String(record?.reminder_days ?? 3), reminder_channels: Array.isArray(record?.reminder_channels) ? record.reminder_channels : ['app', 'email'],
    no_receipt: Boolean(record && !record.receipt_file_id && record.no_receipt_reason), no_receipt_reason: record?.no_receipt_reason || '',
  }));
  const [receipt, setReceipt] = useState(null);
  const [optionalFields, setOptionalFields] = useState(() => ({ reference: Boolean(record?.reference_no), department: Boolean(record?.location), title: Boolean(record?.title), description: Boolean(record?.description) }));
  const toggleOptional = key => checked => { setOptionalFields(s => ({ ...s, [key]: checked })); if (!checked) { const field = ({ reference: 'reference_no', department: 'location', title: 'title', description: 'description' })[key]; setF(s => ({ ...s, [field]: '' })); } };
  const { def: customDef } = useFormDef('expenses');
  const [custom, setCustom] = useState(() => record?.custom_fields || {});
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => x => setF(s => ({ ...s, [k]: x?.target ? (x.target.type === 'checkbox' ? x.target.checked : x.target.value) : x }));

  useEffect(() => {
    if (!meta) return;
    if (record) setCat(categoryValue(budget ? tree : meta.categories[type], record));
    else if (initialCategory) setCat(initialCategory);
  }, [meta, record?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = tree.find(c => String(c.id) === String(cat.category_id));
  const itemName = chosen?.subs.find(s => String(s.id) === String(cat.sub_category_id))?.name || cat.sub_category_other || '';
  const approver = can('expense_approve', 'edit');

  const firstCycle = useMemo(() => (isTemplate ? `${String(Number(f.billing_day)).padStart(2, '0')} ${monthName(f.start_month)}` : null), [isTemplate, f.start_month, f.billing_day]);

  const validate = () => {
    const e = { ...checkCategory(tree, cat) };
    if (isTemplate && !f.reminder_channels.length) e.reminder_channels = 'Choose at least one reminder channel';
    if (isTemplate && !f.location) e.location = 'Select an office / branch';
    if (!(Number(f.amount) > 0)) e.amount = 'Enter an amount greater than 0 (numbers only)';
    else if (budget) {
      const room = Number(budget.balance) + (record ? Number(record.amount) : 0);
      if (Number(f.amount) > room) e.amount = `Only ${money(room)} is left in your budget`;
      else if (budget.maxEntry > 0 && Number(f.amount) > budget.maxEntry) e.amount = `One expense can be at most ${money(budget.maxEntry)}`;
    }
    if (!f.paid_to.trim()) e.paid_to = 'Who is paid? (vendor / person / company)';
    if (f.title && f.title.trim().length < 3) e.title = 'At least 3 characters, or leave empty';
    if (type === 'variable') {
      if (!f.expense_date) e.expense_date = 'Select the date';
      else if (f.expense_date > todayStr()) e.expense_date = 'Date cannot be in the future';
      if (!receipt && !record?.receipt_file_id && (!f.no_receipt || f.no_receipt_reason.trim().length < 5)) e.receipt = f.no_receipt ? 'Write why there is no receipt (at least 5 letters)' : 'Attach the receipt / invoice, or tick “No receipt”';
    }
    if (isTemplate && f.has_end && f.end_month && f.end_month < f.start_month) e.end_month = 'End month cannot be before the start month';
    if (!isTemplate) Object.assign(e, validateCustom(customDef, custom));
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async () => {
    setErr('');
    if (!validate()) { setErr('Please fix the highlighted fields.'); return; }
    setBusy(true);
    const common = { ...categoryPayload(cat), title: f.title.trim(), amount: f.amount, paid_to: f.paid_to.trim(), payment_method: f.payment_method, location: f.location.trim(), reference_no: f.reference_no.trim(), description: f.description.trim() };
    try {
      let saved;
      if (isTemplate) {
        const body = { ...common, frequency: f.frequency, billing_day: f.billing_day, start_month: f.start_month, end_month: f.has_end ? f.end_month || f.start_month : '', auto_approve: f.auto_approve, reminder_days: Number(f.reminder_days), reminder_channels: f.reminder_channels };
        saved = editing ? await api.put(`/expenses/recurring/${record.id}`, { ...body, version: record.version }) : await api.post('/expenses/recurring', body);
        toast.success(editing ? `Saved.${saved.cyclesUpdated ? ` ${saved.cyclesUpdated} pending month(s) updated.` : ''}` : saved.status === 'approved' ? `Constant expense added — ${saved.generated || 0} monthly cycle(s) created.` : 'Constant expense sent for approval.');
      } else {
        const body = { ...common, expense_type: type, expense_date: f.expense_date, no_receipt_reason: f.no_receipt && !receipt ? f.no_receipt_reason.trim() : '', receipt, custom_fields: custom };
        const base = budget ? '/budgets/me/expenses' : '/expenses';
        saved = editing ? await api.upload(`${base}/${record.id}`, { ...body, version: record.version }, 'PUT') : await api.upload(base, body);
        toast.success(editing ? 'Expense updated.' : saved.status === 'approved' ? 'Expense saved and approved.' : budget ? `Saved — ${money(saved.balance_after ?? 0)} left in your budget. Waiting for approval.` : 'Expense saved — waiting for approval.');
      }
      onSaved?.(saved);
    } catch (x) {
      setErr(x.status === 409 ? x.message + ' (Your changes were not saved.)' : x.message);
    } finally { setBusy(false); }
  };

  const title = budget ? (editing ? `Edit ${record.ref_no}` : 'Add expense from my budget') : editing ? (kind === 'template' ? `Edit constant expense ${record.ref_no}` : kind === 'cycle' ? `Edit ${monthName(record.cycle_month || thisMonth())} cycle · ${record.ref_no}` : `Edit ${record.ref_no}`) : 'Add expense';
  const perMonth = isTemplate && Number(f.amount) > 0 ? Number(f.amount) / STEP[f.frequency] : 0;

  return (
    <Modal open onClose={onClose} size="lg" title={title} subtitle="Fields marked * are required"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{editing ? 'Save changes' : isTemplate ? 'Save constant expense' : 'Save expense'}</Button></>}>
      {metaErr ? <Notice type="error">{metaErr.message}</Notice> : !meta ? <Loader /> : (
        <div className="form">
          {err && <Notice type="error">{err}</Notice>}
          {budget && <Notice type="info">Paid from your budget — available now <b>{money(Number(budget.balance) + (record ? Number(record.amount) : 0))}</b>{budget.maxEntry > 0 ? <> · max {money(budget.maxEntry)} per expense</> : null}{Number(f.amount) > 0 ? <> · after this: <b>{money(Number(budget.balance) + (record ? Number(record.amount) : 0) - Number(f.amount))}</b></> : null}</Notice>}
          <div className="form-section"><span>1</span>Type & category</div>
          <div className="form-grid">
            <Field label="Expense type" required hint={type === 'constant' ? 'Fixed costs that repeat — entered once, a cycle appears every period' : 'Daily / one-time spending'}>
              <Select value={type} disabled={editing || Boolean(budget) || lockType} options={meta.types} ariaLabel="Expense type"
                onChange={t => { setType(t); setCat({ category_id: '', sub_category_id: '', sub_category_other: '', save_option: false }); setF(s => ({ ...s, payment_method: t === 'constant' ? 'Bank Transfer' : s.payment_method })); setErrors({}); }} />
            </Field>
            <CategoryPicker tree={tree} value={cat} onChange={setCat} errors={errors} canSave={!budget && can('expenses', 'edit')} />
          </div>
          {chosen?.name === 'Salaries & HR' && <Notice type="warn">Salaries paid through <b>Salary & Workforce</b> are already added to expenses automatically. Use this only for staff who are <b>not</b> on payroll (contract, part-time, freelancers) or for HR costs — otherwise the salary is counted twice.</Notice>}

          <div className="form-section"><span>2</span>Amount & payment</div>
          <div className="form-grid">
            <Field label={isTemplate ? `Amount per ${f.frequency === 'monthly' ? 'month' : 'cycle'} (PKR)` : 'Amount (PKR)'} required error={errors.amount} hint="Numbers only, e.g. 15000"><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
            <Field label="Paid to / vendor" required error={errors.paid_to}><Input value={f.paid_to} onChange={set('paid_to')} maxLength={160} placeholder={type === 'constant' ? 'e.g. Landlord, LESCO, Zoho' : 'e.g. DHL Gulberg'} /></Field>
            <Field label="Payment method" required><Select value={f.payment_method} onChange={set('payment_method')} options={meta.methods} ariaLabel="Payment method" /></Field>
            {isTemplate && <Field label="Office / branch *" required error={errors.location}><Select value={f.location} onChange={set('location')} options={[{value:'',label:'Select office / branch'}, ...(meta.offices || ['Office 1','Office 2','Office 3','Office 4']).map(name=>({value:name,label:name}))]} ariaLabel="Office / branch" /></Field>}
          </div>

          {isTemplate ? (
            <>
              <div className="form-section"><span>3</span>Schedule (repeats automatically)</div>
              <div className="form-grid">
                <Field label="How often" required><Select value={f.frequency} onChange={set('frequency')} options={meta.frequencies} ariaLabel="Frequency" /></Field>
                <Field label="Due day of the month" required hint="Days 29–31 are not offered so every month has the date">
                  <Select value={f.billing_day} onChange={set('billing_day')} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `${ordinal(i + 1)} of the month` }))} ariaLabel="Due day" />
                </Field>
                <Field label="Starts from" required><MonthPicker value={f.start_month} onChange={set('start_month')} /></Field>
                <Field label="Ends" hint={f.has_end ? 'Last month that is charged' : 'Keeps repeating until you end it'}>
                  <label className="check"><input type="checkbox" checked={f.has_end} onChange={e => setF(s => ({ ...s, has_end: e.target.checked, end_month: e.target.checked ? s.end_month || addMonth(s.start_month, 11) : '' }))} /><span>Has an end month (contract ends)</span></label>
                  {f.has_end && <div style={{ marginTop: 6 }}><MonthPicker value={f.end_month || f.start_month} onChange={set('end_month')} /></div>}
                  {errors.end_month && <span className="error">{errors.end_month}</span>}
                </Field>
              </div>
              <div className="form-grid">
                <Field label="Reminder before due date">
                  <Select value={f.reminder_days} onChange={set('reminder_days')} options={[{ value: '0', label: 'On due date' }, { value: '1', label: '1 day before' }, { value: '3', label: '3 days before' }, { value: '7', label: '7 days before' }, { value: '14', label: '14 days before' }, { value: '30', label: '30 days before' }]} ariaLabel="Reminder lead time" />
                </Field>
                <Field label="Reminder channels" hint="Email / WhatsApp delivery needs server credentials." error={errors.reminder_channels}>
                  <div className="row wrap" style={{ gap: 12, minHeight: 42, alignItems: 'center' }}>
                    {[['app', 'In-app'], ['email', 'Email'], ['whatsapp', 'WhatsApp']].map(([value, label]) => <label className="check" key={value}><input type="checkbox" checked={f.reminder_channels.includes(value)} onChange={e => setF(s => ({ ...s, reminder_channels: e.target.checked ? [...new Set([...s.reminder_channels, value])] : s.reminder_channels.filter(x => x !== value) }))} /><span>{label}</span></label>)}
                  </div>
                </Field>
              </div>
              <div className="small muted">Reminders are sent to the assigned approvers and the person who set up this fixed expense. WhatsApp requires Meta Business Cloud API configuration and an approved template.</div>
              {approver && (
                <label className="check option-card">
                  <input type="checkbox" checked={f.auto_approve} onChange={set('auto_approve')} />
                  <span><b><Zap size={14} style={{ verticalAlign: -2 }} /> Auto-approve every new cycle</b><br /><small className="muted">For fixed amounts like rent. Leave off if someone should approve each month before it is paid.</small></span>
                </label>
              )}
              <div className="notice info"><Repeat /><div>
                {Number(f.amount) > 0 ? <><b>{money(f.amount)}</b> {f.frequency === 'monthly' ? 'every month' : `every ${STEP[f.frequency]} months`} on the <b>{ordinal(Number(f.billing_day))}</b>, starting <b>{monthName(f.start_month)}</b>{f.has_end && f.end_month ? <> until <b>{monthName(f.end_month)}</b></> : null}.
                  {f.frequency !== 'monthly' && <> That is about <b>{money(perMonth)}</b> per month.</>}</> : 'Enter the amount to see the schedule.'}
                <div className="small muted" style={{ marginTop: 4 }}><CalendarClock size={13} style={{ verticalAlign: -2 }} /> First cycle: {firstCycle}. Each cycle shows in <b>Constant Expenses → Monthly list</b> {f.auto_approve ? 'already approved' : 'as “Not approved” until an approver approves it'}.</div>
              </div></div>
            </>
          ) : (
            <>
              <div className="form-section"><span>3</span>{type === 'constant' ? 'Due date & bill' : 'Date & receipt'}</div>
              <div className="form-grid">
                <Field label={type === 'constant' ? 'Due date' : 'Expense date'} required error={errors.expense_date}>
                  <Input type="date" value={f.expense_date} max={type === 'variable' ? todayStr() : undefined} onChange={set('expense_date')} />
                </Field>
                <Field label={`Receipt / invoice${type === 'constant' ? ' (optional)' : ''}`} required={type === 'variable' && !f.no_receipt} error={errors.receipt} hint="PDF, JPG, PNG or WEBP — max 3 MB. Fake or damaged files are rejected.">
                  {!f.no_receipt && <FileInput file={receipt} onChange={setReceipt} accept="application/pdf,image/jpeg,image/png,image/webp" label={record?.receipt_name ? `Current: ${record.receipt_name} (choose to replace)` : 'Choose receipt'} hint="Drag & drop or click" image={receipt?.type?.startsWith('image/')} />}
                  {type === 'variable' && !receipt && !record?.receipt_file_id && <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={f.no_receipt} onChange={set('no_receipt')} /><span>No receipt available</span></label>}
                  {f.no_receipt && <Textarea rows={2} style={{ marginTop: 6 }} maxLength={300} value={f.no_receipt_reason} onChange={set('no_receipt_reason')} placeholder="Why is there no receipt? (approver will see this)" />}
                </Field>
              </div>
            </>
          )}
          {!isTemplate && <CustomFields def={customDef} values={custom} onChange={setCustom} errors={errors} />}
          <div className="form-section"><span>+</span>Optional details <small className="muted">Turn on only the fields you need</small></div>
          <div className="row wrap" style={{ gap: 12 }}>
            {[['reference','Reference / invoice no.'], ...(!isTemplate ? [['department','Department / branch']] : []), ['title','Custom title'], ['description','Description / notes']].map(([key,label]) => <label className="check option-card field-toggle" key={key}><input type="checkbox" role="switch" aria-checked={optionalFields[key]} checked={optionalFields[key]} onChange={e => toggleOptional(key)(e.target.checked)} /><span>{label}</span></label>)}
          </div>
          {optionalFields.reference && <Field label={type === 'constant' ? 'Account / reference no.' : 'Bill / invoice no.'}><Input value={f.reference_no} onChange={set('reference_no')} maxLength={80} placeholder={type === 'constant' ? 'e.g. LESCO ref 12 34567 1234500' : 'optional'} /></Field>}
          {!isTemplate && optionalFields.department && <DepartmentField value={f.location} onChange={set('location')} departments={meta.departments} />}
          {optionalFields.title && <Field label="Title" error={errors.title} hint={itemName ? `Leave empty to use “${itemName}”` : 'Optional short title'}><Input value={f.title} onChange={set('title')} maxLength={160} placeholder={itemName || 'e.g. October office rent'} /></Field>}
          {optionalFields.description && <Field label="Description / notes"><Textarea rows={2} maxLength={1000} value={f.description} onChange={set('description')} placeholder="Anything the approver should know" /></Field>}
          {!editing && !approver && <div className="hint row" style={{ gap: 6 }}><Info size={14} />An admin or approver reviews this before it counts as an approved expense.</div>}
        </div>
      )}
    </Modal>
  );
}
