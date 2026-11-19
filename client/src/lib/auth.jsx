import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, onAuthError } from './api.js';
import { useLang } from './i18n.jsx';
import { setPasswordPolicy } from '../components/ui.jsx';

const AuthCtx = createContext(null);

function applyLook(theme, font) {
  const root = document.documentElement;
  if (theme) { root.setAttribute('data-theme', theme); try { localStorage.setItem('sh_theme', theme); } catch { /* ignore */ } }
  if (font) { root.setAttribute('data-font', font); try { localStorage.setItem('sh_font', font); } catch { /* ignore */ } }
}

export function AuthProvider({ children }) {
  const { setLang } = useLang();
  const [boot, setBoot] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logoutReason, setLogoutReason] = useState('');
  const lastActivity = useRef(Date.now());
  const lastPing = useRef(Date.now());

  const refresh = useCallback(async () => {
    try {
      const b = await api.get('/auth/bootstrap');
      setBoot(b);
      setPasswordPolicy(b?.passwordPolicy);
      setUser(b.user);
      if (b.user) { applyLook(b.user.theme, b.user.font_size); if (b.user.language) setLang(b.user.language); }
      if (b.sessionExpired) setLogoutReason('Your session expired after 30 minutes of inactivity. Please log in again.');
      return b;
    } finally { setLoading(false); }
  }, [setLang]);

  useEffect(() => { refresh().catch(() => setLoading(false)); }, [refresh]);

  // Server says the session is gone → drop to the login screen.
  useEffect(() => onAuthError((code, msg) => {
    setUser(null);
    if (code === 'SESSION_EXPIRED' || code === 'ACCOUNT_INACTIVE') setLogoutReason(msg);
  }), []);

  const logout = useCallback(async reason => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setUser(null);
    setLogoutReason(reason || '');
  }, []);

  // ── 30-minute inactivity logout (client side; the server enforces it too) ──
  useEffect(() => {
    if (!user) return undefined;
    const idleMs = (boot?.idleMinutes || 30) * 60 * 1000;
    const mark = () => { lastActivity.current = Date.now(); };
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'];
    events.forEach(e => window.addEventListener(e, mark, { passive: true }));
    lastActivity.current = Date.now();
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= idleMs) { logout('You were logged out after 30 minutes of inactivity.'); return; }
      // Active user but no API call lately → keep the server session alive.
      if (idle < 60 * 1000 && Date.now() - lastPing.current > 4 * 60 * 1000) {
        lastPing.current = Date.now();
        api.post('/auth/ping').catch(() => {});
      }
    }, 15 * 1000);
    return () => { clearInterval(timer); events.forEach(e => window.removeEventListener(e, mark)); };
  }, [user, boot, logout]);

  const can = useCallback((module, level = 'view') => {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'super_admin') return true;
    const p = user.perms?.[module];
    return level === 'view' ? !!p : p === 'edit';
  }, [user]);

  /** Changes the language now and remembers it on the account (same on every device). */
  const changeLanguage = useCallback(async language => {
    setLang(language);
    setUser(u => (u ? { ...u, language } : u));
    if (user) await api.put('/auth/preferences', { language }).catch(() => {});
  }, [user, setLang]);

  const setLook = useCallback(async (theme, font) => {
    applyLook(theme, font);
    setUser(u => (u ? { ...u, theme: theme || u.theme, font_size: font || u.font_size } : u));
    if (user) await api.put('/auth/preferences', { ...(theme ? { theme } : {}), ...(font ? { font_size: font } : {}) });
  }, [user]);

  const value = useMemo(() => ({
    boot, user, loading, refresh, logout, can, changeLanguage, setUser: u => { setUser(u); if (u) { applyLook(u.theme, u.font_size); if (u.language) setLang(u.language); } setLogoutReason(''); },
    isAdmin: user?.role === 'admin' || user?.role === 'super_admin', isSuper: user?.role === 'super_admin', setLook, logoutReason, setLogoutReason,
  }), [boot, user, loading, refresh, logout, can, setLook, logoutReason, changeLanguage, setLang]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

/** Simple data loader hook: const {data, loading, error, reload} = useLoad('/path', [deps]) */
export function useLoad(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null }); return undefined; }
    let alive = true;
    setState(s => ({ ...s, loading: true, error: null }));
    api.get(path).then(d => alive && setState({ data: d, loading: false, error: null })).catch(e => alive && setState({ data: null, loading: false, error: e }));
    return () => { alive = false; };
  }, [path, tick, ...deps]);
  return { ...state, reload: () => setTick(t => t + 1) };
}
