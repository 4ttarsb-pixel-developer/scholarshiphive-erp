import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Moon, Sun, Type, KeyRound, Send, FileText } from 'lucide-react';
import { useAuth, useLoad } from '../../lib/auth.jsx';
import { LANGS, useLang } from '../../lib/i18n.jsx';
import { api, fileUrl } from '../../lib/api.js';
import { Avatar, Badge, Button, Card, DataTable, Field, Loader, Notice, PasswordInput, Segmented, Select, Textarea, passwordOk, passwordRuleText, useToast } from '../../components/ui.jsx';
import { date, dateTime, titleCase } from '../../lib/format.js';

export default function UserSettings() {
  const { tab = 'appearance' } = useParams();
  return (
    <>
      <div className="page-head"><div><h1>My Settings</h1><p>Your own preferences, profile, password and requests to admin.</p></div></div>
      {tab === 'appearance' && <Appearance />}
      {tab === 'profile' && <Profile />}
      {tab === 'security' && <Security />}
      {tab === 'requests' && <Requests />}
    </>
  );
}

function Appearance() {
  const { user, setLook } = useAuth();
  const toast = useToast();
  const set = async (t, f) => { try { await setLook(t, f); toast.success('Saved — this stays until you change it.'); } catch (e) { toast.error(e.message); } };
  return (
    <div className="grid grid-2">
      <Card title="Theme" subtitle="Saved to your account — same on every device">
        <div className="grid grid-2" style={{ gap: 12 }}>
          {[['light', 'Light', Sun, '#f4f6fb', '#0b1733', '#1d4ed8'], ['dark', 'Dark neon', Moon, '#05070f', '#060915', '#22d3ee']].map(([k, l, I, bg, side, acc]) => (
            <button key={k} className="card" onClick={() => set(k)} style={{ padding: 12, cursor: 'pointer', textAlign: 'left', outline: user.theme === k ? '2px solid var(--primary)' : 'none', background: 'var(--surface)' }}>
              <div style={{ height: 80, borderRadius: 8, background: bg, display: 'flex', overflow: 'hidden', border: '1px solid var(--border)' }}>
                <div style={{ width: 28, background: side }} />
                <div style={{ flex: 1, padding: 8 }}><div style={{ height: 8, width: '60%', background: acc, borderRadius: 4, boxShadow: k === 'dark' ? `0 0 8px ${acc}` : 'none' }} /><div style={{ height: 22, marginTop: 8, borderRadius: 6, background: k === 'dark' ? '#0b1020' : '#fff', border: `1px solid ${k === 'dark' ? 'rgba(56,189,248,.3)' : '#e5e9f2'}` }} /></div>
              </div>
              <div className="row strong" style={{ marginTop: 8, gap: 6 }}><I size={16} />{l}{user.theme === k && <Badge tone="blue">Current</Badge>}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card title="Font size" subtitle="Makes all text bigger or smaller">
        <div className="stack" style={{ gap: 14 }}>
          <Segmented value={user.font_size} onChange={f => set(undefined, f)} options={[{ value: 'small', label: 'Small' }, { value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }, { value: 'xlarge', label: 'Extra large' }]} />
          <div className="row muted"><Type size={18} /><span>The quick brown fox — PKR 1,250,000</span></div>
        </div>
      </Card>
      <LanguageCard />
    </div>
  );
}

function LanguageCard() {
  const { changeLanguage } = useAuth();
  const { lang } = useLang();
  const toast = useToast();
  const choose = async l => { try { await changeLanguage(l); toast.success('Language saved.'); } catch (e) { toast.error(e.message); } };
  return (
    <Card title="Language" subtitle="English, Roman Urdu or Urdu — saved to your account">
      <div className="lang-cards" data-no-translate>
        {LANGS.map(l => (
          <button key={l.code} type="button" className={`lang-card ${lang === l.code ? 'on' : ''}`} onClick={() => choose(l.code)} aria-pressed={lang === l.code}>
            <b className={l.code === 'ur' ? 'urdu-label' : ''}>{l.native}</b>
            <small>{l.code === 'en' ? 'Welcome to ScholarshipHive' : l.code === 'roman' ? 'ScholarshipHive mein khush aamdeed' : 'اسکالرشپ ہائیو میں خوش آمدید'}</small>
          </button>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>Names, notes and amounts you type stay exactly as written.</p>
    </Card>
  );
}

function Profile() {
  const { user } = useAuth();
  const { data, loading, error } = useLoad(`/users/${user.id}`);
  if (!data) return error ? <Notice type="error">{error.message}</Notice> : <Loader />;
  const u = data.user;
  return (
    <div className="grid grid-main">
      <Card>
        <div className="profile-head" style={{ marginBottom: 16 }}>
          <Avatar fileId={u.photo_file_id} name={u.full_name} size={84} />
          <div><h2>{u.full_name}</h2><div className="muted">{u.employee_code} · {u.designation || titleCase(u.role)}</div><div className="row" style={{ marginTop: 6 }}><Badge status={u.status} /><Badge tone="purple">{titleCase(u.role)}</Badge>{u.google_verified && <Badge tone="green">Google verified</Badge>}</div></div>
        </div>
        <dl className="dl">
          <dt>Email</dt><dd>{u.email}</dd><dt>Father name</dt><dd>{u.father_name || '—'}</dd><dt>CNIC</dt><dd>{u.cnic || '—'}</dd>
          <dt>Contact numbers</dt><dd>{[u.phone1, u.phone2].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>Address</dt><dd>{u.address || '—'}</dd><dt>Permanent address</dt><dd>{u.permanent_address || '—'}</dd>
          <dt>Education</dt><dd>{(u.education || []).length ? u.education.map((e, i) => <div key={i}>{e.degree} — {e.institute} ({e.year}{e.grade ? `, ${e.grade}` : ''})</div>) : '—'}</dd>
          <dt>Joined</dt><dd>{date(u.created_at)}</dd><dt>Last login</dt><dd>{dateTime(u.last_login_at)}</dd>
        </dl>
        <p className="hint" style={{ marginTop: 14 }}>To correct any personal detail, send a request to admin (Requests to Admin tab).</p>
      </Card>
      <Card title="My documents">
        {[...data.files.filter(f => f.kind === 'cv').map(f => ({ ...f, label: 'CV' })), ...data.documents.map(d => ({ ...d, id: d.file_id }))].map(f => (
          <div key={f.id} className="list-row"><a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="row" style={{ gap: 6 }}><FileText size={15} />{f.label}</a><Badge status={f.verify_status} /></div>
        ))}
        {!data.documents.length && !data.files.some(f => f.kind === 'cv') && <div className="muted small">No documents.</div>}
      </Card>
    </div>
  );
}

function Security() {
  const { logout } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async e => {
    e.preventDefault(); setErr('');
    if (!passwordOk(f.new_password)) return setErr(passwordRuleText());
    if (f.new_password !== f.confirm_password) return setErr('New password and confirmation do not match.');
    setBusy(true);
    try { await api.put('/auth/password', f); toast.success('Password changed.'); setF({ current_password: '', new_password: '', confirm_password: '' }); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-2">
      <Card title="Change password">
        <form className="form" onSubmit={save}>
          {err && <Notice type="error">{err}</Notice>}
          <Field label="Current password" required><PasswordInput value={f.current_password} onChange={v => setF(x => ({ ...x, current_password: v }))} autoComplete="current-password" /></Field>
          <Field label="New password" required><PasswordInput value={f.new_password} onChange={v => setF(x => ({ ...x, new_password: v }))} showRules /></Field>
          <Field label="Confirm new password" required><PasswordInput value={f.confirm_password} onChange={v => setF(x => ({ ...x, confirm_password: v }))} /></Field>
          <Button variant="primary" type="submit" icon={KeyRound} loading={busy}>Change password</Button>
        </form>
      </Card>
      <Card title="Session">
        <p className="muted small">For security you are logged out automatically after 30 minutes without any activity.</p>
        <Button onClick={() => logout()}>Log out now</Button>
      </Card>
    </div>
  );
}

function Requests() {
  const { boot } = useAuth();
  const toast = useToast();
  const [v, setV] = useState(0);
  const { data, loading } = useLoad('/requests/mine', [v]);
  const [f, setF] = useState({ type: 'access', module: '', level: 'view', message: '' });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api.post('/requests', f); toast.success('Request sent to admin.'); setF({ type: 'access', module: '', level: 'view', message: '' }); setV(x => x + 1); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid grid-main">
      <Card title="My requests" pad={false}>
        <DataTable loading={loading} search={false} rows={data || []} empty="You have not sent any request." columns={[
          { key: 'created_at', label: 'Sent', render: r => dateTime(r.created_at) }, { key: 'type', label: 'Type', render: r => titleCase(r.type) },
          { key: 'module', label: 'Details', render: r => (r.module ? `${boot.modules.find(m => m.key === r.module)?.label || r.module} (${r.level})` : r.message) },
          { key: 'status', label: 'Status', render: r => <Badge status={r.status} /> }, { key: 'response', wrap: true, label: 'Admin reply', render: r => r.response || '—' }]} />
      </Card>
      <Card title="Send a request to admin">
        <div className="form">
          <Field label="Request type"><Segmented value={f.type} onChange={t => setF(x => ({ ...x, type: t }))} options={[{ value: 'access', label: 'Page access' }, { value: 'profile', label: 'Correct my details' }, { value: 'other', label: 'Other' }]} /></Field>
          {f.type === 'access' && <>
            <Field label="Page" required><Select value={f.module} onChange={m => setF(x => ({ ...x, module: m }))} options={boot.modules.map(m => ({ value: m.key, label: m.label }))} placeholder="Select page" /></Field>
            <Field label="Access"><Segmented value={f.level} onChange={l => setF(x => ({ ...x, level: l }))} options={[{ value: 'view', label: 'View only' }, { value: 'edit', label: 'View + edit' }]} /></Field>
          </>}
          <Field label="Message" required={f.type !== 'access'}><Textarea rows={3} value={f.message} onChange={e => setF(x => ({ ...x, message: e.target.value }))} /></Field>
          <Button variant="primary" icon={Send} loading={busy} onClick={send} disabled={f.type === 'access' ? !f.module : !f.message.trim()}>Send request</Button>
        </div>
      </Card>
    </div>
  );
}
