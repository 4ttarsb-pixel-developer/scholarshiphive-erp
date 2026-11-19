// Admin Settings → Forms & Fields: every form's master fields, their sub options, and admin-added fields.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Lock, Plus, Trash2, Pencil, Eye, EyeOff, Check, X, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { api } from '../../lib/api.js';
import { clearFormCache } from '../../lib/forms.jsx';
import { Badge, Button, Card, Field, Input, Loader, Modal, Notice, Segmented, Select, Textarea, useConfirm, useToast } from '../../components/ui.jsx';

const TYPE_LABEL = { text: 'Text', textarea: 'Long text', number: 'Number', money: 'Amount (PKR)', date: 'Date', select: 'Dropdown', multiselect: 'Multiple choice', checkbox: 'Yes / no', email: 'Email', phone: 'Phone', url: 'Link (URL)' };
const LINKS = { expenses: ['/expenses/categories', 'Expense categories & items'], petty: ['/expenses/categories', 'Petty cash categories & items'] };

export default function FormFields() {
  const { data: list, error, reload: reloadList } = useLoad('/forms');
  const [form, setForm] = useState('assets');
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!list) return <Loader />;
  return (
    <div className="ff-layout">
      <Card pad={false} title="Forms">
        <div className="ff-forms">
          {list.forms.map(f => <button key={f.key} type="button" className={form === f.key ? 'on' : ''} onClick={() => setForm(f.key)}><span>{f.label}</span>{f.custom > 0 && <Badge tone="blue">+{f.custom}</Badge>}</button>)}
        </div>
      </Card>
      <FormEditor key={form} form={form} inputTypes={list.inputTypes} onChanged={reloadList} />
    </div>
  );
}

function FormEditor({ form, inputTypes, onChanged }) {
  const { data: d, error, reload } = useLoad(`/forms/${form}?all=1`);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();
  const refresh = () => { clearFormCache(form); reload(); onChanged(); };
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!d) return <Loader />;
  const removeField = async f => {
    if (!(await confirm({ title: `Remove “${f.label}”?`, message: 'If records already have a value in this field, it is switched off instead (old data is kept and still shown).', danger: true, ok: 'Remove' }))) return;
    try { const r = await api.del(`/forms/fields/${f.id}`); toast.success(r.message || 'Field removed.'); refresh(); } catch (e) { toast.error(e.message); }
  };
  const toggleField = async f => {
    try { await api.put(`/forms/fields/${f.id}`, { ...f, active: !f.active }); toast.success(f.active ? 'Field hidden from the form.' : 'Field shown on the form.'); refresh(); } catch (e) { toast.error(e.message); }
  };
  const link = LINKS[form];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card pad={false} title={`${d.label} — built-in fields`} subtitle="Master fields of this form. Fields with a list can be opened to manage their sub options.">
        {link && <div className="card-body" style={{ paddingBottom: 0 }}><Notice type="info">Categories and items of this form are managed on <Link to={link[0]}>{link[1]}</Link>.</Notice></div>}
        {d.system.map(s => {
          const list = s.managed;
          const open = openKey === s.key;
          return (
            <div key={s.key} className="ff-field">
              <div className="ff-field-head">
                {list ? <button className="icon-btn" onClick={() => setOpenKey(open ? null : s.key)} aria-label={open ? 'Close' : 'Open'}>{open ? <ChevronDown /> : <ChevronRight className="chev-flip" />}</button> : <span style={{ width: 30, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}><Lock size={14} /></span>}
                <b style={{ flex: 1, minWidth: 140 }}>{list ? list.label : s.label}</b>
                {s.section && <span className="small muted">{s.section}</span>}
                <span className="type-pill">{TYPE_LABEL[s.type] || s.type}</span>
                {s.required && <Badge tone="orange">Required</Badge>}
                {list && <Badge tone="blue">{list.options.filter(o => !o.parent_option_id || list.depends_on).length} options</Badge>}
                {list && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({ ...list, isSystem: true })}>Rename</Button>}
              </div>
              {open && list && <OptionTree form={form} def={d} field={list} onChanged={refresh} />}
            </div>
          );
        })}
      </Card>

      <Card pad={false} title="Extra fields (added by admin)" subtitle="Show on the form under “Additional details” and are saved with every record." actions={<Button size="sm" variant="primary" icon={Plus} onClick={() => setAdd(true)}>Add field</Button>}>
        {!d.custom.length ? <div className="empty-state"><div className="strong" style={{ color: 'var(--text-2)' }}>No extra fields yet</div><div className="small">Click “Add field” to collect more information on this form.</div></div> : d.custom.map(f => {
          const open = openKey === f.field_key;
          const hasOpts = ['select', 'multiselect'].includes(f.input_type);
          return (
            <div key={f.id} className={`ff-field ${f.active ? '' : 'off'}`}>
              <div className="ff-field-head">
                {hasOpts ? <button className="icon-btn" onClick={() => setOpenKey(open ? null : f.field_key)} aria-label={open ? 'Close' : 'Open'}>{open ? <ChevronDown /> : <ChevronRight className="chev-flip" />}</button> : <span style={{ width: 30 }} />}
                <b style={{ flex: 1, minWidth: 140 }} data-no-translate>{f.label}</b>
                <span className="type-pill">{TYPE_LABEL[f.input_type]}</span>
                {f.required && <Badge tone="orange">Required</Badge>}
                {!f.active && <Badge tone="grey">Hidden</Badge>}
                <Button size="sm" variant="ghost" icon={f.active ? EyeOff : Eye} onClick={() => toggleField(f)}>{f.active ? 'Hide' : 'Show'}</Button>
                <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit(f)} aria-label="Edit" />
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => removeField(f)} aria-label="Remove" />
              </div>
              {open && hasOpts && <OptionTree form={form} def={d} field={f} onChanged={refresh} />}
            </div>
          );
        })}
      </Card>
      {add && <FieldModal form={form} inputTypes={inputTypes} onClose={() => setAdd(false)} onSaved={() => { setAdd(false); refresh(); }} />}
      {edit && <FieldModal form={form} inputTypes={inputTypes} field={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
    </div>
  );
}

