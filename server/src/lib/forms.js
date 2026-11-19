// ═══════════════════════════════════════════════════════════════
//  Form fields engine
//  • Built-in fields of every form are listed here (read-only for admin).
//  • Option lists (master → sub) and admin-added custom fields live in
//    form_fields / form_field_options.
//  • Custom field values are stored per record in a JSONB "custom_fields" column,
//    so adding / removing a field never changes a table and old data never breaks.
// ═══════════════════════════════════════════════════════════════
import { one, many } from '../db.js';
import { bad } from './http.js';
import * as v from './validate.js';

/** Every form an admin can extend. table = where custom values are stored. */
export const FORMS = {
  assets: { label: 'Assets', table: 'assets', perm: 'assets' },
  liabilities: { label: 'Liabilities', table: 'liabilities', perm: 'liabilities' },
  capital: { label: 'Capital', table: 'capital_entries', perm: 'cashflow' },
  sales: { label: 'New Sale / Deal', table: 'sales', perm: 'revenue' },
  expenses: { label: 'Expenses (constant & variable)', table: 'expenses', perm: 'expenses' },
  petty: { label: 'Petty Cash', table: 'petty_cash_entries', perm: 'petty_cash' },
  owner: { label: 'Owner Information', table: null, perm: null },
};
export const INPUT_TYPES = ['text', 'textarea', 'number', 'money', 'date', 'select', 'multiselect', 'checkbox', 'email', 'phone', 'url'];

// Built-in fields (shown in Admin Settings so admin sees the whole form). key, label, type, required, section
const F = (key, label, type = 'text', required = false, section = '') => ({ key, label, type, required, section });
export const SYSTEM_FIELDS = {
  assets: [
    F('liquidity', 'Liquidity', 'select', true, 'Classification'), F('category', 'Category', 'select', true, 'Classification'), F('sub_category', 'Sub-category', 'select', false, 'Classification'),
    F('asset_type', 'Asset type', 'select', true, 'Classification'), F('name', 'Asset name', 'text', true, 'Details'), F('quantity', 'Quantity', 'number', true, 'Details'),
    F('serial_no', 'Serial / reference no.', 'text', false, 'Details'), F('location', 'Location', 'text', false, 'Details'), F('custodian', 'Custodian (kept by)', 'text', false, 'Details'),
    F('purchase_date', 'Purchase / acquired date', 'date', true, 'Value'), F('cost', 'Cost', 'money', true, 'Value'), F('current_value', 'Current value', 'money', false, 'Value'),
    F('depreciation_rate', 'Depreciation % per year', 'number', false, 'Value'), F('vendor', 'Bought from (vendor)', 'text', false, 'Value'), F('payment_method', 'Payment method', 'select', false, 'Value'),
    F('reference_no', 'Payment reference', 'text', false, 'Value'), F('warranty_until', 'Warranty until', 'date', false, 'Value'), F('status', 'Status', 'select', true, 'Value'), F('notes', 'Notes', 'textarea', false, 'Value'),
  ],
  liabilities: [
    F('category', 'Liability category', 'select', true, 'Classification'), F('sub_category', 'Sub-category', 'select', false, 'Classification'), F('type', 'Liability type', 'select', true, 'Classification'),
    F('title', 'Title', 'text', true, 'Lender'), F('lender', 'Lender / creditor', 'text', true, 'Lender'), F('contact_phone', 'Lender phone', 'phone', false, 'Lender'), F('reference_no', 'Account / reference no.', 'text', false, 'Lender'),
    F('principal', 'Principal amount', 'money', true, 'Terms'), F('interest_type', 'Interest', 'select', true, 'Terms'), F('annual_rate', 'Annual interest rate %', 'number', false, 'Terms'), F('compounding', 'Compounding', 'select', false, 'Terms'),
    F('start_date', 'Start date', 'date', true, 'Terms'), F('term_months', 'Term (months)', 'number', true, 'Terms'), F('purpose', 'Purpose', 'text', false, 'Terms'), F('collateral', 'Collateral / security', 'text', false, 'Terms'), F('notes', 'Notes', 'textarea', false, 'Terms'),
  ],
  capital: [
    F('capital_class', 'Capital type', 'select', true, 'Classification'), F('type', 'Movement', 'select', true, 'Classification'), F('source_type', 'Source', 'select', true, 'Classification'),
    F('party', 'Owner / partner / investor name', 'text', true, 'Details'), F('share_pct', 'Ownership share %', 'number', false, 'Details'), F('amount', 'Amount', 'money', true, 'Details'),
    F('entry_date', 'Date', 'date', true, 'Details'), F('method', 'Payment method', 'select', false, 'Details'), F('reference_no', 'Reference no.', 'text', false, 'Details'), F('note', 'Note', 'textarea', false, 'Details'),
  ],
  sales: [
    F('employee_id', 'Employee (sales staff)', 'select', true, 'Staff & service'), F('sale_date', 'Sale date', 'date', true, 'Staff & service'), F('revenue_category', 'Revenue category', 'select', true, 'Staff & service'),
    F('service', 'Service provided', 'select', true, 'Staff & service'), F('package', 'Package', 'select', true, 'Staff & service'), F('name', 'Student / client name', 'text', true, 'Client'), F('phone', 'Client phone', 'phone', true, 'Client'),
    F('email', 'Client email', 'email', false, 'Client'), F('destination', 'Country (study destination)', 'select', true, 'Client'), F('total', 'Total package (PKR)', 'money', true, 'Payment'), F('advance', 'Advance received (PKR)', 'money', false, 'Payment'),
    F('installments', 'Installments', 'number', false, 'Installments & alarm'), F('reminder_days', 'Alarm / reminder before the due date', 'select', false, 'Installments & alarm'), F('notes', 'Note', 'textarea', false, 'Documents & notes'),
  ],
  expenses: [
    F('category_id', 'Category', 'select', true), F('sub_category_id', 'Item', 'select', true), F('title', 'Title', 'text', true), F('amount', 'Amount', 'money', true), F('expense_date', 'Date', 'date', true),
    F('paid_to', 'Paid to / vendor', 'text', true), F('payment_method', 'Payment method', 'select', true), F('location', 'Department / branch', 'text', false), F('reference_no', 'Reference no.', 'text', false), F('receipt', 'Receipt', 'text', false), F('description', 'Description', 'textarea', false),
  ],
  petty: [
    F('category_id', 'Category', 'select', true), F('sub_category_id', 'Item', 'select', true), F('title', 'Title', 'text', true), F('amount', 'Amount', 'money', true), F('entry_date', 'Date', 'date', true),
    F('purchased_by', 'Bought by', 'text', true), F('vendor', 'Shop / vendor', 'text', false), F('payment_mode', 'Paid with', 'select', false), F('location', 'Department', 'text', false), F('receipt', 'Receipt', 'text', false), F('description', 'Description', 'textarea', false),
  ],
  owner: [
    F('photo', 'Profile photo', 'text'), F('owner_name', 'Owner name', 'text'), F('headline', 'Headline / tagline', 'text'), F('about', 'About', 'textarea'), F('skills', 'Skills', 'text'),
    F('experience', 'Experience', 'text'), F('education', 'Education', 'text'), F('services', 'Services', 'text'), F('portfolio', 'Work / gallery', 'text'), F('socials', 'Social media accounts', 'url'), F('portfolio_url', 'Portfolio website', 'url'),
  ],
};

