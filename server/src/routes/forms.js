// Admin Settings → Forms & Fields (master fields, sub options, custom fields) and Security (password policy).
import express from 'express';
import { one, many, query, tx } from '../db.js';
import { ah, bad, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { FORMS, INPUT_TYPES, formOr404, formDefinition, passwordPolicy, PASSWORD_LIMITS } from '../lib/forms.js';

const r = express.Router();
r.use(requireAuth);

const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s-]+/g, '_').slice(0, 50);
const bool = x => x === true || x === 'true' || x === 1 || x === '1';

/** List of forms with how many custom fields / options each has. */
r.get('/', requireAdmin, ah(async (_req, res) => {
  const counts = await many(`SELECT f.form_key, COUNT(DISTINCT f.id) FILTER (WHERE NOT f.is_system)::int AS custom,
                                    COUNT(o.id)::int AS options
                             FROM form_fields f LEFT JOIN form_field_options o ON o.field_id=f.id GROUP BY f.form_key`);
  const by = Object.fromEntries(counts.map(c => [c.form_key, c]));
  res.json({ forms: Object.entries(FORMS).map(([key, f]) => ({ key, label: f.label, custom: by[key]?.custom || 0, options: by[key]?.options || 0 })), inputTypes: INPUT_TYPES });
}));

/** Form definition. Everyone signed in can read it (needed to draw the form); admin also sees disabled items. */
r.get('/:form', ah(async (req, res) => {
  const form = formOr404(req.params.form);
  const admin = ['admin', 'super_admin'].includes(req.user.role) && req.query.all === '1';
  res.json(await formDefinition(form, { activeOnly: !admin }));
}));

function fieldBody(b, { isSystem = false } = {}) {
  const out = {
    label: v.text(b.label, 'Field name', { required: true, min: 2, max: 120 }),
    help: v.text(b.help, 'Help text', { max: 200 }),
    placeholder: v.text(b.placeholder, 'Placeholder', { max: 120 }),
    required: bool(b.required),
    active: b.active === undefined ? true : bool(b.active),
    sort_order: b.sort_order === undefined || b.sort_order === '' ? 100 : v.int(b.sort_order, 'Order', { min: 0, max: 100000 }),
  };
  if (!isSystem) {
    out.input_type = v.oneOf(b.input_type || 'text', INPUT_TYPES, 'Field type');
    out.max_length = b.max_length ? v.int(b.max_length, 'Max length', { min: 1, max: 2000 }) : null;
  }
  return out;
}

