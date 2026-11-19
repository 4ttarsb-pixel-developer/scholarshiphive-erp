import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, X, Ban, Unlock, Trash2, ShieldPlus, ShieldMinus, FileText, Mail, Send, UserX, AlertTriangle, ExternalLink, KeyRound, Copy, BellRing } from 'lucide-react';
import { Search, TrendingUp, Receipt, Wallet, ClipboardCheck, BadgeDollarSign, Building2, Landmark, LineChart, Megaphone, Users as Users2, ShieldCheck, LayoutGrid, List, IdCard, Phone, WalletCards } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { api, fileUrl } from '../../lib/api.js';
import { useDebounced, useServerList, useTableQuery } from '../../lib/useServerList.js';
import ServerTable, { CardTabs, FilterChips } from '../../components/ServerTable.jsx';
import { Avatar, Badge, Button, Card, DataTable, ExportButtons, Field, Input, Loader, Modal, Notice, PasswordInput, Person, Segmented, Select, useConfirm, useToast } from '../../components/ui.jsx';
import { date, dateTime, titleCase } from '../../lib/format.js';
import FormFields, { SecuritySettings } from './FormFields.jsx';

export default function AdminSettings() {
  const { tab = 'users' } = useParams();
  const titles = { users: ['Users & Roles', 'Approve registrations, assign page access, block or delete users.'], requests: ['Requests', 'Access and other requests sent by employees.'], admins: ['Admins', 'Up to 3 admins including the Super Admin.'], forms: ['Forms & Fields', 'Master fields, their sub options and extra fields of every form.'], security: ['Security', 'Password length rule and login protections.'], email: ['Email', 'Automatic email status and history.'], activity: ['Activity Log', 'Who did what, and when.'] };
  const [t, s] = titles[tab] || titles.users;
  return (
    <>
      <div className="page-head"><div><h1>{t}</h1><p>{s}</p></div></div>
      {tab === 'users' && <Users />}
      {tab === 'requests' && <Requests />}
      {tab === 'admins' && <Admins />}
      {tab === 'forms' && <FormFields />}
      {tab === 'security' && <SecuritySettings />}
      {tab === 'email' && <Email />}
      {tab === 'activity' && <Activity />}
    </>
  );
}

// Module → icon (employee tiles show which pages a person can open)
export const MODULE_ICONS = { revenue: TrendingUp, expenses: Receipt, marketing: TrendingUp, petty_cash: Wallet, expense_approve: ClipboardCheck, salary: BadgeDollarSign, assets: Building2, liabilities: Landmark, cashflow: LineChart, announcements: Megaphone, users: Users2 };
const SEARCH_IN = [
  { value: '', label: 'All fields' }, { value: 'name', label: 'Name' }, { value: 'code', label: 'Emp ID' }, { value: 'cnic', label: 'CNIC' },
  { value: 'phone', label: 'Phone' }, { value: 'email', label: 'Email' }, { value: 'designation', label: 'Designation' }, { value: 'father', label: 'Father name' },
];
const PLACEHOLDER = { '': 'Search name, Emp ID, CNIC, phone, email…', name: 'Type the name', code: 'e.g. SH-0004', cnic: 'e.g. 35202-1234567-1 (dashes optional)', phone: 'e.g. 0300 1234567', email: 'e.g. ali@', designation: 'e.g. Counsellor', father: 'Father name' };
const SORTS = [{ value: 'smart', label: 'Pending first, newest' }, { value: 'name', label: 'Name A–Z' }, { value: 'code', label: 'Emp ID' }, { value: 'last_login', label: 'Last login' }, { value: 'created', label: 'Registered' }];

export function AccessIcons({ u, modules }) {
  if (u.role !== 'employee') return <span className="access-icons"><Badge tone="purple"><ShieldCheck size={11} />Full access</Badge></span>;
  const p = Object.entries(u.perms || {});
  if (!p.length) return <span className="access-icons muted small">No page access</span>;
  return (
    <span className="access-icons">
      {p.map(([k, l]) => { const I = MODULE_ICONS[k] || KeyRound; const label = modules.find(m => m.key === k)?.label || k; return <span key={k} className={`ai ${l}`} title={`${label} — ${l === 'edit' ? 'view + edit' : 'view only'}`} aria-label={label}><I /></span>; })}
    </span>
  );
}

