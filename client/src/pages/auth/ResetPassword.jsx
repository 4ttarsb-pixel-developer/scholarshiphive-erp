import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, KeyRound, LogIn } from 'lucide-react';
import AuthShell from './AuthShell.jsx';
import { Button, Field, Loader, Notice, PasswordInput, passwordOk, passwordRuleText } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') || '';
  const viaGoogle = params.get('google') === 'verified';
  const [check, setCheck] = useState(null);
  const [error, setError] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!token && !viaGoogle) { setError('This page needs the link from your email. Request a new one.'); return; }
    api.get(viaGoogle ? '/auth/reset/check?google=1' : `/auth/reset/check?token=${encodeURIComponent(token)}`).then(setCheck).catch(e => setError(e.message));
    if (token) window.history.replaceState(null, '', '/reset-password?t=1'); // keep the secret out of the address bar / history
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async e => {
    e.preventDefault();
    setError('');
    if (!passwordOk(pw)) { setError(passwordRuleText()); return; }
    if (pw !== pw2) { setError('Password and Confirm Password do not match.'); return; }
    setBusy(true);
    try { await api.post('/auth/reset', { token: token || undefined, password: pw, confirm_password: pw2 }); setDone(true); } catch (x) { setError(x.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <div className="auth-icon"><KeyRound /></div>
      <h1>Set a new password</h1>
      {done ? (
        <div className="stack" style={{ gap: 14 }}>
          <div className="verified"><CheckCircle2 /><div><b>Password changed</b><div className="small">You were logged out on all devices. Log in with your new password.</div></div></div>
          <Button variant="primary" icon={LogIn} onClick={() => nav('/login')} block>Go to login</Button>
        </div>
      ) : error && !check ? (
        <div className="stack" style={{ gap: 12 }}>
          <Notice type="error">{error}</Notice>
          <Link className="btn btn-primary" to="/forgot-password">Request a new link</Link>
        </div>
      ) : !check ? <Loader /> : (
        <>
          <p className="sub">For <b data-no-translate>{check.email}</b>{check.via === 'google' ? ' (verified with Google)' : ''}</p>
          <form className="form" onSubmit={submit}>
            {error && <Notice type="error">{error}</Notice>}
            <Field label="New password" required><PasswordInput value={pw} onChange={setPw} showRules autoFocus /></Field>
            <Field label="Confirm new password" required><PasswordInput value={pw2} onChange={setPw2} /></Field>
            <Button variant="primary" type="submit" loading={busy} block>Save new password</Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
