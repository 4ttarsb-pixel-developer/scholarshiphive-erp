import { useEffect, useMemo, useRef } from 'react';
import { PenLine } from 'lucide-react';
import { Field, Input, Select } from './ui.jsx';

export const OTHER = 'other';

/**
 * Dependent dropdowns: Category → Expense item → "Other" (type your own).
 * value: { category_id, sub_category_id, sub_category_other, save_option }
 */
export default function CategoryPicker({ tree = [], value, onChange, errors = {}, canSave, labels = {} }) {
  const cat = useMemo(() => tree.find(c => String(c.id) === String(value.category_id)), [tree, value.category_id]);
  const subs = cat?.subs || [];
  const custom = Boolean(cat) && (cat.allow_custom || !subs.length || value.sub_category_id === OTHER);
  const otherRef = useRef(null);
  useEffect(() => { if (custom && value.sub_category_id === OTHER) otherRef.current?.focus(); }, [custom, value.sub_category_id]);
  const set = patch => onChange({ ...value, ...patch });
  return (
    <>
      <Field label={labels.category || 'Category'} required error={errors.category} hint={cat?.description || `${tree.length} categories`}>
        <Select value={value.category_id ? String(value.category_id) : ''} placeholder="Select category"
          options={tree.map(c => ({ value: String(c.id), label: c.name, hint: c.allow_custom ? 'write your own' : `${c.subs.length} items` }))}
          onChange={id => set({ category_id: id, sub_category_id: '', sub_category_other: '', save_option: false })} searchable={tree.length > 6} ariaLabel="Category" />
      </Field>
      {cat && !cat.allow_custom && subs.length > 0 && (
        <Field label={labels.item || 'Expense item'} required error={errors.item} hint={`${subs.length} options in ${cat.name}`}>
          <Select value={value.sub_category_id ? String(value.sub_category_id) : ''} placeholder="Select expense item"
            options={[...subs.map(s => ({ value: String(s.id), label: s.name })), { value: OTHER, label: 'Other — write your own…', hint: '✎' }]}
            onChange={id => set({ sub_category_id: id, sub_category_other: id === OTHER ? value.sub_category_other : '' })} searchable ariaLabel="Expense item" />
        </Field>
      )}
      {custom && (
        <Field label={cat.allow_custom || !subs.length ? 'Expense name' : 'Write the expense name'} required error={errors.other} full={cat.allow_custom}
          hint={cat.allow_custom ? 'Type exactly what this expense is for' : undefined}>
          <div className="input-affix">
            <input ref={otherRef} className="input" maxLength={120} value={value.sub_category_other || ''} onChange={e => set({ sub_category_other: e.target.value })} placeholder="e.g. Visa photo printing" />
            <span className="affix" aria-hidden="true"><PenLine /></span>
          </div>
          {canSave && !cat.allow_custom && (
            <label className="check" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={Boolean(value.save_option)} onChange={e => set({ save_option: e.target.checked })} />
              <span>Save as a new option under <b>{cat.name}</b> for next time</span>
            </label>
          )}
        </Field>
      )}
    </>
  );
}

/** Validates the picker on the client (the server checks again). */
export function checkCategory(tree, value) {
  const e = {};
  const cat = tree.find(c => String(c.id) === String(value.category_id));
  if (!cat) { e.category = 'Select a category'; return e; }
  const custom = cat.allow_custom || !cat.subs.length || value.sub_category_id === OTHER;
  if (!custom && !value.sub_category_id) e.item = 'Select the expense item (or choose Other)';
  if (custom && (value.sub_category_other || '').trim().length < 2) e.other = 'Write the expense name (at least 2 letters)';
  return e;
}

/** Fields to send to the API. */
export const categoryPayload = value => ({
  category_id: value.category_id,
  sub_category_id: value.sub_category_id || '',
  sub_category_other: value.sub_category_id === OTHER || !value.sub_category_id ? (value.sub_category_other || '').trim() : '',
  save_option: value.save_option ? 'true' : '',
});

/** Picker value from a saved record. */
export const categoryValue = (tree, rec) => {
  if (!rec) return { category_id: '', sub_category_id: '', sub_category_other: '', save_option: false };
  const cat = tree.find(c => c.id === rec.category_id);
  const linked = cat?.subs.find(s => s.id === rec.sub_category_id);
  if (linked) return { category_id: String(cat.id), sub_category_id: String(linked.id), sub_category_other: '', save_option: false };
  return { category_id: cat ? String(cat.id) : '', sub_category_id: cat && !cat.allow_custom && cat.subs.length ? OTHER : '', sub_category_other: rec.sub_category || '', save_option: false };
};
