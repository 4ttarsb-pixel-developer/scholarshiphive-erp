import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Plus, Send, Trash2 } from 'lucide-react';
import AuthShell, { PhoneInput, phoneValid, cnicFormat } from './AuthShell.jsx';
import GoogleVerify from './GoogleVerify.jsx';
import { Button, Field, FileInput, Input, Notice, PasswordInput, Textarea, passwordOk, passwordRuleText } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';

const STEPS = ['Email', 'Personal', 'Contact', 'Education & documents', 'Password'];
const IMG = 'image/jpeg,image/png,image/webp';
const DOC = 'application/pdf,image/jpeg,image/png,image/webp';

export default function Register() {
  const { boot } = useAuth();
  const [params] = useSearchParams();
  const verified = boot?.verified && boot.verified.mode !== 'setup' ? boot.verified : null;
  const [step, setStep] = useState(verified ? 1 : 0);
  const [f, setF] = useState({ full_name: verified?.name || '', father_name: '', cnic: '', designation: '', phone1: '+92', phone2: '+92', address: '', permanent_address: '', family_background: '', last_job_reason: '', about: '' });
  const [edu, setEdu] = useState([{ degree: '', institute: '', year: '', grade: '' }]);
  const [photo, setPhoto] = useState(null);
  const [cv, setCv] = useState(null);
  const [docs, setDocs] = useState([{ label: 'CNIC copy (front & back)', file: null }]);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [sameAddr, setSameAddr] = useState(false);
  const [err, setErr] = useState(params.get('error') || '');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = k => e => setF(s => ({ ...s, [k]: e?.target ? e.target.value : e }));

  const check = s => {
    if (s === 0 && !verified) return 'Please verify your email with Google first.';
    if (s === 1) {
      if (f.full_name.trim().length < 3) return 'Please enter your full name.';
      if (f.father_name.trim().length < 3) return 'Please enter your father name.';
      if (!/^\d{5}-\d{7}-\d$/.test(f.cnic)) return 'CNIC must be 13 digits in the format 12345-1234567-1.';
      if (!photo) return 'Please add your profile picture.';
    }
    if (s === 2) {
      if (!phoneValid(f.phone1)) return 'Contact number 1 is not valid for the selected country code.';
      if (!phoneValid(f.phone2)) return 'Contact number 2 is not valid for the selected country code.';
      if (f.phone1 === f.phone2) return 'Contact number 1 and 2 must be different.';
      if (f.address.trim().length < 5) return 'Please enter your current address.';
      if (!sameAddr && f.permanent_address.trim().length < 5) return 'Please enter your permanent address.';
    }
    if (s === 3) {
      for (const [i, e] of edu.entries()) {
        if (!e.degree.trim() || !e.institute.trim()) return `Education #${i + 1}: degree and institute are required.`;
        if (!/^(19|20)\d{2}$/.test(e.year)) return `Education #${i + 1}: passing year must be like 2024.`;
      }
      if (!cv) return 'Please attach your CV (PDF or DOCX).';
      if (!docs.some(d => d.file)) return 'Please attach at least one document (e.g. CNIC copy or degree).';
      // The online server accepts about 4.5 MB per request — keep all files together under 4 MB.
      const totalMb = [photo, cv, ...docs.map(d => d.file)].filter(Boolean).reduce((a, x) => a + x.size, 0) / 1024 / 1024;
      if (totalMb > 4) return `All files together are ${totalMb.toFixed(1)} MB — the limit is 4 MB. Please use smaller scans (photos are shrunk automatically) or attach fewer documents.`;
    }
    if (s === 4) {
      if (!passwordOk(pw)) return passwordRuleText();
      if (pw !== pw2) return 'Password and Confirm Password do not match.';
    }
    return '';
  };
  const next = () => { const m = check(step); setErr(m); if (!m) setStep(s => s + 1); window.scrollTo(0, 0); };

  const submit = async e => {
    e.preventDefault();
    if (step < 4) { next(); return; }
    for (let s = 0; s <= 4; s++) { const m = check(s); if (m) { setErr(m); setStep(s); return; } }
    setBusy(true); setErr('');
    const withFiles = docs.filter(d => d.file);
    try {
      const r = await api.upload('/auth/register', {
        ...f, permanent_address: sameAddr ? f.address : f.permanent_address, education: edu, password: pw, confirm_password: pw2,
        photo, cv, documents: withFiles.map(d => d.file), document_labels: withFiles.map(d => d.label),
      });
      setDone(r);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <AuthShell>
        <div style={{ textAlign: 'center' }}>
          <CheckCircle2 size={56} color="var(--green)" />
          <h1 style={{ marginTop: 10 }}>Registration sent!</h1>
          <p className="sub">Your employee ID is <b>{done.employee_code}</b>. Admin will review your details and documents. You will get an email when your account is approved and your pages are assigned.</p>
          <Link className="btn btn-primary" to="/login">Go to login</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell wide>
      <h1>Employee registration</h1>
      <p className="sub">Fill in your details. After you submit, admin approves your account and gives you access.</p>
      <div className="steps">{STEPS.map((s, i) => <div key={s} className={`step ${i <= step ? 'on' : ''}`}>{i + 1}. {s}</div>)}</div>
      <form className="form" onSubmit={submit} noValidate>
        {err && <Notice type="error">{err}</Notice>}

        {step === 0 && <Field label="Verify your email with Google" required><GoogleVerify mode="register" /></Field>}

        {step === 1 && <div className="form-grid">
          <Field label="Full name (as on CNIC)" required><Input value={f.full_name} onChange={set('full_name')} /></Field>
          <Field label="Father name" required><Input value={f.father_name} onChange={set('father_name')} /></Field>
          <Field label="CNIC number" required hint="13 digits — dashes are added automatically"><Input value={f.cnic} onChange={e => set('cnic')(cnicFormat(e.target.value))} placeholder="35202-1234567-1" inputMode="numeric" /></Field>
          <Field label="Position applied for / designation"><Input value={f.designation} onChange={set('designation')} placeholder="e.g. Visa Consultant" /></Field>
          <Field label="Profile picture" required full hint="Clear face photo · JPG/PNG/WEBP · min 200×200 px · max 2 MB. Fake or damaged files are rejected.">
            <FileInput file={photo} onChange={setPhoto} accept={IMG} image label="Choose your photo" hint="Drag & drop or click" />
          </Field>
        </div>}

        {step === 2 && <div className="form-grid">
          <Field label="Contact number 1" required hint="Select country code, then number without the first 0"><PhoneInput value={f.phone1} onChange={set('phone1')} /></Field>
          <Field label="Contact number 2" required hint="Must be different from number 1"><PhoneInput value={f.phone2} onChange={set('phone2')} /></Field>
          <Field label="Current address" required full><Textarea rows={2} value={f.address} onChange={set('address')} /></Field>
          <label className="check full"><input type="checkbox" checked={sameAddr} onChange={e => setSameAddr(e.target.checked)} />Permanent address is the same as current address</label>
          {!sameAddr && <Field label="Permanent address" required full><Textarea rows={2} value={f.permanent_address} onChange={set('permanent_address')} /></Field>}
        </div>}

        {step === 3 && <>
          <div className="field-label">Education <span className="req" style={{ color: 'var(--red)' }}>*</span></div>
          {edu.map((e, i) => (
            <div key={i} className="card card-pad form-grid" style={{ padding: 14 }}>
              <Field label="Degree / certificate" required><Input value={e.degree} onChange={x => setEdu(l => l.map((y, j) => (j === i ? { ...y, degree: x.target.value } : y)))} placeholder="e.g. BS Computer Science" /></Field>
              <Field label="Institute" required><Input value={e.institute} onChange={x => setEdu(l => l.map((y, j) => (j === i ? { ...y, institute: x.target.value } : y)))} /></Field>
              <Field label="Passing year" required><Input value={e.year} inputMode="numeric" maxLength={4} onChange={x => setEdu(l => l.map((y, j) => (j === i ? { ...y, year: x.target.value.replace(/\D/g, '') } : y)))} placeholder="2024" /></Field>
              <Field label="Grade / CGPA"><div className="input-group"><Input value={e.grade} onChange={x => setEdu(l => l.map((y, j) => (j === i ? { ...y, grade: x.target.value } : y)))} />{edu.length > 1 && <Button type="button" variant="ghost" icon={Trash2} onClick={() => setEdu(l => l.filter((_, j) => j !== i))} aria-label="Remove" />}</div></Field>
            </div>
          ))}
          {edu.length < 6 && <Button type="button" size="sm" icon={Plus} onClick={() => setEdu(l => [...l, { degree: '', institute: '', year: '', grade: '' }])} style={{ alignSelf: 'flex-start' }}>Add education</Button>}
          <Field label="CV / Resume" required hint="PDF or DOCX, max 3 MB"><FileInput file={cv} onChange={setCv} accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" label="Choose CV" hint="PDF or Word (.docx)" /></Field>
          <div className="field-label">Documents <span style={{ color: 'var(--red)' }}>*</span> <span className="hint">(CNIC copy, degrees, experience letters — PDF/JPG/PNG, max 3 MB each, up to 5 · all files together max 4 MB)</span></div>
          {docs.map((d, i) => (
            <div key={i} className="form-grid" style={{ alignItems: 'end' }}>
              <Field label={`Document ${i + 1} name`}><Input value={d.label} onChange={x => setDocs(l => l.map((y, j) => (j === i ? { ...y, label: x.target.value } : y)))} /></Field>
              <div className="input-group" style={{ alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}><FileInput file={d.file} onChange={file => setDocs(l => l.map((y, j) => (j === i ? { ...y, file } : y)))} accept={DOC} label="Choose file" hint="PDF / image" /></div>
                {docs.length > 1 && <Button type="button" variant="ghost" icon={Trash2} onClick={() => setDocs(l => l.filter((_, j) => j !== i))} aria-label="Remove document" />}
              </div>
            </div>
          ))}
          {docs.length < 5 && <Button type="button" size="sm" icon={Plus} onClick={() => setDocs(l => [...l, { label: '', file: null }])} style={{ alignSelf: 'flex-start' }}>Add another document</Button>}
          <details className="card card-pad" style={{ padding: 14 }}>
            <summary className="strong" style={{ cursor: 'pointer' }}>Optional information</summary>
            <div className="form" style={{ marginTop: 12 }}>
              <Field label="Family background"><Textarea rows={2} value={f.family_background} onChange={set('family_background')} /></Field>
              <Field label="Why did you leave your last job?"><Textarea rows={2} value={f.last_job_reason} onChange={set('last_job_reason')} /></Field>
              <Field label="About you"><Textarea rows={3} value={f.about} onChange={set('about')} /></Field>
            </div>
          </details>
        </>}

        {step === 4 && <div className="form-grid">
          <Field label="Password" required><PasswordInput value={pw} onChange={setPw} showRules /></Field>
          <Field label="Confirm password" required error={pw2 && pw !== pw2 ? 'Passwords do not match' : ''}><PasswordInput value={pw2} onChange={setPw2} /></Field>
          <p className="hint full" style={{ margin: 0 }}>By registering you agree to the <Link to="/privacy" target="_blank">privacy policy</Link>. Your documents are only visible to admin and authorised HR staff.</p>
        </div>}

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
          {step > 0 ? <Button key="back" type="button" icon={ArrowLeft} onClick={() => { setErr(''); setStep(s => s - 1); }}>Back</Button> : <Link to="/login" className="btn btn-ghost">Back to login</Link>}
          {step < 4 ? <Button key="next" type="button" variant="primary" onClick={next}>Next <ArrowRight /></Button> : <Button key="submit" type="submit" variant="primary" loading={busy} icon={Send}>Submit registration</Button>}
        </div>
      </form>
    </AuthShell>
  );
}
