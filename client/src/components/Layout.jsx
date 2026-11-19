import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, PlusCircle, Receipt, Wallet, Users, BadgeDollarSign, Landmark, Building2, LineChart, Megaphone, UserSquare2,
  ShieldCheck, Settings, ShieldAlert, Lock, Bell, Moon, Sun, LogOut, PanelLeftClose, PanelLeftOpen, Menu, ChevronDown, UserCog, Home, ClipboardCheck,
  Contact, Handshake, FileText, CreditCard, Sparkles, BarChart3, CircleHelp, CheckCheck, MessageCircle, BellRing, AlarmClock,
  PanelRightClose, PanelRightOpen, LayoutGrid, CalendarClock, Undo2, Repeat, Shuffle, Tags, BookOpen, ArrowDownToLine, Scale, PiggyBank,
  Droplets, Droplet, Mountain, ListChecks, Hourglass, CalendarRange, Layers, Briefcase, Coins, Gem, ListTree, KeyRound, Mail, History, UserPlus, Palette, Send, Plus, ChevronRight,
  WalletCards, Clock3, TriangleAlert, Sigma, Banknote,
} from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { useLang } from '../lib/i18n.jsx';
import { api } from '../lib/api.js';
import { ago } from '../lib/format.js';
import { Avatar, useToast } from './ui.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';

export const NAV = [
  { section: 'Main' },
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/' },
  { key: 'revenue', label: 'Revenue', icon: TrendingUp, to: '/revenue', perm: 'revenue' },
  { key: 'revenue-entry', label: 'Enter Revenue', icon: PlusCircle, to: '/revenue/new', perm: 'revenue', level: 'edit', child: true },
  { key: 'expenses', label: 'Expenses', icon: Receipt, to: '/expenses', perm: 'expenses' },
  { key: 'marketing-analyzer', label: 'Marketing Analyzer', icon: TrendingUp, to: '/expenses/marketing', perm: 'marketing', child: true },
  { key: 'salary-workforce', label: 'Salary Manager / Analyzer', icon: Users, to: '/expenses/workforce', anyPerm: ['salary'], child: true },
  { key: 'attendance-app', label: 'Attendance', icon: CalendarClock, to: '/attendance', anyPerm: ['salary'] },
  { key: 'petty', label: 'Petty Cash', icon: Wallet, to: '/petty-cash', perm: 'petty_cash' },
  { key: 'my-salary', label: 'My Salary', icon: BadgeDollarSign, to: '/expenses/workforce?view=self' },
  { key: 'my-budget', label: 'My Budget', icon: WalletCards, to: '/my-budget', show: u => Boolean(u?.budget) },
  { section: 'Accounts' },
  { key: 'accounts', label: 'Accounts', icon: Building2, to: '/accounts', anyPerm: ['assets', 'liabilities', 'cashflow'] },
  { section: 'Company' },
  { key: 'reports', label: 'Reports', icon: BarChart3, to: '/reports' },
  { key: 'announcements', label: 'Announcements', icon: Megaphone, to: '/announcements' },
  { key: 'owner', label: 'Owner Information', icon: UserSquare2, to: '/owner' },
  { key: 'help', label: 'Help', icon: CircleHelp, to: '/help' },
  { key: 'privacy', label: 'Privacy Policy', icon: ShieldCheck, to: '/privacy' },
  { section: 'Settings' },
  { key: 'admin-settings', label: 'Admin Settings', icon: ShieldAlert, to: '/settings/admin', admin: true },
  { key: 'my-settings', label: 'My Settings', icon: Settings, to: '/settings' },
];

/**
 * Sub pages of every module — shown in the small right-hand bar.
 * [key, label, icon, rule]  rule: 'admin' | 'approver' | { perm, level }  · cta = highlighted "add" link with its own path
 */