export function formOr404(key) {
  if (!Object.prototype.hasOwnProperty.call(FORMS, key)) throw bad('Unknown form.');
  return key;
}

/** Fields of a form (DB rows) with their option tree. activeOnly → what a person filling the form sees. */
export async function loadForm(formKey, { activeOnly = false } = {}) {
  const fields = await many(`SELECT * FROM form_fields WHERE form_key=$1 ${activeOnly ? 'AND active' : ''} ORDER BY is_system DESC, sort_order, id`, [formKey]);
  const ids = fields.map(f => f.id);
  const opts = ids.length ? await many(`SELECT * FROM form_field_options WHERE field_id = ANY($1::bigint[]) ${activeOnly ? 'AND active' : ''} ORDER BY sort_order, lower(label), id`, [ids]) : [];
  const byField = new Map();
  for (const o of opts) { if (!byField.has(o.field_id)) byField.set(o.field_id, []); byField.get(o.field_id).push(o); }
  return fields.map(f => ({ ...f, options: byField.get(f.id) || [] }));
}

/** Everything the front-end needs to draw a form: built-in list + option lists + custom fields. */
export async function formDefinition(formKey, opts) {
  const rows = await loadForm(formKey, opts);
  const byKey = Object.fromEntries(rows.map(r => [r.field_key, r]));
  return {
    form: formKey, label: FORMS[formKey].label,
    system: (SYSTEM_FIELDS[formKey] || []).map(s => ({ ...s, managed: byKey[s.key] || null })),
    lists: Object.fromEntries(rows.filter(r => r.is_system).map(r => [r.field_key, r])),
    custom: rows.filter(r => !r.is_system),
  };
}

/** Option row for a system select (null when the value is not in the active list). */
export async function findOption(formKey, fieldKey, value, parentValue) {
  if (!value) return null;
  const params = [formKey, fieldKey, value];
  let parentSql = '';
  if (parentValue !== undefined) {
    params.push(parentValue);
    parentSql = 'AND p.value = $4';
  }
  return one(`SELECT o.* FROM form_field_options o JOIN form_fields f ON f.id=o.field_id
              LEFT JOIN form_field_options p ON p.id=o.parent_option_id
              WHERE f.form_key=$1 AND f.field_key=$2 AND o.value=$3 AND o.active ${parentSql} LIMIT 1`, params);
}

