// Admin-managed form fields on the client: option lists (master → sub) + extra fields.
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Field, Input, MoneyInput, Select, Textarea } from '../components/ui.jsx';

const cache = new Map(); // form → { at, data }
const TTL = 60 * 1000;

export function clearFormCache(form) { if (form) cache.delete(form); else cache.clear(); }

/** const { def, error, reload } = useFormDef('assets') */
export function useFormDef(form) {
  const hit = cache.get(form);
  const [state, setState] = useState({ def: hit?.data || null, error: null });
  const load = useCallback((force) => {
    const c = cache.get(form);
    if (!force && c && Date.now() - c.at < TTL) { setState({ def: c.data, error: null }); return; }
    api.get(`/forms/${form}`).then(d => { cache.set(form, { at: Date.now(), data: d }); setState({ def: d, error: null }); }).catch(e => setState(s => ({ def: s.def, error: e })));
  }, [form]);
  useEffect(() => { load(false); }, [load]);
  return { ...state, reload: () => load(true) };
}

/** Options of a built-in list, optionally only the children of a parent value. */
export function listOptions(def, key, parentKey, parentValue) {
  const list = def?.lists?.[key];
  if (!list) return [];
  let opts = list.options;
  if (parentKey) {
    const parent = def.lists[parentKey]?.options.find(o => o.value === parentValue);
    opts = parent ? opts.filter(o => o.parent_option_id === parent.id) : [];
  }
  return opts.map(o => ({ value: o.value, label: o.label, hint: o.meta?.hint, meta: o.meta, id: o.id }));
}

/** Client-side check of extra fields (the server checks again). Returns { field_key: message }. */
export function validateCustom(def, values = {}) {
  const errs = {};
  for (const f of def?.custom || []) {
    const v = values[f.field_key];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) { if (f.required && f.input_type !== 'checkbox') errs[f.field_key] = `${f.label} is required.`; continue; }
    const s = String(v).trim();
    if (f.input_type === 'number' && !/^-?\d+(\.\d{1,4})?$/.test(s)) errs[f.field_key] = `${f.label} must be a number.`;
    if (f.input_type === 'money' && !/^\d+(\.\d{1,2})?$/.test(s)) errs[f.field_key] = `${f.label} must be an amount like 500 or 1250.50.`;
    if (f.input_type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) errs[f.field_key] = 'Enter a valid email address.';
    if (f.input_type === 'url' && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(s)) errs[f.field_key] = 'Enter a full link starting with https://';
    if (f.input_type === 'phone' && !/^\+?[\d\s()-]{7,20}$/.test(s)) errs[f.field_key] = 'Enter a valid phone number.';
    if (f.max_length && s.length > f.max_length) errs[f.field_key] = `${f.label} must be at most ${f.max_length} characters.`;
  }
  return errs;
}

/** Renders the admin-added fields of a form. */
export function CustomFields({ def, values = {}, onChange, errors = {}, title = 'Additional details' }) {
  const fields = def?.custom || [];
  if (!fields.length) return null;
  const set = (k, v) => onChange({ ...values, [k]: v });
  return (
    <div className="subcard">
      <div className="field-label">{title}</div>
      <div className="form-grid">
        {fields.map(f => {
          const v = values[f.field_key] ?? (f.input_type === 'multiselect' ? [] : f.input_type === 'checkbox' ? false : '');
          const err = errors[f.field_key];
          const common = { className: err ? 'err' : '', placeholder: f.placeholder || undefined, maxLength: f.max_length || undefined };
          let control;
          switch (f.input_type) {
            case 'textarea': control = <Textarea rows={2} {...common} value={v} onChange={e => set(f.field_key, e.target.value)} />; break;
            case 'money': control = <MoneyInput value={v} onChange={x => set(f.field_key, x)} className={`input mono ${err ? 'err' : ''}`} />; break;
            case 'number': control = <Input inputMode="decimal" {...common} value={v} onChange={e => set(f.field_key, e.target.value.replace(/[^\d.-]/g, ''))} />; break;
            case 'date': control = <Input type="date" {...common} value={v} onChange={e => set(f.field_key, e.target.value)} />; break;
            case 'email': control = <Input type="email" {...common} value={v} onChange={e => set(f.field_key, e.target.value)} />; break;
            case 'url': control = <Input type="url" {...common} placeholder={f.placeholder || 'https://'} value={v} onChange={e => set(f.field_key, e.target.value)} />; break;
            case 'phone': control = <Input type="tel" inputMode="tel" {...common} placeholder={f.placeholder || '+92 300 1234567'} value={v} onChange={e => set(f.field_key, e.target.value)} />; break;
            case 'checkbox': control = <label className="check" style={{ paddingTop: 6 }}><input type="checkbox" checked={Boolean(v)} onChange={e => set(f.field_key, e.target.checked)} /><span>{f.help || 'Yes'}</span></label>; break;
            case 'select': control = <div className={err ? 'has-error' : ''}><Select value={v} onChange={x => set(f.field_key, x)} options={[...(f.required ? [] : [{ value: '', label: '—' }]), ...f.options.map(o => ({ value: o.value, label: o.label }))]} /></div>; break;
            case 'multiselect': control = (
              <div className="chips">
                {f.options.map(o => { const on = v.includes(o.value); return <button type="button" key={o.id} className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => set(f.field_key, on ? v.filter(x => x !== o.value) : [...v, o.value])}>{o.label}</button>; })}
              </div>); break;
            default: control = <Input {...common} value={v} onChange={e => set(f.field_key, e.target.value)} />;
          }
          return (
            <Field key={f.id} label={f.label} required={f.required && f.input_type !== 'checkbox'} hint={err ? undefined : f.input_type === 'checkbox' ? undefined : f.help || undefined} full={f.input_type === 'textarea' || f.input_type === 'multiselect'}>
              <span data-no-translate style={{ display: 'contents' }}>{control}</span>
              {err && <span className="error">{err}</span>}
            </Field>
          );
        })}
      </div>
    </div>
  );
}

/** Read-only list of extra values (detail views). */
export function CustomValues({ def, values }) {
  const fields = (def?.custom || []).filter(f => values?.[f.field_key] !== undefined && values[f.field_key] !== '' && values[f.field_key] !== null);
  if (!fields.length) return null;
  const show = (f, v) => (Array.isArray(v) ? v.join(', ') : f.input_type === 'checkbox' ? (v ? 'Yes' : 'No') : f.input_type === 'url' ? <a href={v} target="_blank" rel="noopener noreferrer">{v}</a> : String(v));
  return fields.map(f => <FragmentDl key={f.id} l={f.label} v={show(f, values[f.field_key])} />);
}
const FragmentDl = ({ l, v }) => <><dt>{l}</dt><dd data-no-translate>{v}</dd></>;
