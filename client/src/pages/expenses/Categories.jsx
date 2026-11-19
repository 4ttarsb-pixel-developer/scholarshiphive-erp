import { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useServerList } from '../../lib/useServerList.js';
import { Badge, Button, Card, Field, Input, Loader, Notice, Segmented, useConfirm, useToast } from '../../components/ui.jsx';
import { loadMeta } from './shared.jsx';

const SCOPES = [{ value: 'constant', label: 'Constant (fixed)' }, { value: 'variable', label: 'Variable (daily)' }, { value: 'petty', label: 'Petty cash' }];

export default function Categories() {
  const toast = useToast();
  const confirm = useConfirm();
  const [scope, setScope] = useState('constant');
  const list = useServerList('/expenses/categories', { scope });
  const [open, setOpen] = useState({});
  const [newCat, setNewCat] = useState({ name: '', description: '', allow_custom: false });
  const [newItem, setNewItem] = useState({});
  const [rename, setRename] = useState({});
  const done = msg => { toast.success(msg); list.reload(); loadMeta(true).catch(() => {}); };
  const call = async (fn, msg) => { try { await fn(); done(msg); } catch (e) { toast.error(e.message); } };
  const rows = list.data || [];
  return (
    <div className="stack">
      <Notice type="info">These lists power the <b>Category → Expense item → Other</b> dropdowns. Built-in items can be switched off (hidden) but not deleted, so old records stay readable. Renaming updates past records too.</Notice>
      <div className="row"><Segmented value={scope} onChange={x => { setScope(x); setOpen({}); }} options={SCOPES} /></div>
      <div className="grid grid-main">
        <Card title={`${SCOPES.find(s => s.value === scope).label} categories`} subtitle={`${rows.length} categories · click one to see its items`} pad={false}>
          {!list.data ? <Loader /> : rows.map(c => (
            <div key={c.id} className={`cat-row ${c.is_active ? '' : 'off'}`}>
              <div className="cat-head">
                <button type="button" className="icon-btn" onClick={() => setOpen(o => ({ ...o, [c.id]: !o[c.id] }))} aria-label="Show items">{open[c.id] ? <ChevronDown /> : <ChevronRight />}</button>
                {rename[c.id] !== undefined ? <Input value={rename[c.id]} maxLength={60} onChange={e => setRename(r => ({ ...r, [c.id]: e.target.value }))} style={{ maxWidth: 320 }} autoFocus />
                  : <div style={{ minWidth: 0, flex: 1 }} onClick={() => setOpen(o => ({ ...o, [c.id]: !o[c.id] }))} role="button" tabIndex={0}><b>{c.name}</b> {c.allow_custom && <Badge tone="purple">write your own</Badge>} {!c.is_active && <Badge tone="grey">Hidden</Badge>}<div className="small muted">{c.description || `${c.subs.length} items`}</div></div>}
                <div className="row" style={{ gap: 4 }}>
                  <span className="small muted">{c.subs.length} items</span>
                  {rename[c.id] !== undefined
                    ? <><Button size="sm" variant="primary" icon={Save} onClick={() => call(() => api.put(`/expenses/categories/${c.id}`, { name: rename[c.id] }), 'Renamed.').then(() => setRename(r => { const n = { ...r }; delete n[c.id]; return n; }))}>Save</Button><Button size="sm" onClick={() => setRename(r => { const n = { ...r }; delete n[c.id]; return n; })}>Cancel</Button></>
                    : <Button size="sm" variant="ghost" onClick={() => setRename(r => ({ ...r, [c.id]: c.name }))}>Rename</Button>}
                  <Button size="sm" variant="ghost" icon={c.is_active ? EyeOff : Eye} title={c.is_active ? 'Hide from forms' : 'Show in forms'} onClick={() => call(() => api.put(`/expenses/categories/${c.id}`, { is_active: !c.is_active }), c.is_active ? 'Hidden from forms.' : 'Visible again.')} />
                  {!c.is_system && <Button size="sm" variant="ghost" icon={Trash2} title="Delete" onClick={async () => { if (await confirm({ title: `Delete “${c.name}”?`, message: 'Only possible if no record uses it.', danger: true, ok: 'Delete' })) call(() => api.del(`/expenses/categories/${c.id}`), 'Deleted.'); }} />}
                </div>
              </div>
              {open[c.id] && (
                <div className="cat-items">
                  {c.subs.map(s => (
                    <div key={s.id} className={`cat-item ${s.is_active ? '' : 'off'}`}>
                      {rename[s.id] !== undefined ? <Input value={rename[s.id]} maxLength={120} onChange={e => setRename(r => ({ ...r, [s.id]: e.target.value }))} autoFocus />
                        : <span>{s.name} {!s.is_system && <Badge tone="blue">added</Badge>} {!s.is_active && <Badge tone="grey">Hidden</Badge>}</span>}
                      <span className="row" style={{ gap: 2 }}>
                        {rename[s.id] !== undefined
                          ? <Button size="sm" variant="primary" icon={Save} onClick={() => call(() => api.put(`/expenses/categories/${s.id}`, { name: rename[s.id] }), 'Renamed.').then(() => setRename(r => { const n = { ...r }; delete n[s.id]; return n; }))} aria-label="Save" />
                          : <Button size="sm" variant="ghost" onClick={() => setRename(r => ({ ...r, [s.id]: s.name }))}>Rename</Button>}
                        <Button size="sm" variant="ghost" icon={s.is_active ? EyeOff : Eye} title={s.is_active ? 'Hide' : 'Show'} onClick={() => call(() => api.put(`/expenses/categories/${s.id}`, { is_active: !s.is_active }), s.is_active ? 'Hidden.' : 'Visible again.')} />
                        {!s.is_system && <Button size="sm" variant="ghost" icon={Trash2} title="Delete" onClick={() => call(() => api.del(`/expenses/categories/${s.id}`), 'Deleted.')} />}
                      </span>
                    </div>
                  ))}
                  {!c.allow_custom && (
                    <div className="row" style={{ marginTop: 8 }}>
                      <Input placeholder={`New item in ${c.name}`} maxLength={120} value={newItem[c.id] || ''} onChange={e => setNewItem(x => ({ ...x, [c.id]: e.target.value }))} style={{ flex: 1, minWidth: 180 }} />
                      <Button size="sm" icon={Plus} disabled={(newItem[c.id] || '').trim().length < 2} onClick={() => call(() => api.post('/expenses/categories', { scope, parent_id: c.id, name: newItem[c.id].trim() }), 'Item added.').then(() => setNewItem(x => ({ ...x, [c.id]: '' })))}>Add item</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </Card>
        <Card title="Add a category">
          <div className="form">
            <Field label="Category name" required><Input maxLength={60} value={newCat.name} onChange={e => setNewCat(s => ({ ...s, name: e.target.value }))} placeholder="e.g. Branch Office Costs" /></Field>
            <Field label="Short description"><Input maxLength={300} value={newCat.description} onChange={e => setNewCat(s => ({ ...s, description: e.target.value }))} placeholder="Shown under the dropdown" /></Field>
            <label className="check"><input type="checkbox" checked={newCat.allow_custom} onChange={e => setNewCat(s => ({ ...s, allow_custom: e.target.checked }))} /><span>People type the expense name themselves (like “Others”)</span></label>
            <Button variant="primary" icon={Plus} disabled={newCat.name.trim().length < 2} onClick={() => call(() => api.post('/expenses/categories', { scope, ...newCat, name: newCat.name.trim() }), 'Category added.').then(() => setNewCat({ name: '', description: '', allow_custom: false }))}>Add to {SCOPES.find(s => s.value === scope).label}</Button>
            <p className="hint">Add items to it from the list on the left.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
