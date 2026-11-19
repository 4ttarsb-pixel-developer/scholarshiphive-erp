import React, { useState } from 'react';
import { Eye, EyeOff, LockKeyhole, Mail, ArrowRight, ChartNoAxesCombined } from 'lucide-react';

const styles = `
.login-root{min-height:100vh;min-height:100dvh;display:grid;grid-template-columns:minmax(350px,46%) minmax(0,54%);position:relative;isolation:isolate;overflow:hidden;background:linear-gradient(105deg,#081f3a 0%,#0e3b66 32%,#246da2 56%,#c3e5fa 81%,#dceefa 100%);color:#153a5b;font-family:'DM Sans',sans-serif}
.login-root:before{content:"";position:absolute;inset:-35%;z-index:-1;background:linear-gradient(110deg,transparent 25%,#55b7ed16 42%,#ffffff33 52%,transparent 70%);transform:translateX(-12%);animation:login-gradient-drift 17s ease-in-out infinite alternate;pointer-events:none}
.login-root:after{content:"";position:absolute;right:10%;top:-40%;width:62%;height:180%;transform:rotate(17deg);background:linear-gradient(90deg,transparent,#d7effd24,transparent);filter:blur(30px);z-index:-1;pointer-events:none}
@keyframes login-gradient-drift{from{transform:translateX(-16%)}to{transform:translateX(18%)}}
.login-brand{color:#fff;display:flex;flex-direction:column;justify-content:space-between;position:relative;padding:clamp(28px,4.8vw,80px);background:linear-gradient(110deg,#0b2744a6 8%,#0b345c83 58%,transparent 100%)}
.login-brand:before{content:"";position:absolute;width:540px;height:540px;border:1px solid #ffffff20;border-radius:50%;right:-260px;bottom:-220px;box-shadow:0 0 0 65px #ffffff08,0 0 0 132px #ffffff08;pointer-events:none}
.login-wordmark{display:flex;align-items:center;gap:14px;position:relative;z-index:1}.login-wordmark img{width:64px;height:64px;border-radius:16px;background:#fff;padding:5px;object-fit:contain}.login-wordmark b{font:800 clamp(20px,2.2vw,27px) Manrope,sans-serif;letter-spacing:-1px}.login-wordmark small{display:block;color:#c2e3f9;letter-spacing:2px;font-size:10px;margin-top:4px}
.login-headline{position:relative;z-index:1;max-width:560px}.login-headline .tag{display:inline-flex;align-items:center;gap:8px;border:1px solid #ffffff47;padding:9px 13px;border-radius:99px;color:#d5efff;background:#ffffff0d;font-size:11px;font-weight:700}.login-headline h1{font:800 clamp(36px,4vw,66px)/1.16 Manrope,sans-serif;letter-spacing:-2px;margin:25px 0 20px}.login-headline h1 em{font-style:normal;color:#7edaff}.login-headline p{color:#d3eafa;font-size:15px;line-height:1.85}.login-brand-foot{font-size:12px;color:#acd0e9;position:relative;z-index:1}
.login-form-wrap{min-width:0;display:flex;justify-content:center;align-items:center;padding:clamp(20px,4vw,60px);position:relative}.login-panel{width:min(100%,470px);padding:clamp(25px,3.5vw,44px);border:1px solid rgba(255,255,255,.70);border-radius:26px;background:linear-gradient(145deg,rgba(247,252,255,.96),rgba(229,243,255,.94));background-clip:padding-box;box-shadow:0 28px 80px rgba(9,42,77,.24);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);overflow:hidden;isolation:isolate}
.login-overline{font-size:11px;letter-spacing:2.6px;font-weight:800;color:#1479b9}.login-panel h2{font:800 clamp(29px,2.8vw,38px) Manrope,sans-serif;margin:11px 0 9px;letter-spacing:-1.2px}.login-panel>p{font-size:13px;color:#6d8ba6;line-height:1.7;margin:0 0 29px}
.login-field{position:relative;display:flex;align-items:center;height:66px;border:1px solid #bdd8ed;border-radius:15px;background:rgba(255,255,255,.92);background-clip:padding-box;margin:18px 0 21px;overflow:hidden;isolation:isolate;transition:border-color .2s,box-shadow .2s,background .2s}
.login-field:focus-within{border-color:#2487ca;box-shadow:0 0 0 3px rgba(36,135,202,.16);background:#fff}
.login-field-icon{position:absolute;left:16px;top:50%;transform:translateY(-50%);color:#799db8;pointer-events:none;z-index:2}
.login-field input{position:relative;z-index:1;display:block;width:100%;height:100%;min-width:0;border:0!important;border-radius:0;background:transparent!important;background-clip:padding-box;color:#173e61!important;font-size:15px;outline:0!important;box-shadow:none!important;padding:24px 45px 8px 47px;appearance:none;-webkit-appearance:none}
.login-field input::placeholder{color:transparent}
.login-field input:-webkit-autofill,.login-field input:-webkit-autofill:hover,.login-field input:-webkit-autofill:focus{-webkit-text-fill-color:#173e61!important;box-shadow:inset 0 0 0 100px #f2f9ff!important;-webkit-box-shadow:inset 0 0 0 100px #f2f9ff!important;transition:background-color 5000s ease-in-out 0s}
.login-field label{position:absolute;left:47px;top:50%;transform:translateY(-50%);z-index:2;color:#6586a1;font-size:14px;pointer-events:none;max-width:calc(100% - 100px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:transparent;transition:top .18s,transform .18s,font-size .18s,color .18s,font-weight .18s}
.login-field.is-active label,.login-field:focus-within label,.login-field input:not(:placeholder-shown)~label,.login-field input:-webkit-autofill~label{top:11px;transform:none;font-size:10px;font-weight:800;letter-spacing:.15px;color:#0c73b1}
.login-field.is-active input,.login-field:focus-within input,.login-field input:not(:placeholder-shown){padding-top:25px}
.login-eye{cursor:pointer;position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:3;border:0;background:transparent;color:#648da9;display:grid;place-items:center;padding:8px;border-radius:9px}.login-eye:hover{background:#e2f2fc;color:#106dac}
.login-password-hint{color:#52758e;font-size:11px;line-height:1.6;margin:-8px 0 18px 2px}
.login-submit{width:100%;border:0;border-radius:13px;background:linear-gradient(110deg,#0866ad,#0d9cce);color:#fff;padding:16px;margin-top:4px;display:flex;align-items:center;justify-content:center;gap:12px;font-weight:800;cursor:pointer;box-shadow:0 12px 25px #097dc435;transition:.2s}.login-submit:hover{transform:translateY(-2px);box-shadow:0 15px 30px #097dc454}.login-submit:disabled{opacity:.6;cursor:wait;transform:none}.login-error{color:#b33245;background:#fff2f4;border:1px solid #ffdae0;padding:12px;border-radius:10px;margin-top:14px;font-size:12px}.login-note{font-size:11px;color:#7794ad;margin-top:22px;line-height:1.6;text-align:center}
@media(max-width:1050px){.login-root{grid-template-columns:40% 60%}.login-brand{padding:30px}.login-headline h1{font-size:clamp(31px,4vw,47px)}}
@media(max-width:750px){.login-root{grid-template-columns:1fr;align-content:start;background:linear-gradient(150deg,#092a4a 0%,#155b90 28%,#9bc8e4 64%,#d8edf9 100%)}.login-brand{padding:19px 20px;background:transparent;min-height:0}.login-headline,.login-brand-foot{display:none}.login-wordmark img{width:45px;height:45px}.login-wordmark b{font-size:19px}.login-wordmark small{font-size:8px}.login-form-wrap{min-height:calc(100dvh - 85px);padding:15px 16px 40px;align-items:center}.login-panel{max-width:470px;border-radius:21px;padding:clamp(20px,5vw,34px)}}
@media(max-width:390px){.login-panel{padding:20px 17px}.login-field{min-height:58px}.login-headline h1{font-size:31px}}
@media(prefers-reduced-motion:reduce){.login-root:before{animation:none}.login-field label,.login-submit{transition:none}}
`;

