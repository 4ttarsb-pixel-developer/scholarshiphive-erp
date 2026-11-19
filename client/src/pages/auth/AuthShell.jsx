import { CheckCircle2, CircleHelp, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import LanguageSwitcher from '../../components/LanguageSwitcher.jsx';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { Select } from '../../components/ui.jsx';

/** Top-right tools on the login / register pages: Help, Privacy policy, language, theme. */
export function ThemeFloat() {
  const [t, setT] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');
  useEffect(() => { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('sh_theme', t); } catch { /* ignore */ } }, [t]);
  return (
    <div className="auth-tools" role="toolbar" aria-label="Page tools">
      <Link className="icon-btn" to="/help" title="Help" aria-label="Help"><CircleHelp /></Link>
      <Link className="icon-btn" to="/privacy" title="Privacy policy" aria-label="Privacy policy"><ShieldCheck /></Link>
      <LanguageSwitcher />
      <button type="button" className="icon-btn" onClick={() => setT(t === 'dark' ? 'light' : 'dark')} aria-label="Switch light/dark theme" title="Light / dark theme">{t === 'dark' ? <Sun /> : <Moon />}</button>
    </div>
  );
}

export default function AuthShell({ children, wide }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="row"><div className="brand-logo"><img src="/scholarshiphive-icon.png" alt="" /></div><div className="brand-text"><b>ScholarshipHive</b><small style={{ color: '#c7d3ee' }}>Dreams to Degrees</small></div></div>
        <div>
          <h2>One place for revenue, expenses, salaries and accounts.</h2>
          <p>Secure staff portal for ScholarshipHive Edutancy. Every page is protected by admin-approved roles.</p>
          <div className="auth-points">
            {['Google-verified sign-in', 'Role-based access to every page', 'Monthly salary with sales commission', 'Clean PDF & Excel (CSV) reports'].map(t => <div key={t}><CheckCircle2 />{t}</div>)}
          </div>
        </div>
        <small style={{ color: '#8ea3cc' }}>Sessions end automatically after 30 minutes of inactivity.</small>
      </aside>
      <main className="auth-main"><div className={`auth-card ${wide ? 'wide' : ''}`}>{children}</div></main>
      <ThemeFloat />
    </div>
  );
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.2 44 33 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
  );
}

export const COUNTRY_CODES = [
  { value: '+92', label: '🇵🇰 +92 Pakistan', hint: '' }, { value: '+971', label: '+971 UAE' }, { value: '+966', label: '+966 Saudi Arabia' },
  { value: '+44', label: '+44 United Kingdom' }, { value: '+1', label: '+1 USA / Canada' }, { value: '+61', label: '+61 Australia' }, { value: '+49', label: '+49 Germany' },
  { value: '+39', label: '+39 Italy' }, { value: '+33', label: '+33 France' }, { value: '+353', label: '+353 Ireland' }, { value: '+90', label: '+90 Turkey' },
  { value: '+60', label: '+60 Malaysia' }, { value: '+86', label: '+86 China' }, { value: '+974', label: '+974 Qatar' }, { value: '+968', label: '+968 Oman' },
  { value: '+973', label: '+973 Bahrain' }, { value: '+965', label: '+965 Kuwait' }, { value: '+64', label: '+64 New Zealand' }, { value: '+36', label: '+36 Hungary' }, { value: '+357', label: '+357 Cyprus' },
].map(c => ({ ...c, label: c.label.replace(/^🇵🇰 /, '') }));

/** Country code dropdown + number. value is the full "+923001234567" string. */
export function PhoneInput({ value, onChange, placeholder = '3001234567' }) {
  const match = COUNTRY_CODES.slice().sort((a, b) => b.value.length - a.value.length).find(c => value.startsWith(c.value));
  const code = match?.value || '+92';
  const rest = value.slice(code.length);
  return (
    <div className="input-group">
      <div style={{ width: 150, flexShrink: 0 }}><Select value={code} options={COUNTRY_CODES} onChange={c => onChange(c + rest)} ariaLabel="Country code" /></div>
      <input className="input" inputMode="tel" placeholder={placeholder} value={rest} onChange={e => onChange(code + e.target.value.replace(/[^\d]/g, '').replace(/^0+/, ''))} />
    </div>
  );
}
export const phoneValid = v => { try { return isValidPhoneNumber(v || ''); } catch { return false; } };

export const cnicFormat = v => {
  const d = v.replace(/\D/g, '').slice(0, 13);
  if (d.length <= 5) return d;
  if (d.length <= 12) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return `${d.slice(0, 5)}-${d.slice(5, 12)}-${d.slice(12)}`;
};
