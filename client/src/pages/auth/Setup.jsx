import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import AuthShell, { PhoneInput, phoneValid, cnicFormat } from './AuthShell.jsx';
import GoogleVerify from './GoogleVerify.jsx';
import { Button, Field, FileInput, Input, Notice, PasswordInput, Textarea, passwordOk, passwordRuleText } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';

/** First-time setup → creates the Super Admin. Only name, photo, Google email and password are required. */
export default function Setup() {
  const { boot, refresh, setUser } = useAuth();
  const [params] = useSearchParams();
  const [f, setF] = useState({ full_name: boot?.verified?.name || '', designation: 'Owner / CEO', father_name: '', cnic: '', phone1: '+92', phone2: '+92', address: '', permanent_address: '', about: '' });
  const [photo, setPhoto] = useState(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [more, setMore] = useState(false);
  const [err, setErr] = useState(params.get('error') || '');
  const [busy, setBusy] = useState(false);
  const set = k => e => setF(s => ({ ...s, [k]: e?.target ? e.target.value : e }));
  const verified = boot?.verified;

  const submit = async e => {
    e.preventDefault(); setErr('');
    if (!verified) return setErr('Please verify your email with Google first.');
    if (f.full_name.trim().length < 3) return setErr('Please enter your full name.');
    if (!photo) return setErr('Please add your profile picture.');
    if (!passwordOk(pw)) return setErr(passwordRuleText());
    if (pw !== pw2) return setErr('Passwords do not match.');
    const optionalPhone = p => (p && p.length > 4 ? p : '');
    if (optionalPhone(f.phone1) && !phoneValid(f.phone1)) return setErr('Contact number 1 is not valid.');
    if (optionalPhone(f.phone2) && !phoneValid(f.phone2)) return setErr('Contact number 2 is not valid.');
    setBusy(true);
    try {
      const r = await api.upload('/auth/setup', { ...f, phone1: optionalPhone(f.phone1), phone2: optionalPhone(f.phone2), password: pw, confirm_password: pw2, photo });
      setUser(r.user);
      await refresh();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <AuthShell wide>
      <h1>First-time setup</h1>
      <p className="sub">Create the <b>Super Admin</b> account. The Super Admin has full access and approves every employee. This screen appears only once.</p>
      <form className="form" onSubmit={submit}>
        {err && <Notice type="error">{err}</Notice>}
        <Field label="1. Verify your email" required><GoogleVerify mode="setup" /></Field>
        <div className="form-grid">
          <Field label="Full name" required><Input value={f.full_name} onChange={set('full_name')} placeholder="e.g. Abdullah Nadeem" /></Field>
          <Field label="Designation"><Input value={f.designation} onChange={set('designation')} /></Field>
          <Field label="Profile picture" required full hint="Clear photo, JPG/PNG/WEBP, at least 200×200 px, max 2 MB"><FileInput file={photo} onChange={setPhoto} accept="image/jpeg,image/png,image/webp" image label="Choose photo" hint="Drag & drop or click" /></Field>
          <Field label="Password" required><PasswordInput value={pw} onChange={setPw} showRules /></Field>
          <Field label="Confirm password" required error={pw2 && pw !== pw2 ? 'Passwords do not match' : ''}><PasswordInput value={pw2} onChange={setPw2} /></Field>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(m => !m)}>{more ? 'Hide' : 'Add'} optional details (CNIC, phones, address)</button>
        {more && (
          <div className="form-grid">
            <Field label="Father name"><Input value={f.father_name} onChange={set('father_name')} /></Field>
            <Field label="CNIC"><Input value={f.cnic} onChange={e => set('cnic')(cnicFormat(e.target.value))} placeholder="35202-1234567-1" /></Field>
            <Field label="Contact number 1"><PhoneInput value={f.phone1} onChange={set('phone1')} /></Field>
            <Field label="Contact number 2"><PhoneInput value={f.phone2} onChange={set('phone2')} /></Field>
            <Field label="Address" full><Input value={f.address} onChange={set('address')} /></Field>
            <Field label="Permanent address" full><Input value={f.permanent_address} onChange={set('permanent_address')} /></Field>
            <Field label="About" full><Textarea value={f.about} onChange={set('about')} /></Field>
          </div>
        )}
        <Button variant="primary" type="submit" loading={busy} icon={ShieldCheck}>Create Super Admin & open ERP</Button>
      </form>
    </AuthShell>
  );
}