/** Options of one field. For a dependent list (e.g. sub-category) options are grouped under their master option. */
function OptionTree({ form, def, field, onChanged }) {
  const toast = useToast();
  const [rename, setRename] = useState({});
  const [adding, setAdding] = useState({});
  const parentField = field.depends_on ? Object.values(def.lists).find(l => l.field_key === field.depends_on) : null;
  const grandField = parentField?.depends_on ? Object.values(def.lists).find(l => l.field_key === parentField.depends_on) : null;
  const fixed = (form === 'assets' && field.field_key === 'liquidity') || (form === 'capital' && field.field_key === 'capital_class');
  const addOpt = async parentId => {
    const label = (adding[parentId ?? 'root'] || '').trim();
    if (label.length < 1) return;
    try { await api.post(`/forms/fields/${field.id}/options`, { label, parent_option_id: parentId }); setAdding(a => ({ ...a, [parentId ?? 'root']: '' })); toast.success('Option added.'); onChanged(); } catch (e) { toast.error(e.message); }
  };
  const save = async o => {
    try { await api.put(`/forms/options/${o.id}`, { label: rename[o.id] }); setRename(r => { const n = { ...r }; delete n[o.id]; return n; }); onChanged(); } catch (e) { toast.error(e.message); }
  };
  const toggle = async o => { try { await api.put(`/forms/options/${o.id}`, { active: !o.active }); onChanged(); } catch (e) { toast.error(e.message); } };
  const del = async o => { try { const r = await api.del(`/forms/options/${o.id}`); toast.success(r.message || 'Option removed.'); onChanged(); } catch (e) { toast.error(e.message); } };

  const node = (o, lvl) => (
    <div key={o.id} className={`ff-node lvl${lvl} ${o.active ? '' : 'off'}`}>
      {rename[o.id] !== undefined
        ? <><Input value={rename[o.id]} maxLength={120} onChange={e => setRename(r => ({ ...r, [o.id]: e.target.value }))} style={{ maxWidth: 300, height: 32 }} autoFocus /><span className="row" style={{ gap: 2 }}><Button size="sm" variant="ghost" icon={Check} onClick={() => save(o)} aria-label="Save" /><Button size="sm" variant="ghost" icon={X} onClick={() => setRename(r => { const n = { ...r }; delete n[o.id]; return n; })} aria-label="Cancel" /></span></>
        : <><span data-no-translate>{o.label}{o.is_system && <Lock size={11} style={{ marginInlineStart: 6, opacity: .5 }} />}</span>
          <span className="row" style={{ gap: 2 }}>
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setRename(r => ({ ...r, [o.id]: o.label }))} aria-label="Rename" />
            {!fixed && <Button size="sm" variant="ghost" icon={o.active ? EyeOff : Eye} onClick={() => toggle(o)} aria-label={o.active ? 'Switch off' : 'Switch on'} />}
            {!fixed && !o.is_system && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => del(o)} aria-label="Remove" />}
          </span></>}
    </div>
  );
  const addRow = (parentId, placeholder) => (
    <div className="ff-add">
      <Input placeholder={placeholder} maxLength={120} value={adding[parentId ?? 'root'] || ''} onChange={e => setAdding(a => ({ ...a, [parentId ?? 'root']: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') addOpt(parentId); }} />
      <Button size="sm" icon={Plus} onClick={() => addOpt(parentId)}>Add</Button>
    </div>
  );

  if (!parentField) {
    return (
      <div className="ff-tree">
        {field.options.map(o => node(o, 1))}
        {!fixed && addRow(undefined, `New option in ${field.label}`)}
        {fixed && <span className="small muted">These levels are fixed — you can rename them. Add categories under them in the next list.</span>}
      </div>
    );
  }
  // grouped: master option → this field's options (and for 3 levels: grand → parent → option)
  const groups = (grandField ? grandField.options : [null]);
  return (
    <div className="ff-tree">
      {groups.map(g => (
        <div key={g?.id ?? 'all'} style={{ display: 'grid', gap: 4 }}>
          {g && <div className="ff-node" style={{ fontWeight: 700 }}><span data-no-translate>{g.label}</span></div>}
          {parentField.options.filter(po => !g || po.parent_option_id === g.id).map(po => (
            <div key={po.id} style={{ display: 'grid', gap: 4 }}>
              <div className={`ff-node lvl2 ${po.active ? '' : 'off'}`} style={{ fontWeight: 600 }}><span data-no-translate>{po.label}</span><span className="small muted">{field.options.filter(o => o.parent_option_id === po.id).length}</span></div>
              {field.options.filter(o => o.parent_option_id === po.id).map(o => node(o, 3))}
              <div style={{ marginInlineStart: 22 }}>{addRow(po.id, `New ${field.label.toLowerCase()} in ${po.label}`)}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FieldModal({ form, field, inputTypes, onClose, onSaved }) {
  const toast = useToast();
  const isSystem = field?.isSystem;
  const [f, setF] = useState(() => field ? { label: field.label, input_type: field.input_type, required: field.required, help: field.help || '', placeholder: field.placeholder || '', max_length: field.max_length ? String(field.max_length) : '', sort_order: String(field.sort_order ?? 100), active: field.active, options: '' }
    : { label: '', input_type: 'text', required: false, help: '', placeholder: '', max_length: '', sort_order: '100', active: true, options: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF(o => ({ ...o, [k]: v?.target ? v.target.value : v }));
  const needsOpts = !field && ['select', 'multiselect'].includes(f.input_type);
  const save = async () => {
    setErr('');
    if (f.label.trim().length < 2) return setErr('Write the field name (at least 2 characters).');
    const options = f.options.split('\n').map(x => x.trim()).filter(Boolean);
    if (needsOpts && !options.length) return setErr('Write at least one option (one per line).');
    if (f.max_length && !(Number(f.max_length) >= 1 && Number(f.max_length) <= 2000)) return setErr('Max length must be 1 to 2000.');
    setBusy(true);
    try {
      if (field) await api.put(`/forms/fields/${field.id}`, { ...f, max_length: f.max_length || null });
      else await api.post(`/forms/${form}/fields`, { ...f, max_length: f.max_length || null, options });
      toast.success(field ? 'Field updated.' : 'Field added — it now shows on the form.');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={field ? (isSystem ? 'Rename list' : 'Edit field') : 'Add field'} subtitle={isSystem ? 'Built-in list: only the name and help text can change.' : 'The new field appears on the form under “Additional details”.'} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        {err && <Notice type="error">{err}</Notice>}
        <div className="form-grid">
          <Field label="Field name" required><Input value={f.label} onChange={e => set('label', e.target.value)} maxLength={120} autoFocus placeholder="e.g. Insurance company" /></Field>
          {!isSystem && <Field label="Field type" required hint={field ? 'Type can change only while no record uses the field' : undefined}><Select value={f.input_type} onChange={x => set('input_type', x)} options={inputTypes.map(t => ({ value: t, label: TYPE_LABEL[t] || t }))} /></Field>}
          <Field label="Help text" full hint="Small grey hint under the field"><Input value={f.help} onChange={e => set('help', e.target.value)} maxLength={200} /></Field>
          {!isSystem && <>
            <Field label="Placeholder"><Input value={f.placeholder} onChange={e => set('placeholder', e.target.value)} maxLength={120} /></Field>
            {['text', 'textarea'].includes(f.input_type) && <Field label="Max length"><Input inputMode="numeric" value={f.max_length} onChange={e => set('max_length', e.target.value.replace(/\D/g, ''))} /></Field>}
            <Field label="Order" hint="Smaller number shows first"><Input inputMode="numeric" value={f.sort_order} onChange={e => set('sort_order', e.target.value.replace(/\D/g, ''))} /></Field>
            <Field label="Required?"><Segmented value={f.required ? 'yes' : 'no'} onChange={x => set('required', x === 'yes')} options={[{ value: 'no', label: 'Optional' }, { value: 'yes', label: 'Required' }]} /></Field>
            {needsOpts && <Field label="Options (one per line)" required full><Textarea rows={5} value={f.options} onChange={e => set('options', e.target.value)} placeholder={'EFU\nJubilee\nAdamjee'} /></Field>}
          </>}
        </div>
      </div>
    </Modal>
  );
}

/** Admin Settings → Security: password length rule. */
export function SecuritySettings() {
  const { data, error, reload } = useLoad('/security/password-policy');
  const toast = useToast();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setF({ min: String(data.min), max: String(data.max) }); }, [data]);
  const exact = useMemo(() => f && f.min === f.max, [f]);
  if (error) return <Notice type="error">{error.message}</Notice>;
  if (!data || !f) return <Loader />;
  const save = async () => {
    const min = Number(f.min), max = Number(f.max);
    if (!(min >= data.limits.min && min <= data.limits.max)) return toast.error(`Minimum must be ${data.limits.min}–${data.limits.max}.`);
    if (!(max >= min && max <= data.limits.max)) return toast.error('Maximum must be at least the minimum.');
    setBusy(true);
    try { await api.put('/security/password-policy', { min, max }); toast.success('Password rule saved. It applies to new passwords (register, reset, change).'); reload(); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-2">
      <Card title="Password length" subtitle="Applies when someone creates, resets or changes a password.">
        <div className="form">
          <div className="form-grid">
            <Field label="Minimum characters" required><Input inputMode="numeric" value={f.min} onChange={e => setF(o => ({ ...o, min: e.target.value.replace(/\D/g, '').slice(0, 3) }))} /></Field>
            <Field label="Maximum characters" required><Input inputMode="numeric" value={f.max} onChange={e => setF(o => ({ ...o, max: e.target.value.replace(/\D/g, '').slice(0, 3) }))} /></Field>
          </div>
          <Segmented value={exact ? 'exact' : 'range'} onChange={x => setF(o => (x === 'exact' ? { ...o, max: o.min } : { ...o, max: String(Math.max(Number(o.min), 64)) }))} options={[{ value: 'exact', label: 'Exactly N characters' }, { value: 'range', label: 'A range' }]} />
          <Notice type="info">{exact ? `Every new password must be exactly ${f.min} characters` : `New passwords must be ${f.min} to ${f.max} characters`}, with a capital letter, a small letter, a number and a special character. Existing passwords keep working — people can always log in with their current password.</Notice>
          <div><Button variant="primary" icon={KeyRound} loading={busy} onClick={save}>Save password rule</Button></div>
        </div>
      </Card>
      <Card title="Other protections (always on)">
        {['Show / hide password (eye button) on every password box', 'Caps Lock warning while typing a password', 'Strength meter and live checklist when choosing a password', 'Login is rate-limited and sessions end after inactivity', 'Passwords are stored only as secure hashes (bcrypt)'].map(t => <div key={t} className="list-row"><span className="row" style={{ gap: 8 }}><ShieldCheck size={16} color="var(--green)" />{t}</span></div>)}
      </Card>
    </div>
  );
}
