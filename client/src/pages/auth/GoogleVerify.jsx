import { useState } from 'react';
import { BadgeCheck, FlaskConical } from 'lucide-react';
import { GoogleIcon } from './AuthShell.jsx';
import { Button, Field, Input, Notice } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';

/** Step that proves the email belongs to the person (Google OAuth). */
export default function GoogleVerify({ mode }) {
  const { boot, refresh } = useAuth();
  const v = boot?.verified;
  const [devEmail, setDevEmail] = useState('');
  const [devName, setDevName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (v && (v.mode === mode || (mode === 'register' && v.mode !== 'setup') || mode === 'setup')) {
    return (
      <div className="verified">
        <BadgeCheck />
        <div style={{ flex: 1 }}><b>{v.email}</b><div className="small muted">Email verified with Google{v.name ? ` · ${v.name}` : ''}</div></div>
        <Button size="sm" variant="ghost" onClick={async () => { await api.post('/auth/google/clear'); refresh(); }}>Change</Button>
      </div>
    );
  }
  const devVerify = async () => {
    if (!devEmail.trim()) { setErr('Enter an email address.'); return; }
    setBusy(true); setErr('');
    try { await api.post('/auth/google/dev-verify', { email: devEmail, name: devName, mode }); await refresh(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ gap: 12 }}>
      <a className="google-btn" href={`/api/auth/google/start?mode=${mode}`}><GoogleIcon />Verify my email with Google</a>
      <p className="hint" style={{ margin: 0 }}>Your Google email becomes your login email. All system emails (approval, salary, announcements) are sent here.</p>
      {!boot?.google?.configured && !boot?.google?.devBypass && <Notice type="warn">Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the .env file (SETUP_GUIDE.md), then restart the server.</Notice>}
      {boot?.google?.devBypass && (
        <div className="card card-pad form" style={{ borderStyle: 'dashed' }}>
          <div className="row small strong"><FlaskConical size={16} /> Testing on PC only (GOOGLE_DEV_BYPASS=true)</div>
          {err && <Notice type="error">{err}</Notice>}
          <div className="form-grid">
            <Field label="Email"><Input type="email" value={devEmail} onChange={e => setDevEmail(e.target.value)} placeholder="test@gmail.com" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); devVerify(); } }} /></Field>
            <Field label="Name"><Input value={devName} onChange={e => setDevName(e.target.value)} placeholder="Test User" /></Field>
          </div>
          <Button type="button" loading={busy} onClick={devVerify}>Verify without Google (dev mode)</Button>
        </div>
      )}
    </div>
  );
}
