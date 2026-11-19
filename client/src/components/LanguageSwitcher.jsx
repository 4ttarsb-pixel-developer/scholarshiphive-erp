import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Languages } from 'lucide-react';
import { LANGS, useLang } from '../lib/i18n.jsx';
import { useAuth } from '../lib/auth.jsx';

/** Globe button → English / Roman Urdu / اردو. Saved on the account when logged in. */
export default function LanguageSwitcher({ compact }) {
  const { lang, setLang } = useLang();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const menu = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!btn.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const choose = l => { setOpen(false); if (auth?.user && auth.changeLanguage) auth.changeLanguage(l); else setLang(l); };
  const cur = LANGS.find(l => l.code === lang) || LANGS[0];
  const r = open && btn.current?.getBoundingClientRect();
  return (
    <>
      <button ref={btn} type="button" className={`icon-btn lang-btn ${compact ? '' : 'wide'}`} onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Language" title="Language">
        <Languages />{!compact && <span className="lang-code" data-no-translate>{cur.short}</span>}
      </button>
      {open && r && createPortal(
        <div ref={menu} className="menu lang-menu" role="menu" style={{ top: r.bottom + 6, ...(document.documentElement.dir === 'rtl' ? { left: Math.max(8, r.left) } : { right: Math.max(8, window.innerWidth - r.right) }) }}>
          {LANGS.map(l => (
            <button key={l.code} type="button" role="menuitemradio" aria-checked={lang === l.code} className={`menu-item ${lang === l.code ? 'on' : ''}`} onClick={() => choose(l.code)} data-no-translate>
              <span className={l.code === 'ur' ? 'urdu-label' : ''}>{l.native}</span>
              <small className="muted">{l.code === 'en' ? 'English' : l.code === 'roman' ? 'Urdu in English letters' : 'Urdu · right to left'}</small>
              {lang === l.code && <Check className="tick" />}
            </button>
          ))}
        </div>, document.body)}
    </>
  );
}
