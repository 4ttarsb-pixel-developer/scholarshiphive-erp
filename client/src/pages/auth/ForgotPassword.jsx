import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, MailCheck, Send } from 'lucide-react';
import AuthShell, { GoogleIcon } from './AuthShell.jsx';
import { Button, Field, Input, Notice } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';

export default function ForgotPassword() {
  const { boot } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(params.get('error') || '');
  const submit = async e => {
    e.preventDefault();
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError('Enter the email address you use to log in.'); return; }
    setBusy(true);
    try { setDone(await api.post('/auth/forgot', { email: email.trim() })); } catch (x) { setError(x.message); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <Link to="/login" className="small row" style={{ gap: 6, marginBottom: 14 }}><ArrowLeft size={15} />Back to login</Link>
      <div className="auth-icon"><KeyRound /></div>
      <h1>Forgot password?</h1>
      <p className="sub">No problem. Choose one of the ways below to set a new password.</p>
      {error && <div style={{ marginBottom: 12 }}><Notice type="error">{error}</Notice></div>}
      {done ? (
        <div className="stack" style={{ gap: 12 }}>
          <div className="verified"><MailCheck /><div><b>Check your email</b><div className="small">{done.message}</div></div></div>
          {!done.emailEnabled && <Notice type="warn">Automatic emails are not switched on yet. Use “Verify with Google” below, or ask an admin to send you a reset link from Admin Settings → Users.</Notice>}
          {done.devLink && <Notice type="info">Test mode link (only shown on a PC without email): <a href={done.devLink} data-no-translate>open reset page</a></Notice>}
          <Button onClick={() => setDone(null)}>Send again</Button>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <div className="method-title"><span>1</span>Get a reset link by email</div>
          <Field label="Your email" required><Input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoFocus /></Field>
          <Button variant="primary" type="submit" icon={Send} loading={busy} block>Send reset link</Button>
        </form>
      )}
      {boot?.google?.configured && (
        <>
          <div className="or">or</div>
          <div className="method-title"><span>2</span>Verify with your Google account</div>
          <a className="google-btn" href="/api/auth/google/start?mode=reset"><GoogleIcon />Verify with Google &amp; set a new password</a>
          <p className="hint" style={{ marginTop: 6 }}>Use the same Google account (Gmail) that is registered in the ERP.</p>
        </>
      )}
      <div className="or">or</div>
      <div className="method-title"><span>{boot?.google?.configured ? 3 : 2}</span>Ask an admin</div>
      <p className="small muted" style={{ marginTop: 0 }}>An admin can open Admin Settings → Users & Roles, click your name and press “Send password reset link”. The link can also be shared with you on WhatsApp.</p>
    </AuthShell>
  );
}