r.post('/:form/fields', requireAdmin, ah(async (req, res) => {
  const form = formOr404(req.params.form);
  const f = fieldBody(req.body);
  let key = slug(req.body.field_key || f.label);
  if (!key || /^\d/.test(key)) key = `field_${key}`;
  key = `x_${key}`.slice(0, 60); // custom keys never clash with built-in columns
  const exists = await one('SELECT id FROM form_fields WHERE form_key=$1 AND field_key=$2', [form, key]);
  if (exists) throw bad(`A field called "${f.label}" already exists in this form.`);
  const count = await one('SELECT COUNT(*)::int AS n FROM form_fields WHERE form_key=$1 AND NOT is_system', [form]);
  if (count.n >= 40) throw bad('A form can have at most 40 extra fields.');
  const options = Array.isArray(req.body.options) ? req.body.options.map(x => v.text(typeof x === 'object' ? x?.label : x, 'Option', { max: 120 })).filter(Boolean) : [];
  if (['select', 'multiselect'].includes(f.input_type) && !options.length) throw bad('Add at least one option for a dropdown field.');
  if (new Set(options.map(o => o.toLowerCase())).size !== options.length) throw bad('Two options have the same name.');
  const row = await tx(async db => {
    const x = (await db.query(`INSERT INTO form_fields(form_key,field_key,label,input_type,required,active,help,placeholder,max_length,sort_order,created_by)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [form, key, f.label, f.input_type, f.required, f.active, f.help, f.placeholder, f.max_length, f.sort_order, req.user.id])).rows[0];
    let i = 0;
    for (const o of options) { i += 1; await db.query('INSERT INTO form_field_options(field_id,value,label,sort_order) VALUES ($1,$2,$2,$3)', [x.id, o, i * 10]); }
    await audit(db, req.user, 'form.field_create', 'form_field', x.id, { form, key, label: f.label, type: f.input_type });
    return x;
  });
  res.status(201).json(row);
}));

r.put('/fields/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM form_fields WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const f = fieldBody(req.body, { isSystem: cur.is_system });
  if (cur.is_system) {
    // built-in lists: only the name / help can change (the code relies on them being there)
    await query('UPDATE form_fields SET label=$1, help=$2, updated_at=NOW() WHERE id=$3', [f.label, f.help, cur.id]);
  } else {
    if (f.input_type !== cur.input_type) {
      const used = await usedCount(cur);
      if (used > 0) throw bad(`This field already has data in ${used} record(s), so its type cannot change. Create a new field instead.`);
    }
    await query('UPDATE form_fields SET label=$1,input_type=$2,required=$3,active=$4,help=$5,placeholder=$6,max_length=$7,sort_order=$8,updated_at=NOW() WHERE id=$9',
      [f.label, f.input_type, f.required, f.active, f.help, f.placeholder, f.max_length, f.sort_order, cur.id]);
  }
  await audit(null, req.user, 'form.field_update', 'form_field', cur.id, f);
  res.json({ ok: true });
}));

async function usedCount(field) {
  const table = FORMS[field.form_key]?.table;
  if (!table) return 0;
  const r2 = await one(`SELECT COUNT(*)::int AS n FROM ${table} WHERE custom_fields ? $1`, [field.field_key]);
  return r2.n;
}

/** Removes a custom field. If records already hold a value it is switched off instead (data is kept). */
r.delete('/fields/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT * FROM form_fields WHERE id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  if (cur.is_system) throw bad('Built-in fields cannot be removed. You can disable individual options instead.');
  const used = await usedCount(cur);
  if (used > 0) {
    await query('UPDATE form_fields SET active=FALSE, updated_at=NOW() WHERE id=$1', [cur.id]);
    await audit(null, req.user, 'form.field_disable', 'form_field', cur.id, { used });
    return res.json({ ok: true, disabled: true, message: `Field switched off — ${used} record(s) keep their saved value.` });
  }
  await query('DELETE FROM form_fields WHERE id=$1', [cur.id]);
  await audit(null, req.user, 'form.field_delete', 'form_field', cur.id, { label: cur.label });
  res.json({ ok: true, deleted: true });
}));

// ── Options (master → sub) ──
r.post('/fields/:id/options', requireAdmin, ah(async (req, res) => {
  const field = await one('SELECT * FROM form_fields WHERE id=$1', [v.id(req.params.id)]);
  if (!field) throw notFound();
  if (!['select', 'multiselect'].includes(field.input_type)) throw bad('Options can only be added to a dropdown field.');
  if (field.is_system && field.form_key === 'assets' && field.field_key === 'liquidity') throw bad('Liquidity levels are fixed (High, Medium, Low). Add categories under them instead.');
  if (field.is_system && field.form_key === 'capital' && field.field_key === 'capital_class') throw bad('Capital types are fixed. You can rename them.');
  const label = v.text(req.body.label, 'Option name', { required: true, max: 120 });
  let parentId = null;
  if (field.depends_on) {
    parentId = v.id(req.body.parent_option_id, 'Parent option');
    const parent = await one(`SELECT o.id FROM form_field_options o JOIN form_fields f ON f.id=o.field_id WHERE o.id=$1 AND f.form_key=$2 AND f.field_key=$3`, [parentId, field.form_key, field.depends_on]);
    if (!parent) throw bad('Choose the parent (master) option first.');
  }
  const dup = await one('SELECT id FROM form_field_options WHERE field_id=$1 AND COALESCE(parent_option_id,0)=COALESCE($2::bigint,0) AND lower(value)=lower($3)', [field.id, parentId, label]);
  if (dup) throw bad(`"${label}" is already in this list.`);
  // inherit useful meta from the parent (e.g. asset type for a new asset category)
  const meta = {};
  if (field.form_key === 'assets' && field.field_key === 'category') {
    const liq = await one('SELECT value FROM form_field_options WHERE id=$1', [parentId]);
    meta.asset_type = req.body.asset_type && ['fixed', 'current', 'intangible'].includes(req.body.asset_type) ? req.body.asset_type : (liq?.value === 'low' ? 'fixed' : 'current');
  }
  if (field.form_key === 'liabilities' && field.field_key === 'category') meta.type = ['loan', 'payable', 'other'].includes(req.body.type) ? req.body.type : 'other';
  const max = await one('SELECT COALESCE(MAX(sort_order),0)::int AS m FROM form_field_options WHERE field_id=$1 AND COALESCE(parent_option_id,0)=COALESCE($2::bigint,0)', [field.id, parentId]);
  const row = await one('INSERT INTO form_field_options(field_id,parent_option_id,value,label,meta,sort_order) VALUES ($1,$2,$3,$3,$4,$5) RETURNING *', [field.id, parentId, label, JSON.stringify(meta), max.m + 10]);
  await audit(null, req.user, 'form.option_create', 'form_option', row.id, { field: field.field_key, label });
  res.status(201).json(row);
}));

r.put('/options/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT o.*, f.form_key, f.field_key FROM form_field_options o JOIN form_fields f ON f.id=o.field_id WHERE o.id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  const label = v.text(req.body.label ?? cur.label, 'Option name', { required: true, max: 120 });
  const active = req.body.active === undefined ? cur.active : bool(req.body.active);
  const sort = req.body.sort_order === undefined ? cur.sort_order : v.int(req.body.sort_order, 'Order', { min: 0, max: 100000 });
  const fixed = (cur.form_key === 'assets' && cur.field_key === 'liquidity') || (cur.form_key === 'capital' && cur.field_key === 'capital_class');
  if (fixed && !active) throw bad('This level is fixed and cannot be switched off.');
  // The saved value stays the same for built-in / used options so existing records keep matching; only the label changes.
  await query('UPDATE form_field_options SET label=$1, active=$2, sort_order=$3 WHERE id=$4', [label, active, sort, cur.id]);
  await audit(null, req.user, 'form.option_update', 'form_option', cur.id, { label, active });
  res.json({ ok: true });
}));

r.delete('/options/:id', requireAdmin, ah(async (req, res) => {
  const cur = await one('SELECT o.*, f.form_key, f.field_key FROM form_field_options o JOIN form_fields f ON f.id=o.field_id WHERE o.id=$1', [v.id(req.params.id)]);
  if (!cur) throw notFound();
  if (cur.is_system) {
    if ((cur.form_key === 'assets' && cur.field_key === 'liquidity') || (cur.form_key === 'capital' && cur.field_key === 'capital_class')) throw bad('This level is fixed.');
    await query('UPDATE form_field_options SET active=FALSE WHERE id=$1', [cur.id]);
    return res.json({ ok: true, disabled: true, message: 'Built-in option switched off (records that use it keep it).' });
  }
  const used = await optionUsed(cur);
  if (used) {
    await query('UPDATE form_field_options SET active=FALSE WHERE id=$1', [cur.id]);
    return res.json({ ok: true, disabled: true, message: 'Option is used by saved records, so it was switched off instead of deleted.' });
  }
  await query('DELETE FROM form_field_options WHERE id=$1', [cur.id]);
  await audit(null, req.user, 'form.option_delete', 'form_option', cur.id, { label: cur.label });
  res.json({ ok: true, deleted: true });
}));

async function optionUsed(o) {
  const table = FORMS[o.form_key]?.table;
  if (!table) return false;
  const builtIn = { assets: ['category', 'sub_category', 'liquidity'], liabilities: ['category', 'sub_category'], capital: ['source_type', 'capital_class'] };
  if (builtIn[o.form_key]?.includes(o.field_key)) {
    return Boolean(await one(`SELECT 1 FROM ${table} WHERE ${o.field_key}=$1 LIMIT 1`, [o.value]));
  }
  return Boolean(await one(`SELECT 1 FROM ${table} WHERE custom_fields->>$1 = $2 OR (jsonb_typeof(custom_fields->$1)='array' AND custom_fields->$1 ? $2) LIMIT 1`, [o.field_key, o.value]));
}

// ── Security: password length ──
export const security = express.Router();
security.get('/password-policy', ah(async (_req, res) => res.json({ ...(await passwordPolicy()), limits: PASSWORD_LIMITS })));
security.put('/password-policy', requireAuth, requireAdmin, ah(async (req, res) => {
  const min = v.int(req.body.min, 'Minimum length', { min: PASSWORD_LIMITS.min, max: PASSWORD_LIMITS.max });
  const max = v.int(req.body.max, 'Maximum length', { min: PASSWORD_LIMITS.min, max: PASSWORD_LIMITS.max });
  if (max < min) throw bad('Maximum length cannot be less than the minimum.');
  await query(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES ('password_policy',$1,$2,NOW())
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, [JSON.stringify({ min, max }), req.user.id]);
  await audit(null, req.user, 'security.password_policy', 'settings', 'password_policy', { min, max });
  res.json({ ok: true, min, max });
}));

export default r;