/**
 * Checks a value of a system select against the admin-managed list.
 * The value already saved on the record is always accepted (an option disabled later never blocks editing).
 */
export async function checkOption(formKey, fieldKey, value, label, { parent, required = true, keep } = {}) {
  const s = String(value ?? '').trim();
  if (!s) { if (required) throw bad(`${label} is required.`); return { value: '', option: null }; }
  if (keep !== undefined && s === keep) return { value: s, option: await findOption(formKey, fieldKey, s) };
  const option = await findOption(formKey, fieldKey, s, parent);
  if (!option) throw bad(`${label} "${s.slice(0, 60)}" is not in the list. Choose one from the dropdown (admin can add more in Admin Settings → Forms & Fields).`);
  return { value: s, option };
}

const phoneRe = /^\+?[\d\s()-]{7,20}$/;

/** Validates admin-added custom fields. Returns a clean object { field_key: value }. */
export async function readCustom(formKey, raw, { existing = {} } = {}) {
  let input = raw;
  if (typeof input === 'string') { try { input = JSON.parse(input || '{}'); } catch { throw bad('Invalid extra fields.'); } }
  if (!input || typeof input !== 'object' || Array.isArray(input)) input = {};
  const fields = (await loadForm(formKey)).filter(f => !f.is_system);
  const out = {};
  // keep values of fields that admin has switched off / removed, so no data is ever lost
  for (const [k, val] of Object.entries(existing || {})) if (!fields.some(f => f.field_key === k && f.active)) out[k] = val;
  for (const f of fields.filter(x => x.active)) {
    const label = f.label;
    let val = input[f.field_key];
    const empty = val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length) || (f.input_type === 'checkbox' && val !== true && val !== 'true');
    if (empty) {
      if (f.required && f.input_type !== 'checkbox') throw bad(`${label} is required.`);
      if (f.input_type === 'checkbox') out[f.field_key] = false;
      continue;
    }
    const max = f.max_length || (f.input_type === 'textarea' ? 2000 : 300);
    switch (f.input_type) {
      case 'number': {
        const s = String(val).trim();
        if (!/^-?\d+(\.\d{1,4})?$/.test(s)) throw bad(`${label} must be a number.`);
        out[f.field_key] = Number(s); break;
      }
      case 'money': out[f.field_key] = v.amount(val, label, { allowZero: true }); break;
      case 'date': out[f.field_key] = v.date(val, label); break;
      case 'email': out[f.field_key] = v.email(val, label); break;
      case 'url': out[f.field_key] = v.url(val, label); break;
      case 'phone': {
        const s = String(val).trim();
        if (!phoneRe.test(s)) throw bad(`${label} is not a valid phone number.`);
        out[f.field_key] = s; break;
      }
      case 'checkbox': out[f.field_key] = true; break;
      case 'select': {
        const s = String(val).trim();
        if (!f.options.some(o => o.active && o.value === s) && existing?.[f.field_key] !== s) throw bad(`${label}: choose one of the listed options.`);
        out[f.field_key] = s; break;
      }
      case 'multiselect': {
        const list = (Array.isArray(val) ? val : [val]).map(x => String(x).trim()).filter(Boolean);
        const ok = new Set(f.options.filter(o => o.active).map(o => o.value));
        const prev = new Set(Array.isArray(existing?.[f.field_key]) ? existing[f.field_key] : []);
        if (list.some(x => !ok.has(x) && !prev.has(x))) throw bad(`${label}: choose from the listed options.`);
        out[f.field_key] = [...new Set(list)].slice(0, 50); break;
      }
      default: out[f.field_key] = v.text(val, label, { max });
    }
  }
  return out;
}

/** Saves custom values on a record (inside the caller's transaction when db is given). */
export async function saveCustom(db, formKey, id, values) {
  const table = FORMS[formKey]?.table;
  if (!table || !id) return;
  const sql = `UPDATE ${table} SET custom_fields=$1 WHERE id=$2`;
  const params = [JSON.stringify(values || {}), id];
  if (db) await db.query(sql, params); else { const { query } = await import('../db.js'); await query(sql, params); }
}

// ── Password policy (Admin Settings → Security) ──
export const PASSWORD_LIMITS = { min: 8, max: 128 };
export async function passwordPolicy() {
  const row = await one(`SELECT value FROM app_settings WHERE key='password_policy'`).catch(() => null);
  const min = Number(row?.value?.min) || 12;
  const max = Number(row?.value?.max) || Math.max(min, 12);
  return { min: Math.max(PASSWORD_LIMITS.min, Math.min(min, PASSWORD_LIMITS.max)), max: Math.max(min, Math.min(max, PASSWORD_LIMITS.max)) };
}