function FloatingField({ id, label, icon: Icon, type='text', value, onChange, autoComplete, suffix, minLength, maxLength }) {
  const [focused, setFocused] = useState(false);
  return <div className={'login-field '+(focused || value ? 'is-active' : '')}>
    <Icon className="login-field-icon" size={18}/>
    <input id={id} type={type} required value={value} autoComplete={autoComplete} placeholder=" " minLength={minLength} maxLength={maxLength}
      onChange={e=>onChange(e.target.value)} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} />
    <label htmlFor={id}>{label}</label>{suffix}
  </div>;
}

export default function LoginPage({onLogin}) {
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [show,setShow] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function submit(event) {
    event.preventDefault();setBusy(true);setError('');
    if(password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9\s]/.test(password)) {
      setError('Password needs 8+ characters, 1 capital letter, 1 number and 1 special character.');
      setBusy(false);
      return;
    }
    try { await onLogin({email,password}) }
    catch(err) {setError(err.message)}
    finally {setBusy(false)}
  }
  return <div className="login-root"><style>{styles}</style>
    <section className="login-brand" aria-label="Scholarshiphive introduction">
      <div className="login-wordmark"><img src="/assets/company-icon.jpg" alt="Scholarshiphive logo"/><div><b>Scholarshiphive</b><small>MARKETING INTELLIGENCE</small></div></div>
      <div className="login-headline"><span className="tag"><ChartNoAxesCombined size={16}/> EXPENSES · INSIGHTS · ACCOUNTABILITY</span><h1>Make every marketing rupee <em>count.</em></h1><p>One workspace for advertising, financial oversight, approvals, and confident decisions.</p></div>
      <div className="login-brand-foot">Scholarshiphive · Market Expenses Analyzer</div>
    </section>
    <main className="login-form-wrap"><section className="login-panel" aria-label="Sign in">
      <div className="login-overline">WORKSPACE ACCESS</div><h2>Welcome back</h2><p>Sign in with your account to open the marketing workspace.</p>
      <form onSubmit={submit}>
        <FloatingField id="email" label="Email address" icon={Mail} type="email" autoComplete="username" value={email} onChange={setEmail}/>
        <FloatingField id="password" label="Password" icon={LockKeyhole} type={show?'text':'password'} autoComplete="current-password" value={password} onChange={setPassword} minLength={8} maxLength={128} suffix={<button type="button" className="login-eye" aria-label={show?'Hide password':'Show password'} onClick={()=>setShow(v=>!v)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button>}/>
        <p className="login-password-hint">Password: 8+ characters, including 1 uppercase letter, 1 number and 1 symbol.</p>
        {error&&<div className="login-error" role="alert">{error}</div>}
        <button className="login-submit" disabled={busy} type="submit">{busy?'Signing in...':'Sign in to workspace'}<ArrowRight size={18}/></button>
      </form>
      <p className="login-note">Local development environment · Demo accounts are documented in README, not shown on this page.</p>
    </section></main>
  </div>;
}