export const SUB_NAV = {
  '/accounts': { title: 'Accounts', items: [
    { key: 'assets-link', label: 'Assets', icon: Building2, to: '/assets', rule: { perm: 'assets' } },
    { key: 'liabilities-link', label: 'Liabilities', icon: Landmark, to: '/liabilities', rule: { perm: 'liabilities' } },
    { key: 'capital-link', label: 'Capital & Equity', icon: Scale, to: '/capital', rule: { anyPerm: ['assets', 'cashflow'] } },
  ] },
  '/revenue': { title: 'Revenue', items: [
    { section: true, label: 'Sales workspace' }, ['overview', 'Overview', LayoutGrid], ['sales', 'Sales & Deals', Handshake], ['customers', 'Customers', Contact], ['invoices', 'Invoices', FileText],
    { section: true, label: 'Collections & planning' }, ['payments', 'Payments', CreditCard], ['upcoming', 'Upcoming Payments', CalendarClock], ['refunds', 'Refunds', Undo2], ['forecast', 'Forecast', Sparkles]] },
  '/expenses': { title: 'Expenses', items: [
    { section: true, label: 'Overview' }, ['overview', 'Overview', LayoutGrid],
    { section: true, label: 'Recurring & approvals' }, ['constant', 'Fixed / Recurring', Repeat], ['approvals', 'Approval queue', ClipboardCheck, 'approver'],
    { section: true, label: 'People & payroll' }, ['salaries', 'Salary expense register', BadgeDollarSign, { anyPerm: ['salary'] }],
    { section: true, label: 'Other spending' }, ['variable', 'Variable Expenses', Shuffle], ['loans', 'Loan repayments', Landmark],
    { section: true, label: 'Setup' }, ['categories', 'Expense Categories', Tags, 'admin']] },
  '/petty-cash': { title: 'Petty Cash', items: [['overview', 'Overview', LayoutGrid], ['entries', 'Entries', ListChecks], ['topups', 'Top-ups', ArrowDownToLine], ['cashbook', 'Cash Book', BookOpen]] },
  '/cash-flow': { title: 'Cash Flow Manager', items: [
    { section: true, label: 'Cash overview' }, ['overview', 'Overview', LayoutGrid], ['runway', 'Cash Runway', Hourglass],
    { section: true, label: 'Planning & analysis' }, ['forecast', 'Cash Forecast', CalendarRange], ['timing', 'Inflow vs Outflow', Clock3], ['working-capital', 'Working Capital', Briefcase], ['surplus-deficit', 'Surplus & Deficit', TriangleAlert], ['models', 'Cash Models', Sigma],
    { section: true, label: 'Cash operations' }, ['treasury', 'Treasury & Banking', Banknote], ['budgets', 'Budget Allotment', WalletCards], ['payments', 'Payment Control', ClipboardCheck],
    { section: true, label: 'Financial reports' }, ['profit-loss', 'Profit & Loss', BarChart3]] },
  '/assets': { title: 'Assets', items: [
    { section: true, label: 'Accounts' }, { key: 'assets-link', label: 'Assets', icon: Building2, to: '/assets', rule: { perm: 'assets' } }, { key: 'liabilities-link', label: 'Liabilities', icon: Landmark, to: '/liabilities', rule: { perm: 'liabilities' } }, { key: 'capital-link', label: 'Capital & Equity', icon: Scale, to: '/capital', rule: { anyPerm: ['assets', 'cashflow'] } },
    { section: true, label: 'Asset register' }, { cta: true, key: 'new', label: 'Add asset', icon: Plus, to: '/assets/new', rule: { perm: 'assets', level: 'edit' } },
    ['overview', 'Overview', LayoutGrid], ['register', 'Assets register', ListTree], ['high', 'High liquidity', Droplets], ['medium', 'Medium liquidity', Droplet], ['low', 'Low liquidity', Mountain]] },
  '/liabilities': { title: 'Liabilities', items: [
    { section: true, label: 'Accounts' }, { key: 'assets-link', label: 'Assets', icon: Building2, to: '/assets', rule: { perm: 'assets' } }, { key: 'liabilities-link', label: 'Liabilities', icon: Landmark, to: '/liabilities', rule: { perm: 'liabilities' } }, { key: 'capital-link', label: 'Capital & Equity', icon: Scale, to: '/capital', rule: { anyPerm: ['assets', 'cashflow'] } },
    { section: true, label: 'Liability registers' }, { cta: true, key: 'new', label: 'Add liability / loan', icon: Plus, to: '/liabilities/new', rule: { perm: 'liabilities', level: 'edit' } },
    ['overview', 'Overview', LayoutGrid], ['all', 'All liabilities', ListTree], ['current', 'Current (within 12 months)', Hourglass], ['non-current', 'Long-term liabilities', CalendarRange]] },
  '/capital': { title: 'Capital & Equity', items: [
    { section: true, label: 'Accounts' }, { key: 'assets-link', label: 'Assets', icon: Building2, to: '/assets', rule: { perm: 'assets' } }, { key: 'liabilities-link', label: 'Liabilities', icon: Landmark, to: '/liabilities', rule: { perm: 'liabilities' } }, { key: 'capital-link', label: 'Capital & Equity', icon: Scale, to: '/capital', rule: { anyPerm: ['assets', 'cashflow'] } },
    { section: true, label: 'Capital & equity views' }, { cta: true, key: 'new', label: 'Add capital entry', icon: Plus, to: '/capital/new', rule: 'admin' },
    ['overview', 'Accounting equation', Scale], ['fixed', 'Fixed capital', Layers], ['working', 'Working capital', Briefcase], ['debt', 'Debt capital', Landmark],
    ['equity', 'Equity capital', Coins], ['owners-equity', "Owner's equity / net worth", Gem], ['entries', 'Capital entries', ListChecks]] },
  '/settings/admin': { title: 'Admin Settings', items: [['users', 'Users & Roles', Users], ['requests', 'Requests', Send], ['admins', 'Admins', ShieldAlert], ['forms', 'Forms & Fields', ListTree], ['security', 'Security', KeyRound], ['email', 'Email', Mail], ['activity', 'Activity Log', History]] },
  '/settings': { title: 'My Settings', items: [['appearance', 'Appearance', Palette], ['profile', 'My Profile', UserCog], ['security', 'Password', KeyRound], ['requests', 'Requests to Admin', UserPlus]] },
};
/** Old name kept for other files that import it. */
export const HEADER_TABS = Object.fromEntries(Object.entries(SUB_NAV).map(([k, v]) => [k, v.items.filter(i => Array.isArray(i)).map(([key, label, , rule]) => [key, label, rule])]));
const NO_SUBBAR = ['/revenue/new', '/assets/new', '/liabilities/new', '/capital/new', '/expenses/workforce', '/expenses/marketing', '/attendance'];

