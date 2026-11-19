import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { Button, Field, FileInput, Input, Loader, Modal, MoneyInput, Notice, Select, Textarea, useToast } from '../../components/ui.jsx';
import CategoryPicker, { categoryPayload, categoryValue, checkCategory } from '../../components/CategoryPicker.jsx';
import { money, todayStr } from '../../lib/format.js';
import { useExpenseMeta } from './shared.jsx';
import { DepartmentField } from './ExpenseForm.jsx';
import { useFormDef, CustomFields, validateCustom } from '../../lib/forms.jsx';

/** Petty cash purchase form (new or edit). */
export function PettyForm({ record, balance = 0, onClose, onSaved }) {
  const { meta, error: metaErr } = useExpenseMeta();
  const { user, isAdmin, can } = useAuth();
  const toast = useToast();
  const tree = meta?.categories?.petty || [];
  const settings = meta?.pettySettings || { max_entry: 0, receipt_required_above: 0 };
  const [people, setPeople] = useState([]);
  const [cat, setCat] = useState({ category_id: '', sub_category_id: '', sub_category_other: '', save_option: false });
  const [f, setF] = useState(() => ({
    title: record?.title || '', amount: record ? String(record.amount) : '', entry_date: record?.entry_date || todayStr(), purchased_by: record?.purchased_by || user.full_name,
    vendor: record?.vendor || '', payment_mode: record?.payment_mode || 'Cash', location: record?.location || '', related_to: record?.related_to || '', description: record?.description || '',
    no_receipt: Boolean(record && !record.receipt_file_id), no_receipt_reason: record?.no_receipt_reason || '',
  }));
  const [receipt, setReceipt] = useState(null);
  const { def: customDef } = useFormDef('petty');
  const [custom, setCustom] = useState(() => record?.custom_fields || {});
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/users/directory').then(setPeople).catch(() => {}); }, []);
  useEffect(() => { if (meta && record) setCat(categoryValue(meta.categories.petty, record)); }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = k => x => setF(s => ({ ...s, [k]: x?.target ? (x.target.type === 'checkbox' ? x.target.checked : x.target.value) : x }));
  const available = record && record.status !== 'rejected' ? balance + Number(record.amount) : balance;
  const amt = Number(f.amount || 0);
  const after = available - amt;
  const needsReceipt = settings.receipt_required_above > 0 && amt > settings.receipt_required_above;
  const chosen = tree.find(c => String(c.id) === String(cat.category_id));
  const itemName = chosen?.subs.find(s => String(s.id) === String(cat.sub_category_id))?.name || cat.sub_category_other || '';

  const save = async () => {
    setErr('');
    const e = { ...checkCategory(tree, cat) };
    if (!(amt > 0)) e.amount = 'Enter an amount greater than 0';
    else if (amt > available) e.amount = `Not enough petty cash — available ${money(available)}`;
    else if (!isAdmin && settings.max_entry > 0 && amt > settings.max_entry) e.amount = `One entry can be at most ${money(settings.max_entry)} — bigger purchases go in Expenses`;
    if (!f.purchased_by.trim()) e.purchased_by = 'Who bought it?';
    if (!f.entry_date || f.entry_date > todayStr()) e.entry_date = 'Pick today or an earlier date';
    if (!receipt && !record?.receipt_file_id) {
      if (needsReceipt) e.receipt = `A receipt is required above ${money(settings.receipt_required_above)}`;
      else if (!f.no_receipt) e.receipt = 'Upload the receipt, or tick “No receipt” and write why';
      else if (f.no_receipt_reason.trim().length < 5) e.receipt = 'Write why there is no receipt (at least 5 letters)';
    }
    Object.assign(e, validateCustom(customDef, custom));
    setErrors(e);
    if (Object.keys(e).length) { setErr('Please fix the highlighted fields.'); return; }
    setBusy(true);
    try {
      const body = { ...categoryPayload(cat), title: f.title.trim(), amount: f.amount, entry_date: f.entry_date, purchased_by: f.purchased_by.trim(), vendor: f.vendor.trim(), payment_mode: f.payment_mode,
        location: f.location.trim(), related_to: f.related_to.trim(), description: f.description.trim(), no_receipt_reason: !receipt && f.no_receipt ? f.no_receipt_reason.trim() : '', receipt, custom_fields: custom };
      const r = record ? await api.upload(`/petty/${record.id}`, { ...body, version: record.version }, 'PUT') : await api.upload('/petty', body);
      toast.success(record ? 'Entry updated.' : `Saved — ${money(r.balance_after)} left in petty cash.`);
      onSaved?.(r);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={record ? `Edit ${record.ref_no}` : 'Add petty cash purchase'} subtitle={`Available balance: ${money(available)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{record ? 'Save changes' : 'Save purchase'}</Button></>}>
      {metaErr ? <Notice type="error">{metaErr.message}</Notice> : !meta ? <Loader /> : (
        <div className="form">
          {err && <Notice type="error">{err}</Notice>}
          <div className="form-section"><span>1</span>What was bought</div>
          <div className="form-grid">
            <CategoryPicker tree={tree} value={cat} onChange={setCat} errors={errors} canSave={can('petty_cash', 'edit')} labels={{ category: 'Petty cash category', item: 'Item' }} />
            <Field label="Details" hint={itemName ? `Leave empty to use “${itemName}”` : 'e.g. Tea, sugar and milk for visitors'}><Input value={f.title} onChange={set('title')} maxLength={160} placeholder={itemName || 'What exactly was bought?'} /></Field>
          </div>
          <div className="form-section"><span>2</span>Amount & who paid</div>
          <div className="form-grid">
            <Field label="Amount (PKR)" required error={errors.amount} hint={settings.max_entry > 0 ? `Max ${money(settings.max_entry)} per entry` : undefined}><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
            <Field label="Purchase date" required error={errors.entry_date}><Input type="date" value={f.entry_date} max={todayStr()} onChange={set('entry_date')} /></Field>
            <Field label="Bought by" required error={errors.purchased_by} hint="Pick a staff member or type a name">
              <Input list="petty-people" value={f.purchased_by} onChange={set('purchased_by')} maxLength={160} />
              <datalist id="petty-people">{people.map(p => <option key={p.id} value={p.full_name} />)}</datalist>
            </Field>
            <Field label="Paid with"><Select value={f.payment_mode} onChange={set('payment_mode')} options={meta.pettyModes} ariaLabel="Paid with" /></Field>
            <Field label="Shop / vendor"><Input value={f.vendor} onChange={set('vendor')} maxLength={160} placeholder="e.g. Al-Fatah, Careem" /></Field>
            <Field label="For student / client (optional)" hint="e.g. snacks for a visiting student, courier of their documents"><Input value={f.related_to} onChange={set('related_to')} maxLength={160} placeholder="Student or client name" /></Field>
            <DepartmentField value={f.location} onChange={set('location')} departments={meta.departments} />
          </div>
          <div className="form-section"><span>3</span>Receipt</div>
          <Field label="Receipt" required={!f.no_receipt || needsReceipt} error={errors.receipt} hint="Photo or PDF of the bill — an approver checks if it is valid" full>
            {!f.no_receipt && <FileInput file={receipt} onChange={setReceipt} accept="application/pdf,image/jpeg,image/png,image/webp" label={record?.receipt_name ? `Current: ${record.receipt_name} (choose to replace)` : 'Upload receipt'} hint="Drag & drop or click" image={receipt?.type?.startsWith('image/')} />}
            {!receipt && !record?.receipt_file_id && !needsReceipt && <label className="check" style={{ marginTop: 6 }}><input type="checkbox" checked={f.no_receipt} onChange={set('no_receipt')} /><span>No receipt (e.g. rickshaw fare, small tea stall)</span></label>}
            {f.no_receipt && !needsReceipt && <Textarea rows={2} style={{ marginTop: 6 }} maxLength={300} value={f.no_receipt_reason} onChange={set('no_receipt_reason')} placeholder="Why is there no receipt?" />}
          </Field>
          <CustomFields def={customDef} values={custom} onChange={setCustom} errors={errors} />
          <Field label="Notes"><Textarea rows={2} maxLength={1000} value={f.description} onChange={set('description')} /></Field>
          {amt > 0 && <div className={`notice ${after < 0 ? 'error' : 'info'}`}><Wallet /><div>Balance after this purchase: <b>{money(after)}</b>{settings.low_balance > 0 && after >= 0 && after <= settings.low_balance && <> — this is below the alert level of {money(settings.low_balance)}; approvers will be emailed.</>}</div></div>}
        </div>
      )}
    </Modal>
  );
}

/** Money given to the petty cash holder. */
export function TopupForm({ onClose, onSaved }) {
  const { meta } = useExpenseMeta();
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [people, setPeople] = useState([]);
  const [f, setF] = useState({ amount: '', expense_date: todayStr(), paid_to: '', payment_method: 'Cash', reference_no: '', description: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/users/directory').then(setPeople).catch(() => {}); }, []);
  const set = k => x => setF(s => ({ ...s, [k]: x?.target ? x.target.value : x }));
  const save = async () => {
    setErr('');
    if (!(Number(f.amount) > 0)) return setErr('Enter an amount greater than 0.');
    if (!f.paid_to.trim()) return setErr('Who received the cash?');
    setBusy(true);
    try { const r = await api.post('/petty/topups', f); toast.success(r.status === 'approved' ? `Top-up added — balance ${money(r.balance)}.` : 'Top-up saved — it is added to the balance once approved.'); onSaved?.(r); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add petty cash top-up" subtitle="Cash handed to the petty cash holder"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save top-up</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <div className="form-grid">
          <Field label="Amount (PKR)" required><MoneyInput value={f.amount} onChange={set('amount')} /></Field>
          <Field label="Date" required><Input type="date" value={f.expense_date} max={todayStr()} onChange={set('expense_date')} /></Field>
          <Field label="Given to (petty cash holder)" required><Input list="topup-people" value={f.paid_to} onChange={set('paid_to')} maxLength={160} /><datalist id="topup-people">{people.map(p => <option key={p.id} value={p.full_name} />)}</datalist></Field>
          <Field label="From (method)"><Select value={f.payment_method} onChange={set('payment_method')} options={meta?.methods || ['Cash']} ariaLabel="Method" /></Field>
          <Field label="Reference no."><Input value={f.reference_no} onChange={set('reference_no')} maxLength={80} placeholder="Cheque / transfer no." /></Field>
          <Field label="Note"><Input value={f.description} onChange={set('description')} maxLength={1000} placeholder="e.g. November float" /></Field>
        </div>
        {!isAdmin && <Notice type="info">An approver must approve this top-up before it is added to the balance.</Notice>}
      </div>
    </Modal>
  );
}