function Users() {
  const { boot } = useAuth();
  const nav = useNavigate();
  const [view, setView] = useState(() => { try { return localStorage.getItem('sh_users_view') || 'tiles'; } catch { return 'tiles'; } });
  const [q, setQ, resetQ] = useTableQuery({ status: '', role: '', q: '', field: '', module: '', budget: '', designation: '', sort: 'smart', dir: 'desc', limit: 24 });
  const search = useDebounced(q.q);
  const list = useServerList('/users', { status: q.status, role: q.role, q: search, field: q.field, module: q.module, budget: q.budget, designation: q.designation, page: q.page, limit: q.limit, sort: q.sort, dir: q.sort === 'name' || q.sort === 'code' ? 'asc' : q.dir });
  const c = list.data?.counts;
  const d = list.data;
  const setV = x => { setView(x); try { localStorage.setItem('sh_users_view', x); } catch { /* ignore */ } };
  const open = r => nav(`/settings/admin/users/${r.id}`);
  const chips = [
    { key: 'f', label: 'Search in', value: q.field ? SEARCH_IN.find(x => x.value === q.field)?.label : '', onRemove: () => setQ({ field: '' }) },
    { key: 'r', label: 'Role', value: q.role === 'admins' ? 'Admins' : q.role === 'employee' ? 'Employees' : '', onRemove: () => setQ({ role: '' }) },
    { key: 'm', label: 'Access', value: q.module === 'none' ? 'No page access' : boot.modules.find(m => m.key === q.module)?.label, onRemove: () => setQ({ module: '' }) },
    { key: 'b', label: 'Budget', value: { active: 'Active budget', closed: 'Closed budget', none: 'No budget' }[q.budget], onRemove: () => setQ({ budget: '' }) },
    { key: 'd', label: 'Designation', value: q.designation, onRemove: () => setQ({ designation: '' }) },
  ];
  return (
    <>
      {c?.pending > 0 && q.status !== 'pending' && <div style={{ marginBottom: 14 }}><Notice type="warn"><b>{c.pending}</b> new registration(s) waiting for approval. <button type="button" className="link-btn" onClick={() => setQ({ status: 'pending' })}>Show them</button></Notice></div>}
      <Card pad={false}>
        <CardTabs value={q.status} onChange={x => setQ({ status: x })} right={<ExportButtons dataset="users" />} tabs={[
          { value: '', label: 'All users', count: c?.all }, { value: 'pending', label: 'Pending', count: c?.pending }, { value: 'approved', label: 'Approved', count: c?.approved },
          { value: 'blocked', label: 'Blocked', count: c?.blocked }, { value: 'rejected', label: 'Rejected', count: c?.rejected }]} />
        <div className="filters">
          <div className="search wide emp-search">
            <Search />
            <input className="input" placeholder={PLACEHOLDER[q.field]} value={q.q} onChange={e => setQ({ q: e.target.value })} aria-label="Search employees" />
          </div>
          <Select value={q.field} onChange={x => setQ({ field: x })} options={SEARCH_IN} ariaLabel="Search in" />
          <Select value={q.role} onChange={x => setQ({ role: x })} options={[{ value: '', label: 'Any role' }, { value: 'admins', label: 'Admins' }, { value: 'employee', label: 'Employees' }]} ariaLabel="Role filter" />
          <Select value={q.module} onChange={x => setQ({ module: x })} options={[{ value: '', label: 'Any page access' }, { value: 'none', label: 'No page access' }, ...boot.modules.map(m => ({ value: m.key, label: `Has: ${m.label}` }))]} ariaLabel="Access filter" />
          <Select value={q.budget} onChange={x => setQ({ budget: x })} options={[{ value: '', label: 'Any budget' }, { value: 'active', label: 'Active budget' }, { value: 'closed', label: 'Closed budget' }, { value: 'none', label: 'No budget' }]} ariaLabel="Budget filter" />
          <Select value={q.designation} onChange={x => setQ({ designation: x })} searchable options={[{ value: '', label: 'Any designation' }, ...(d?.designations || []).map(x => ({ value: x, label: x }))]} ariaLabel="Designation filter" />
          <Select value={q.sort} onChange={x => setQ({ sort: x })} options={SORTS} ariaLabel="Sort" />
        </div>
        <div className="filters-foot row" style={{ justifyContent: 'space-between' }}>
          <FilterChips items={chips} onClear={() => resetQ({ status: q.status, limit: q.limit })} />
          <div className="spacer" />
          <Segmented value={view} onChange={setV} options={[{ value: 'tiles', label: <span className="row" style={{ gap: 5 }}><LayoutGrid size={14} />Tiles</span> }, { value: 'table', label: <span className="row" style={{ gap: 5 }}><List size={14} />List</span> }]} />
        </div>
        {list.error && <div className="card-body"><Notice type="error">{list.error.message}</Notice></div>}
        {view === 'tiles' ? (
          <div className="card-body">
            {!d && list.loading ? <Loader /> : d?.rows.length ? (
              <div className={`emp-grid ${list.loading ? 'is-loading' : ''}`}>
                {d.rows.map(u => (
                  <button type="button" key={u.id} className={`emp-tile s-${u.status}`} onClick={() => open(u)} title={`Open ${u.full_name}`}>
                    <div className="emp-top"><Avatar fileId={u.photo_file_id} name={u.full_name} size={56} /><span className="emp-status"><Badge status={u.status} /></span></div>
                    <b className="emp-name" data-no-translate>{u.full_name}</b>
                    <span className="emp-code mono">{u.employee_code}</span>
                    <span className="emp-des">{u.role === 'employee' ? u.designation || 'Employee' : titleCase(u.role)}</span>
                    <span className="emp-meta">{u.cnic && <span title="CNIC"><IdCard size={12} />{u.cnic}</span>}{u.phone1 && <span title="Phone"><Phone size={12} />{u.phone1}</span>}</span>
                    <div className="emp-foot"><AccessIcons u={u} modules={boot.modules} />{u.budget_state && <Badge tone={u.budget_state === 'active' ? 'orange' : 'grey'}><WalletCards size={11} />Budget</Badge>}</div>
                  </button>
                ))}
              </div>
            ) : <div className="empty-state"><Users2 /><div>{search ? 'No employee matches your search.' : 'No users.'}</div></div>}
            {d && d.pages > 1 && (
              <div className="pager" style={{ borderTop: 0, padding: '14px 0 0' }}>
                <span>Showing <b dir="ltr">{(d.page - 1) * d.limit + 1}–{Math.min(d.total, d.page * d.limit)}</b> of <b>{d.total}</b></span>
                <div className="pages">
                  <button type="button" className="pg" disabled={d.page <= 1} onClick={() => setQ({ page: d.page - 1 })} aria-label="Previous page">‹</button>
                  <span className="pg on">{d.page}</span>
                  <button type="button" className="pg" disabled={d.page >= d.pages} onClick={() => setQ({ page: d.page + 1 })} aria-label="Next page">›</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <ServerTable data={list.data} loading={list.loading} query={q} onQuery={setQ} onRowClick={open} pageSizes={[12, 24, 48, 96]} empty={search ? 'No user matches your search.' : 'No users.'} columns={[
            { key: 'employee_code', label: 'Emp ID', sort: 'code', render: r => <b className="mono">{r.employee_code}</b> },
            { key: 'full_name', label: 'Name', sort: 'name', render: r => <Person name={r.full_name} sub={r.email} fileId={r.photo_file_id} size={32} /> },
            { key: 'cnic', label: 'CNIC', className: 'hide-md', render: r => <span className="mono small">{r.cnic || '—'}</span> },
            { key: 'designation', label: 'Designation', sort: 'designation', render: r => r.designation || '—' },
            { key: 'status', label: 'Status', sort: 'status', render: r => <Badge status={r.status} /> },
            { key: 'perms', label: 'Page access', wrap: true, render: r => <AccessIcons u={r} modules={boot.modules} /> },
            { key: 'last_login_at', label: 'Last login', sort: 'last_login', render: r => (r.last_login_at ? dateTime(r.last_login_at) : '—') }]} />
        )}
      </Card>
    </>
  );
}

export function PermissionMatrix({ value, onChange, modules }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {modules.map(m => (
        <div key={m.key} className="list-row" style={{ alignItems: 'center' }}>
          <div style={{ minWidth: 0 }}><b style={{ fontSize: '.86rem' }}>{m.label}</b><div className="small muted">{m.note}</div></div>
          <Segmented value={value[m.key] || 'none'} onChange={l => onChange({ ...value, [m.key]: l })} options={[{ value: 'none', label: 'No access' }, { value: 'view', label: 'View' }, { value: 'edit', label: 'Edit' }]} />
        </div>
      ))}
      <div className="row"><Button size="sm" onClick={() => onChange({})}>Clear all</Button><Button size="sm" onClick={() => onChange(Object.fromEntries(modules.map(m => [m.key, 'view'])))}>View all</Button></div>
    </div>
  );
}

export function UserDetail({ id, onChanged, onDeleted }) {
  const { boot, user: me, isSuper } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, reload } = useLoad(`/users/${id}`);
  const [perms, setPerms] = useState({});
  const [designation, setDesignation] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [resetUrl, setResetUrl] = useState(null);
  useEffect(() => { if (data) { setPerms(data.perms || {}); setDesignation(data.user.designation || ''); } }, [data]);
  if (loading && !data) return <Loader />;
  if (!data) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  const u = data.user;
  const isSelf = u.id === me.id;
  const protectedUser = u.role === 'super_admin' || (u.role === 'admin' && !isSuper);
  const run = async (key, fn, msg) => {
    setBusy(key);
    try { await fn(); toast.success(msg); reload(); onChanged?.(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const cleanPerms = Object.fromEntries(Object.entries(perms).filter(([, l]) => l && l !== 'none'));
  const allFiles = [
    ...data.files.map(f => ({ ...f, label: f.kind === 'photo' ? 'Profile picture' : 'CV' })),
    ...data.documents.map(d => ({ id: d.file_id, label: d.label, original_name: d.original_name, mime: d.mime, verify_status: d.verify_status, verify_note: d.verify_note, duplicate_of: d.duplicate_of })),
  ];
  const verify = (f, status) => run('f' + f.id + status, () => api.post(`/files/${f.id}/verify`, { status }), `Marked ${status}.`);
  const del = async () => {
    if (!(await confirm({ title: `Delete ${u.full_name}?`, message: 'This permanently removes the account and documents. Users with sales or paid salary records cannot be deleted — block them instead.', danger: true, ok: 'Delete user' }))) return;
    try { await api.del(`/users/${u.id}`); toast.success('User deleted.'); onChanged?.(); onDeleted?.(); } catch (e) { toast.error(e.message); }
  };
  return (
    <>
      <div className="stack">
        <div className="profile-head">
          <Avatar fileId={u.photo_file_id} name={u.full_name} size={80} />
          <div style={{ flex: 1 }}><h3>{u.full_name}</h3><div className="small muted">{u.email} {u.google_verified ? '· Google verified ✔' : '· not Google verified'}</div><div className="row" style={{ marginTop: 6 }}><Badge status={u.status} /><Badge tone="purple">{titleCase(u.role)}</Badge></div></div>
        </div>
        {u.status === 'rejected' && u.reject_reason && <Notice type="error">Rejected: {u.reject_reason}</Notice>}

        <Card title="Personal details">
          <dl className="dl">
            <dt>Father name</dt><dd>{u.father_name || '—'}</dd><dt>CNIC</dt><dd>{u.cnic || '—'}</dd>
            <dt>Contact 1</dt><dd>{u.phone1 || '—'}</dd><dt>Contact 2</dt><dd>{u.phone2 || '—'}</dd>
            <dt>Address</dt><dd>{u.address || '—'}</dd><dt>Permanent address</dt><dd>{u.permanent_address || '—'}</dd>
            <dt>Education</dt><dd>{(u.education || []).length ? u.education.map((e, i) => <div key={i}>{e.degree} — {e.institute} ({e.year}{e.grade ? `, ${e.grade}` : ''})</div>) : '—'}</dd>
            <dt>Family background</dt><dd>{u.family_background || '—'}</dd><dt>Left last job because</dt><dd>{u.last_job_reason || '—'}</dd><dt>About</dt><dd>{u.about || '—'}</dd>
            <dt>Registered</dt><dd>{dateTime(u.created_at)}</dd><dt>Last login</dt><dd>{dateTime(u.last_login_at)}</dd>
          </dl>
        </Card>

        <Card title="Documents — check authenticity" subtitle="Files were already checked to be genuine images / PDFs / Word files. Open each and mark it valid or not.">
          {allFiles.map(f => (
            <div key={f.id} className="list-row" style={{ flexWrap: 'wrap' }}>
              <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="row" style={{ gap: 6 }}><FileText size={15} />{f.label}<ExternalLink size={12} /></a>
              <span className="row" style={{ gap: 6 }}>
                {f.duplicate_of && <Badge tone="orange"><AlertTriangle size={12} />Duplicate file</Badge>}
                <Badge status={f.verify_status} />
                {f.verify_status !== 'verified' && <Button size="sm" icon={Check} loading={busy === 'f' + f.id + 'verified'} onClick={() => verify(f, 'verified')}>Valid</Button>}
                {f.verify_status !== 'rejected' && <Button size="sm" icon={X} loading={busy === 'f' + f.id + 'rejected'} onClick={() => verify(f, 'rejected')}>Not valid</Button>}
              </span>
            </div>
          ))}
          {!allFiles.length && <div className="muted small">No files.</div>}
        </Card>

        {!protectedUser && !isSelf && u.role === 'employee' && (u.status === 'pending' || u.status === 'approved') && (
          <Card title={u.status === 'pending' ? 'Approve & assign page access' : 'Page access'} subtitle="Sidebar is visible to everyone; pages without access show “Not approved by admin”.">
            <div className="form">
              <Field label="Designation"><Input value={designation} onChange={e => setDesignation(e.target.value)} placeholder="e.g. Accountant" /></Field>
              <PermissionMatrix value={perms} onChange={setPerms} modules={boot.modules} />
              <div className="row">
                {u.status === 'pending'
                  ? <Button variant="success" icon={Check} loading={busy === 'approve'} onClick={() => run('approve', () => api.post(`/users/${u.id}/approve`, { designation, perms: cleanPerms }), 'User approved — email sent.')}>Approve user</Button>
                  : <><Button variant="primary" loading={busy === 'perms'} onClick={() => run('perms', () => api.put(`/users/${u.id}/permissions`, { perms: cleanPerms }), 'Access updated — email sent.')}>Save access</Button>
                    <Button loading={busy === 'des'} onClick={() => run('des', () => api.put(`/users/${u.id}/profile`, { designation }), 'Designation saved.')}>Save designation</Button></>}
              </div>
            </div>
          </Card>
        )}

        {!protectedUser && !isSelf && (
          <Card title="Account actions">
            <div className="stack" style={{ gap: 10 }}>
              {u.status === 'pending' && (
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 200 }}><Field label="Reason (sent to the user)"><Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Documents are not clear" /></Field></div>
                  <Button icon={UserX} loading={busy === 'reject'} onClick={() => run('reject', () => api.post(`/users/${u.id}/reject`, { reason }), 'Registration rejected.')}>Reject</Button>
                </div>
              )}
              <div className="row">
                {u.status === 'approved' && <Button icon={Ban} loading={busy === 'block'} onClick={async () => { if (await confirm({ title: `Block ${u.full_name}?`, message: 'They are logged out immediately and cannot log in.', danger: true, ok: 'Block' })) run('block', () => api.post(`/users/${u.id}/block`), 'User blocked.'); }}>Block</Button>}
                {u.status === 'blocked' && <Button icon={Unlock} loading={busy === 'unblock'} onClick={() => run('unblock', () => api.post(`/users/${u.id}/unblock`), 'User unblocked.')}>Unblock</Button>}
                {isSuper && u.status === 'approved' && u.role === 'employee' && <Button icon={ShieldPlus} loading={busy === 'mk'} onClick={async () => { if (await confirm({ title: `Make ${u.full_name} an admin?`, message: 'Admins get full access to everything (maximum 3 admins).', ok: 'Make admin' })) run('mk', () => api.post(`/users/${u.id}/make-admin`), 'User is now an admin.'); }}>Make admin</Button>}
                {isSuper && u.role === 'admin' && <Button icon={ShieldMinus} loading={busy === 'rm'} onClick={() => run('rm', () => api.post(`/users/${u.id}/remove-admin`), 'Admin role removed.')}>Remove admin</Button>}
                {u.status === 'approved' && <Button icon={KeyRound} loading={busy === 'reset'} onClick={async () => {
                  if (!(await confirm({ title: `Send a password reset link to ${u.full_name}?`, message: `A one-time link (valid 24 hours) is emailed to ${u.email}. You can also copy it and send it on WhatsApp.`, ok: 'Create link' }))) return;
                  setBusy('reset');
                  try { const r = await api.post(`/users/${u.id}/reset-link`); setResetUrl(r); toast.success(r.emailed ? 'Reset link emailed.' : 'Reset link created (email is not configured).'); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
                }}>Send password reset link</Button>}
                <Button variant="danger" icon={Trash2} onClick={del}>Delete user</Button>
              </div>
              {resetUrl && (
                <Notice type="success">
                  <div className="stack" style={{ gap: 6 }}>
                    <span>{resetUrl.emailed ? 'Link emailed. You can also copy it:' : 'Email is not configured — copy this link and send it to the user privately:'}</span>
                    <code className="copy-code" data-no-translate>{resetUrl.url}</code>
                    <div><Button size="sm" icon={Copy} onClick={() => { navigator.clipboard?.writeText(resetUrl.url).then(() => toast.success('Copied.'), () => toast.error('Copy failed — select the link and copy it.')); }}>Copy link</Button></div>
                  </div>
                </Notice>
              )}
            </div>
          </Card>
        )}
        {(protectedUser || isSelf) && <Notice type="info">{isSelf ? 'This is your own account. Manage it in My Settings or Admins tab.' : 'Only the Super Admin can change other admins; the Super Admin account cannot be changed by others.'}</Notice>}
      </div>
    </>
  );
}

function Requests() {
  const { boot } = useAuth();
  const toast = useToast();
  const [v, setV] = useState(0);
  const [reply, setReply] = useState({});
  const { data, loading } = useLoad('/requests', [v]);
  const handle = async (r, decision) => {
    try { await api.post(`/requests/${r.id}/handle`, { decision, response: reply[r.id] || '' }); toast.success(`Request ${decision}.`); setV(x => x + 1); } catch (e) { toast.error(e.message); }
  };
  return (
    <Card pad={false}>
      <DataTable loading={loading} rows={data || []} empty="No requests." columns={[
        { key: 'full_name', label: 'From', render: r => <Person name={r.full_name} sub={r.employee_code} fileId={r.photo_file_id} size={30} /> },
        { key: 'type', wrap: true, label: 'Request', render: r => <div><b>{r.module ? `${boot.modules.find(m => m.key === r.module)?.label} — ${r.level === 'edit' ? 'view + edit' : 'view'}` : titleCase(r.type)}</b>{r.message && <div className="small muted">{r.message}</div>}</div> },
        { key: 'created_at', label: 'Sent', render: r => dateTime(r.created_at) }, { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> },
        { key: 'act', label: '', sortable: false, render: r => r.status === 'open' ? (
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <Input style={{ minWidth: 140, minHeight: 34, padding: '6px 9px' }} placeholder="Reply (optional)" value={reply[r.id] || ''} onChange={e => setReply(x => ({ ...x, [r.id]: e.target.value }))} />
            <Button size="sm" variant="success" icon={Check} onClick={() => handle(r, 'approved')}>{r.type === 'access' ? 'Grant' : 'Done'}</Button>
            <Button size="sm" icon={X} onClick={() => handle(r, 'declined')}>Decline</Button>
          </div>) : <span className="small muted">{r.response || '—'}</span> }]} />
    </Card>
  );
}

function Admins() {
  const { user, isSuper, logout } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [v, setV] = useState(0);
  const { data, loading, error } = useLoad('/users?role=admins&limit=10', [v]);
  const { data: people } = useLoad('/users/directory', [v]);
  const [pick, setPick] = useState('');
  const [successor, setSuccessor] = useState('');
  const [pw, setPw] = useState('');
  if (!data) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  const admins = data.rows;
  const candidates = (people || []).filter(r => r.role === 'employee');
  const others = (people || []).filter(r => r.id !== user.id);
  const make = async () => {
    try { await api.post(`/users/${pick}/make-admin`); toast.success('Admin added.'); setPick(''); setV(x => x + 1); } catch (e) { toast.error(e.message); }
  };
  const remove = async u => {
    if (!(await confirm({ title: `Remove admin role from ${u.full_name}?`, message: 'They become a normal employee with no page access until you assign it.', ok: 'Remove admin' }))) return;
    try { await api.post(`/users/${u.id}/remove-admin`); toast.success('Removed.'); setV(x => x + 1); } catch (e) { toast.error(e.message); }
  };
  const deleteMe = async () => {
    if (isSuper && !successor) return toast.warn('Choose who becomes the new Super Admin.');
    if (!(await confirm({ title: 'Delete your own account?', message: isSuper ? 'The selected person becomes Super Admin with full access, then your account is permanently deleted.' : 'Your admin account is permanently deleted.', danger: true, ok: 'Delete my account' }))) return;
    try { await api.post('/users/me/delete-account', { password: pw, successor_id: successor }); toast.success('Account deleted.'); logout(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="grid grid-main">
      <Card title={`Admins (${admins.length} of ${data.maxAdmins})`} subtitle="Admins have full access. Only the Super Admin can add or remove admins." pad={false}>
        <DataTable search={false} rows={admins} columns={[
          { key: 'full_name', label: 'Admin', render: r => <Person name={r.full_name} sub={r.email} fileId={r.photo_file_id} size={32} /> },
          { key: 'role', label: 'Role', render: r => <Badge tone="purple">{titleCase(r.role)}</Badge> }, { key: 'last_login_at', label: 'Last login', render: r => dateTime(r.last_login_at) },
          { key: 'x', label: '', sortable: false, render: r => isSuper && r.role === 'admin' ? <Button size="sm" icon={ShieldMinus} onClick={() => remove(r)}>Remove</Button> : null }]} />
        {isSuper && admins.length < data.maxAdmins && (
          <div className="card-body row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 220 }}><Field label="Make an approved employee admin"><Select value={pick} onChange={setPick} options={candidates.map(c => ({ value: c.id, label: c.full_name, hint: c.employee_code }))} placeholder={candidates.length ? 'Select employee' : 'No approved employees'} /></Field></div>
            <Button variant="primary" icon={ShieldPlus} disabled={!pick} onClick={make}>Make admin</Button>
          </div>
        )}
      </Card>
      <Card title="Delete my account" subtitle={isSuper ? 'Hand over Super Admin to someone else first' : 'Remove your own admin account'}>
        <div className="form">
          {isSuper && <Field label="New Super Admin" required><Select value={successor} onChange={setSuccessor} options={others.map(o => ({ value: o.id, label: o.full_name, hint: titleCase(o.role) }))} placeholder="Select person" /></Field>}
          <Field label="Your password" required><PasswordInput value={pw} onChange={setPw} autoComplete="current-password" /></Field>
          <Button variant="danger" icon={Trash2} disabled={!pw} onClick={deleteMe}>Delete my account</Button>
          <p className="hint">The Super Admin account can never be deleted by anyone else.</p>
        </div>
      </Card>
    </div>
  );
}

function Email() {
  const { boot } = useAuth();
  const toast = useToast();
  const [v, setV] = useState(0);
  const [busy, setBusy] = useState(false);
  const { data, loading } = useLoad('/admin/email-log', [v]);
  const [daily, setDaily] = useState(false);
  const test = async () => {
    setBusy(true);
    try { const r = await api.post('/admin/test-email'); toast.success(`Test email sent to ${r.to}.`); } catch (e) { toast.error(e.message); } finally { setBusy(false); setV(x => x + 1); }
  };
  const runDaily = async () => {
    setDaily(true);
    try { const r = await api.post('/notifications/run-daily'); toast.success(r.skipped ? `Skipped: ${r.skipped}` : `Done — ${r.reminders || 0} reminder(s), ${r.emails || 0} email(s).`); } catch (e) { toast.error(e.message); } finally { setDaily(false); setV(x => x + 1); }
  };
  return (
    <div className="stack">
      <Card title="Gmail SMTP" actions={<Button icon={Send} loading={busy} onClick={test}>Send test email to me</Button>}>
        {boot.smtpConfigured ? <Notice type="success">SMTP is configured. Use “Send test email” to confirm Gmail accepts the App Password.</Notice>
          : <Notice type="warn">SMTP is not configured — emails are only logged below as “skipped”. Add SMTP_USER and SMTP_PASS (Gmail App Password) to .env and restart. Guide: SETUP_GUIDE.md</Notice>}
        <p className="small muted" style={{ marginBottom: 0 }}>Emails are sent automatically for: registration received, approval/rejection, access changes, blocking, salary approved/paid, announcements, replies, expense and petty-cash decisions, password changes.</p>
      </Card>
      <Card title="Payment reminders (daily check)" actions={<Button icon={BellRing} loading={daily} onClick={runDaily}>Run daily reminders now</Button>}>
        <p className="small muted" style={{ margin: 0 }}>Every day the system checks installment plans and sends due / overdue alarms (app notification and email). It runs automatically through Vercel Cron and whenever someone opens the app — use this button to run it right now.</p>
      </Card>
      <Card title="Email history" pad={false}>
        <DataTable loading={loading} rows={data || []} empty="No emails yet." columns={[
          { key: 'created_at', label: 'Time', render: r => dateTime(r.created_at) }, { key: 'to_email', label: 'To', render: r => <span className="row" style={{ gap: 6 }}><Mail size={14} />{r.to_email}</span> },
          { key: 'subject', wrap: true, label: 'Subject' }, { key: 'status', label: 'Status', render: r => <Badge tone={r.status === 'sent' ? 'green' : r.status === 'failed' ? 'red' : 'grey'}>{titleCase(r.status)}</Badge> }, { key: 'error', wrap: true, label: 'Error', render: r => r.error || '—' }]} />
      </Card>
    </div>
  );
}

function Activity() {
  const { data, loading } = useLoad('/admin/audit');
  return (
    <Card pad={false}>
      <DataTable loading={loading} rows={data || []} pageSize={30} tools={<ExportButtons dataset="audit" />} empty="No activity yet." columns={[
        { key: 'created_at', label: 'Time', render: r => dateTime(r.created_at) }, { key: 'user_name', label: 'User' }, { key: 'action', label: 'Action', render: r => <Badge tone="blue">{r.action}</Badge> },
        { key: 'entity', label: 'Record', render: r => (r.entity ? `${r.entity} #${r.entity_id}` : '—') },
        { key: 'details', wrap: true, label: 'Details', sortable: false, render: r => <span className="small muted" style={{ wordBreak: 'break-word' }}>{Object.entries(r.details || {}).map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`).join(' · ').slice(0, 160) || '—'}</span> }]} />
    </Card>
  );
}
