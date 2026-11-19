import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleHelp, KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import AuthShell, { GoogleIcon } from './AuthShell.jsx';
import { Button, Field, Input, Notice, PasswordInput } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';

export default function Login() {
  const { boot, setUser, logoutReason, setLogoutReason } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(params.get('error') || '');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const r = await api.post('/auth/login', { email, password });
      setLogoutReason('');
      setUser(r.user);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p className="sub">Log in to ScholarshipHive ERP</p>
      <div className="stack" style={{ gap: 12 }}>
        {logoutReason && <Notice type="warn">{logoutReason}</Notice>}
        {error && <Notice type="error">{error}</Notice>}
      </div>
      <a className="google-btn" href="/api/auth/google/start?mode=login" style={{ marginTop: 14 }}><GoogleIcon />Continue with Google</a>
      {!boot?.google?.configured && <p className="hint" style={{ marginTop: 6 }}>Google sign-in will work after admin adds the Google keys (see SETUP_GUIDE.md).</p>}
      <div className="or">or with email</div>
      <form className="form" onSubmit={submit}>
        <Field label="Email" required><Input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" /></Field>
        <Field label="Password" required><PasswordInput value={password} onChange={setPassword} autoComplete="current-password" required /></Field>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: -6 }}><Link className="small strong row" style={{ gap: 5 }} to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}><KeyRound size={14} />Forgot password?</Link></div>
        <Button variant="primary" type="submit" loading={busy} icon={LogIn} block>Log in</Button>
      </form>
      <p className="small muted" style={{ marginTop: 18, textAlign: 'center' }}>New employee? <Link to="/register">Create your account</Link></p>
      <div className="auth-links">
        <Link to="/help"><CircleHelp size={15} />Help</Link>
        <Link to="/privacy"><ShieldCheck size={15} />Privacy policy</Link>
      </div>
    </AuthShell>
  );
}
