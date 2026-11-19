import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button, Field, Input, MoneyInput, Notice, Select, Textarea, useToast, Flag, Loader } from '../../components/ui.jsx';
import { PhoneInput, phoneValid } from '../auth/AuthShell.jsx';
import { api } from '../../lib/api.js';
import { money } from '../../lib/format.js';

/** A list value, or "Other" + the typed text when the saved value is not in the list. */
export const listValue = (val, list) => (!val ? ['', ''] : list.includes(val) ? [val, ''] : ['Other', val]);
export const asOptions = list => list.map(x => ({ value: x, label: x }));
export const flagOpt = o => <span className="row" style={{ gap: 8 }}><Flag country={o.value} />{o.label}</span>;

/** Edit a saved sale / deal (new deals use the 5-step form at /revenue/new). */
export default function SaleForm({ onDone, sale }) {
  const toast = useToast();
  const [meta, setMeta] = useState(null);
  const [staff, setStaff] = useState([]);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => v => setF(s => ({ ...s, [k]: v?.target ? v.target.value : v }));

  useEffect(() => {
    let alive = true;
    Promise.all([api.get('/revenue/meta'), api.get('/revenue/staff')]).then(([m, st]) => {
      if (!alive) return;
      setMeta(m); setStaff(st);
      const [service, service_other] = listValue(sale.service, m.services);
      const [pkg, package_other] = listValue(sale.package, m.packages);
      const [destination, destination_other] = listValue(sale.destination, m.countries);
      setF({
        customer_name: sale.customer_name, customer_phone: sale.customer_phone || '+92', customer_email: sale.customer_email || '',
        revenue_category: sale.revenue_category || m.categories[0], service, service_other, package: pkg, package_other, destination, destination_other,
        total_amount: String(sale.total_amount), sale_date: sale.sale_date, employee_id: sale.employee_id, notes_type: sale.notes_type || '', notes: sale.notes || '',
      });
    }).catch(e => alive && setErr(e.message));
    return () => { alive = false; };
  }, [sale]);

  const submit = async e => {
    e.preventDefault(); setErr('');
    const phone = f.customer_phone && f.customer_phone.replace(/\+\d{1,3}$/, '') ? f.customer_phone : '';
    if (f.customer_name.trim().length < 2) return setErr('Please enter the student / client name.');
    if (phone && !phoneValid(phone)) return setErr('Client phone number is not valid (or leave it empty).');
    if (!f.service) return setErr('Please select the service.');
    if (!f.package) return setErr('Please select the package.');
    if (!(Number(f.total_amount) > 0)) return setErr('Total package amount must be greater than 0.');
    if (Number(f.total_amount) < Number(sale.paid)) return setErr(`Total cannot be less than the amount already received (${money(sale.paid)}).`);
    setBusy(true);
    try {
      await api.put(`/revenue/sales/${sale.id}`, { ...f, customer_phone: phone });
      toast.success('Sale updated.');
      onDone?.(true);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (!f) return err ? <Notice type="error">{err}</Notice> : <Loader />;
  return (
    <form onSubmit={submit}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <Field label="Student / client name" required><Input value={f.customer_name} onChange={set('customer_name')} /></Field>
        <div className="form-grid">
          <Field label="Client phone" hint="Optional"><PhoneInput value={f.customer_phone} onChange={set('customer_phone')} /></Field>
          <Field label="Client email" hint="Optional"><Input type="email" value={f.customer_email} onChange={set('customer_email')} /></Field>
        </div>
        <Field label="Revenue category" required><Select value={f.revenue_category} onChange={set('revenue_category')} options={asOptions(meta.categories)} /></Field>
        <div className="form-grid">
          <Field label="Service" required><Select value={f.service} onChange={set('service')} options={asOptions(meta.services)} searchable /></Field>
          {f.service === 'Other' && <Field label="Write the service" required><Input value={f.service_other} onChange={set('service_other')} maxLength={120} /></Field>}
        </div>
        <div className="form-grid">
          <Field label="Package" required><Select value={f.package} onChange={set('package')} options={asOptions(meta.packages)} /></Field>
          {f.package === 'Other' && <Field label="Write the package" required><Input value={f.package_other} onChange={set('package_other')} maxLength={80} /></Field>}
        </div>
        <div className="form-grid">
          <Field label="Country (study destination)" required><Select value={f.destination} onChange={set('destination')} options={asOptions(meta.countries)} renderOption={flagOpt} searchable /></Field>
          {f.destination === 'Other' && <Field label="Write the country" required><Input value={f.destination_other} onChange={set('destination_other')} maxLength={80} /></Field>}
        </div>
        <div className="form-grid">
          <Field label="Total package (PKR)" required hint={Number(sale.paid) > 0 ? `Received so far: ${money(sale.paid)}` : undefined}><MoneyInput value={f.total_amount} onChange={set('total_amount')} /></Field>
          <Field label="Sale date" required><Input type="date" value={f.sale_date} onChange={set('sale_date')} /></Field>
        </div>
        <Field label="Sales staff member" required hint="Commission is calculated for this person">
          <Select value={f.employee_id} onChange={set('employee_id')} options={staff.map(s => ({ value: s.id, label: s.full_name, hint: s.employee_code }))} searchable />
        </Field>
        <Field label="Note type"><Select value={f.notes_type} onChange={set('notes_type')} options={[{ value: '', label: '—' }, ...asOptions(meta.noteTypes)]} /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={1000} /></Field>
        {Number(f.total_amount) !== Number(sale.total_amount) && sale.installments?.length > 0 && <Notice type="info">The total changed — unpaid installments are re-split automatically (same due dates). You can adjust them under “Payment plan”.</Notice>}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
        <Button type="button" onClick={() => onDone?.(false)}>Cancel</Button>
        <Button type="submit" variant="primary" icon={Save} loading={busy}>Save changes</Button>
      </div>
    </form>
  );
}