const TITLES = { '/accounts': 'Accounts', '/assets/new': 'Add asset', '/liabilities/new': 'Add liability / loan', '/capital/new': 'Add capital entry', '/capital': 'Capital & Equity', '/expenses/workforce': 'Salary Manager / Analyzer', '/attendance': 'Attendance', '/': 'Dashboard', '/salary': 'Salary & Workforce', '/my-salary': 'My Salary', '/assets': 'Assets', '/liabilities': 'Liabilities', '/announcements': 'Announcements', '/owner': 'Owner Information', '/privacy': 'Privacy Policy', '/help': 'Help', '/reports': 'Reports', '/revenue/new': 'Enter Revenue' };

const LayoutCtx = createContext(null);
export const useLayout = () => useContext(LayoutCtx);

function UserMenu({ anchor, onClose }) {
  const { user, logout, isAdmin } = useAuth();
  const nav = useNavigate();
  const ref = useRef(null);
  useEffect(() => {
    const close = e => { if (!ref.current?.contains(e.target) && !anchor?.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [anchor, onClose]);
  const r = anchor.getBoundingClientRect();
  const go = p => { onClose(); nav(p); };
  const side = document.documentElement.dir === 'rtl' ? { left: Math.max(8, r.left) } : { right: Math.max(8, window.innerWidth - r.right) };
  return createPortal(
    <div ref={ref} className="menu" style={{ top: r.bottom + 6, ...side }}>
      <div style={{ padding: '8px 11px 10px' }} data-no-translate><b>{user.full_name}</b><div className="small muted">{user.email}</div><div className="small muted">{user.employee_code}</div></div>
      <div className="menu-sep" />
      <button className="menu-item" onClick={() => go('/settings/profile')}><UserCog />My profile</button>
      <button className="menu-item" onClick={() => go('/my-salary')}><BadgeDollarSign />My salary</button>
      <button className="menu-item" onClick={() => go('/settings/appearance')}><Settings />My settings</button>
      {isAdmin && <button className="menu-item" onClick={() => go('/settings/admin')}><ShieldAlert />Admin settings</button>}
      <button className="menu-item" onClick={() => go('/help')}><CircleHelp />Help</button>
      <div className="menu-sep" />
      <button className="menu-item" onClick={() => { onClose(); logout(); }}><LogOut />Log out</button>
    </div>, document.body);
}

/** Quick Access Bar (from the Revenue Manager): home, quick settings, help, privacy, theme, logout. */
function QuickAccess({ collapsed }) {
  const { user, setLook, logout } = useAuth();
  const nav = useNavigate();
  const dark = user.theme === 'dark';
  const items = [
    [Home, 'Home', () => nav('/')],
    [Settings, 'Quick settings', () => nav('/settings/appearance')],
    [CircleHelp, 'Help', () => nav('/help')],
    [ShieldCheck, 'Privacy policy', () => nav('/privacy')],
    [dark ? Sun : Moon, dark ? 'Light mode' : 'Dark mode', () => setLook(dark ? 'light' : 'dark')],
    [LogOut, 'Logout', () => logout()],
  ];
  return (
    <div className={`quick-bar ${collapsed ? 'vertical' : ''}`} role="toolbar" aria-label="Quick access">
      {items.map(([Icon, label, fn]) => <button key={label} type="button" title={label} aria-label={label} onClick={fn}><Icon /></button>)}
    </div>
  );
}

const KIND_ICON = { payment_due: AlarmClock, payment_overdue: AlarmClock, sale: Handshake };

/** Bell: payment reminders and other alerts, plus unread announcements. */
function Notifications({ announcements }) {
  const nav = useNavigate();
  const { tx } = useLang();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ rows: [], unread: 0 });
  const btn = useRef(null);
  const panel = useRef(null);
  const seen = useRef(new Set());
  const first = useRef(true);
  const load = useCallback(() => api.get('/notifications').then(d => {
    setData(d);
    // desktop alert for new reminders (only if the person allowed it)
    if (!first.current && 'Notification' in window && Notification.permission === 'granted') {
      d.rows.filter(n => !n.is_read && !seen.current.has(n.id)).slice(0, 3).forEach(n => { try { new Notification(n.title, { body: n.body, icon: '/scholarshiphive-icon.png' }); } catch { /* ignore */ } });
    }
    d.rows.forEach(n => seen.current.add(n.id));
    first.current = false;
  }).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!btn.current?.contains(e.target) && !panel.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const readAll = () => api.post('/notifications/read', {}).then(load).catch(() => {});
  const go = n => { setOpen(false); if (!n.is_read) api.post('/notifications/read', { ids: [n.id] }).then(load).catch(() => {}); if (n.link) nav(n.link); };
  const total = data.unread + (announcements || 0);
  const r = open && btn.current?.getBoundingClientRect();
  const side = r ? (document.documentElement.dir === 'rtl' ? { left: Math.max(8, r.left) } : { right: Math.max(8, window.innerWidth - r.right) }) : {};
  const canAsk = 'Notification' in window && Notification.permission === 'default';
  return (
    <>
      <button ref={btn} className="icon-btn" onClick={() => setOpen(o => !o)} aria-label="Notifications" title="Notifications" aria-expanded={open}><Bell />{total > 0 && <span className="dot">{total > 99 ? '99+' : total}</span>}</button>
      {open && r && createPortal(
        <div ref={panel} className="menu notif-panel" style={{ top: r.bottom + 6, ...side }} role="dialog" aria-label="Notifications">
          <div className="notif-head"><b>Notifications</b>{data.unread > 0 && <button className="btn btn-ghost btn-sm" onClick={readAll}><CheckCheck />Mark all read</button>}</div>
          {announcements > 0 && <button className="notif-item unread" onClick={() => { setOpen(false); nav('/announcements'); }}><Megaphone className="ni" /><div><b>{tx('{n} unread announcement(s)', { n: announcements })}</b><small>Open announcements</small></div></button>}
          <div className="notif-list">
            {data.rows.length ? data.rows.map(n => {
              const I = KIND_ICON[n.kind] || BellRing;
              return (
                <div key={n.id} className={`notif-item ${n.is_read ? '' : 'unread'} ${n.kind === 'payment_overdue' ? 'danger' : ''}`} role="button" tabIndex={0} onClick={() => go(n)} onKeyDown={e => { if (e.key === 'Enter') go(n); }}>
                  <I className="ni" />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b data-no-translate>{n.title}</b>
                    <small data-no-translate>{n.body}</small>
                    <small className="muted">{ago(n.created_at)}</small>
                  </div>
                  {n.meta?.whatsapp && <a className="btn btn-sm wa-btn" href={n.meta.whatsapp} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title="Send WhatsApp reminder"><MessageCircle />WhatsApp</a>}
                </div>
              );
            }) : <div className="muted small" style={{ padding: 16, textAlign: 'center' }}>No notifications yet. Payment reminders appear here.</div>}
          </div>
          {canAsk && <button className="notif-foot" onClick={() => Notification.requestPermission().then(load)}><BellRing size={15} />Enable desktop alerts</button>}
        </div>, document.body)}
    </>
  );
}

function readPref(key, fallback) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function savePref(key, val) { try { localStorage.setItem(key, val); } catch { /* storage blocked */ } }

/** Right-hand mini bar: the sub pages of the module you are in. */
function SubBar({ base, conf, collapsed, mobileOpen, onClose, allowedRule }) {
  const loc = useLocation();
  const rest = loc.pathname.slice(base.length + 1).split('/')[0];
  const firstTab = conf.items.find(i => Array.isArray(i))?.[0];
  const items = conf.items.map(i => (Array.isArray(i) ? { key: i[0], label: i[1], icon: i[2], rule: i[3], to: `${base}/${i[0]}` } : i)).filter(i => i.section || !i.rule || allowedRule(i.rule) || i.cta);
  const isQuickLink = i => ['assets-link', 'liabilities-link', 'capital-link'].includes(i.key);
  const isOn = i => {
    if (i.section) return false;
    if (isQuickLink(i)) return loc.pathname === i.to;
    if (i.to) return loc.pathname === i.to || loc.pathname.startsWith(i.to + '/') || (loc.pathname === base && i.key === firstTab);
    return (rest || firstTab) === i.key && !NO_SUBBAR.includes(loc.pathname);
  };
  return (
    <aside className={`subbar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} aria-label={`${conf.title} pages`}>
      <div className="subbar-head"><span className="subbar-title">{conf.title}</span><button className="icon-btn mobile-only" onClick={onClose} aria-label="Close menu"><PanelRightClose /></button></div>
      <nav className="subnav">
        {items.map((i, index) => {
          if (i.section) return <div key={`section-${index}`} className="subnav-section">{i.label}</div>;
          const ok = !i.rule || allowedRule(i.rule);
          return (
            <Link key={i.key} to={ok ? i.to : '#'} title={collapsed ? i.label : undefined} aria-current={isOn(i) ? 'page' : undefined}
              className={`subnav-item ${i.cta ? 'cta' : ''} ${isOn(i) ? 'active' : ''} ${ok ? '' : 'locked'}`} onClick={e => { if (!ok) e.preventDefault(); }}>
              <i.icon /><span className="nav-label">{i.label}</span>{!ok && <Lock className="lock" />}{!i.cta && i.key !== 'capital-link' && !collapsed && <ChevronRight className="chev" />}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export default function Layout({ children }) {
  const { user, can, isAdmin, setLook } = useAuth();
  const toast = useToast();
  const loc = useLocation();
  const nav = useNavigate();
  const [collapsed, setCollapsed] = useState(() => readPref('sh_sidebar', 'open') === 'collapsed');
  const [subCollapsed, setSubCollapsed] = useState(() => readPref('sh_subbar_v2', 'open') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [menuEl, setMenuEl] = useState(null);
  const [unread, setUnread] = useState(0);
  const [pending, setPending] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => { setMobileOpen(false); setSubOpen(false); }, [loc.pathname]);
  useEffect(() => { savePref('sh_sidebar', collapsed ? 'collapsed' : 'open'); }, [collapsed]);
  useEffect(() => { savePref('sh_subbar_v2', subCollapsed ? 'collapsed' : 'open'); }, [subCollapsed]);
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') { setMobileOpen(false); setSubOpen(false); } };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () => {
      api.get('/announcements/unread-count').then(d => alive && setUnread(d.unread)).catch(() => {});
      if (isAdmin) api.get('/users?status=pending&limit=1').then(d => alive && setPending(d.total ?? d.rows.length)).catch(() => {});
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [isAdmin, loc.pathname]);

  const isActiveItem = item => {
    if (!item.to) return false;
    if (item.to === '/') return loc.pathname === '/';
    if (item.key === 'accounts') return ['/accounts', '/assets', '/liabilities', '/capital'].some(p => loc.pathname === p || loc.pathname.startsWith(p + '/'));
    if (item.key === 'revenue') return loc.pathname === '/revenue' || (loc.pathname.startsWith('/revenue/') && loc.pathname !== '/revenue/new');
    if (item.key === 'revenue-entry') return loc.pathname === '/revenue/new';
    if (item.key === 'marketing-analyzer') return loc.pathname === '/expenses/marketing';
    if (item.key === 'salary-workforce') return loc.pathname === '/expenses/workforce';
    if (item.key === 'attendance-app') return loc.pathname === '/attendance';
    if (item.key === 'my-salary') return loc.pathname === '/expenses/workforce' && new URLSearchParams(loc.search).get('view') === 'self';
    if (item.key === 'my-settings') return loc.pathname.startsWith('/settings') && !loc.pathname.startsWith('/settings/admin');
    return loc.pathname === item.to || loc.pathname.startsWith(item.to + '/');
  };
  const allowed = item => (item.admin ? isAdmin : item.anyPerm ? item.anyPerm.some(p => can(p, 'view')) : !item.perm || can(item.perm, item.level || 'view'));
  const allowedRule = rule => (rule === 'admin' ? isAdmin : rule === 'approver' ? can('expense_approve', 'edit') : rule?.anyPerm ? rule.anyPerm.some(p => can(p, 'view')) : rule?.perm ? can(rule.perm, rule.level || 'view') : true);
  const clickItem = (e, item) => {
    if (!allowed(item)) { e.preventDefault(); toast.warn(`Not approved by admin — you don't have access to ${item.label}.`); }
  };

  const base = Object.keys(SUB_NAV).sort((a, b) => b.length - a.length).find(b => loc.pathname === b || loc.pathname.startsWith(b + '/'));
  const conf = base && !(base === '/settings' && loc.pathname.startsWith('/settings/admin')) ? SUB_NAV[base] : null;
  const showSub = Boolean(conf) && !NO_SUBBAR.includes(loc.pathname);
  const subItem = conf && (() => {
    const rest = loc.pathname.slice(base.length + 1).split('/')[0];
    const items = conf.items.map(i => (Array.isArray(i) ? { key: i[0], label: i[1] } : i)).filter(i => !i.section);
    return items.find(i => i.key === rest) || (rest || base === '/accounts' ? null : items.find(i => !i.cta && i.key !== 'capital-link'));
  })();
  const title = TITLES[loc.pathname] || conf?.title || TITLES['/' + loc.pathname.split('/')[1]] || NAV.find(n => n.to && n.to !== '/' && loc.pathname.startsWith(n.to))?.label || 'ScholarshipHive';
  const openPanel = useCallback(p => { if (p === 'sale') nav('/revenue/new'); }, [nav]);

  return (
    <LayoutCtx.Provider value={{ openPanel, dataVersion, bump: () => setDataVersion(v => v + 1) }}>
      <div className={`shell ${showSub ? 'has-subbar' : ''}`}>
        <div className={`sidebar-backdrop ${mobileOpen || subOpen ? 'show' : ''}`} onClick={() => { setMobileOpen(false); setSubOpen(false); }} />
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Main navigation">
          <div className="brand">
            <div className="brand-logo"><img src="/scholarshiphive-icon.png" alt="ScholarshipHive" /></div>
            <div className="brand-text"><b>ScholarshipHive</b><small>Dreams to Degrees</small></div>
          </div>
          <nav className="nav">
            {NAV.filter(item => (!item.show || item.show(user)) && (!['salary-workforce', 'attendance-app'].includes(item.key) || allowed(item))).map((item, i) => item.section ? <div key={'s' + i} className="nav-section">{item.section}</div> : (
              <Link key={item.key} to={item.to} title={collapsed ? item.label : undefined}
                className={`nav-item ${item.child ? 'sub' : ''} ${isActiveItem(item) ? 'active' : ''} ${allowed(item) ? '' : 'locked'}`}
                onClick={e => clickItem(e, item)}>
                <item.icon /><span className="nav-label">{item.label}</span>
                {!allowed(item) && <span className="nav-lock"><Lock /></span>}
                {item.key === 'announcements' && unread > 0 && <span className="nav-badge">{unread}</span>}
                {item.key === 'admin-settings' && pending > 0 && <span className="nav-badge">{pending}</span>}
              </Link>
            ))}
          </nav>
          <QuickAccess collapsed={collapsed && !mobileOpen} />
        </aside>

        {showSub && <SubBar base={base} conf={conf} collapsed={subCollapsed && !subOpen} mobileOpen={subOpen} onClose={() => setSubOpen(false)} allowedRule={allowedRule} />}

        <div className={`main ${collapsed ? 'collapsed' : ''} ${showSub ? (subCollapsed ? 'sub-collapsed' : 'with-sub') : ''}`}>
          <header className="topbar">
            <button className="icon-btn mobile-only" onClick={() => { setSubOpen(false); setMobileOpen(true); }} aria-label="Open main menu" title="Main menu"><Menu /></button>
            <button className="icon-btn desktop-only" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
            <div className="topbar-tabs">
              <nav className="crumbs" aria-label="Breadcrumb">
                <span className="topbar-title">{title}</span>
                {subItem && !subItem.cta && subItem.key !== 'capital-link' && <><ChevronRight className="crumb-sep" /><span className="crumb-sub">{subItem.label}</span></>}
              </nav>
            </div>
            <div className="topbar-right">
              <LanguageSwitcher />
              <button className="icon-btn desktop-only" onClick={() => nav('/help')} aria-label="Help" title="Help"><CircleHelp /></button>
              <button className="icon-btn" onClick={() => setLook(user.theme === 'dark' ? 'light' : 'dark')} aria-label="Switch light/dark theme" title="Light / dark theme">{user.theme === 'dark' ? <Sun /> : <Moon />}</button>
              <Notifications announcements={unread} />
              <button className="user-chip" onClick={e => setMenuEl(menuEl ? null : e.currentTarget)} aria-label="Account menu">
                <Avatar fileId={user.photo_file_id} name={user.full_name} size={34} />
                <span className="nav-label"><b data-no-translate>{user.full_name}</b><small>{user.role === 'super_admin' ? 'Super Admin' : user.role === 'admin' ? 'Admin' : user.designation || 'Employee'}</small></span>
                <ChevronDown size={15} className="nav-label" />
              </button>
              {showSub && <>
                <button className="icon-btn mobile-only" onClick={() => { setMobileOpen(false); setSubOpen(true); }} aria-label="Open page menu" title="Page menu"><LayoutGrid /></button>
                <button className="icon-btn desktop-only" onClick={() => setSubCollapsed(c => !c)} aria-label={subCollapsed ? 'Expand page menu' : 'Collapse page menu'} title={subCollapsed ? 'Expand page menu' : 'Collapse page menu'}>
                  {subCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
                </button>
              </>}
            </div>
          </header>
          <main className="content" key={loc.pathname.split('/')[1]}>{children}</main>
        </div>
      </div>
      {menuEl && <UserMenu anchor={menuEl} onClose={() => setMenuEl(null)} />}
    </LayoutCtx.Provider>
  );
}

export function Footer() {
  return <footer className="app-footer">© {new Date().getFullYear()} All rights reserved by ScholarshipHive</footer>;
}
