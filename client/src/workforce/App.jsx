import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';
import { UiProvider, Loading, MonthPicker } from './components/ui.jsx';
import { monthLabel, todayMonth } from './format.js';
import Overview from './pages/Overview.jsx';
import Employees from './pages/Employees.jsx';
import Attendance from './pages/Attendance.jsx';
import Leaves from './pages/Leaves.jsx';
import ShiftRequests from './pages/ShiftRequests.jsx';
import Exceptions from './pages/Exceptions.jsx';
import Revenue from './pages/Revenue.jsx';
import Commissions from './pages/Commissions.jsx';
import Payroll from './pages/Payroll.jsx';
import Advances from './pages/Advances.jsx';
import Policies from './pages/Policies.jsx';
import Audit from './pages/Audit.jsx';
import SelfService from './pages/SelfService.jsx';
import EmployeeDetail from './components/EmployeeDetail.jsx';

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// Harmless UI preferences only (selected page) are kept in localStorage.
const PREF_KEY = 'scholarshiphive_workforce_ui_prefs_v2';
const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } };
const writePrefs = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...p })); } catch { /* ignore */ } };

const NAV = [
  { group: 'Workspace', items: [
    { id: 'overview', icon: '◫', label: 'Overview', perm: ['reports.view', 'payroll.view'] },
    { id: 'employees', icon: '◎', label: 'Employees', perm: ['employees.view'] },
    { id: 'attendance', icon: '▦', label: 'Attendance Ledger', perm: ['attendance.view_all'] },
    { id: 'leaves', icon: '◷', label: 'Leave Management', perm: ['leave.manage'] },
    { id: 'shiftRequests', icon: '◴', label: 'Shift Requests', perm: ['attendance.security', 'attendance.manage'] },
    { id: 'exceptions', icon: '◈', label: 'Exception Queue', perm: ['attendance.view_all', 'payroll.view'] },
  ] },
  { group: 'Compensation', items: [
    { id: 'revenue', icon: '₨', label: 'Revenue', perm: ['revenue.view'] },
    { id: 'commissions', icon: '◉', label: 'Commissions', perm: ['commission.view', 'payroll.view'] },
    { id: 'payroll', icon: '▤', label: 'Payroll & Payslips', perm: ['payroll.view'] },
    { id: 'advances', icon: '⇄', label: 'Salary Advances', perm: ['advances.view'] },
  ] },
  { group: 'Administration', items: [
    { id: 'policies', icon: '⚙', label: 'Policy Settings', perm: ['policy.manage', 'attendance.security'] },
    { id: 'audit', icon: '☰', label: 'Audit Log', perm: ['audit.view'] },
  ] },
];

const PAGES = { overview: Overview, employees: Employees, attendance: Attendance, leaves: Leaves, shiftRequests: ShiftRequests, exceptions: Exceptions, revenue: Revenue, commissions: Commissions, payroll: Payroll, advances: Advances, policies: Policies, audit: Audit };

function useLiveUpdates(enabled) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return undefined;
    let es; let timer; let retry;
    const connect = () => {
      es = new EventSource('/api/workforce/events', { withCredentials: true });
      es.addEventListener('hello', () => setConnected(true));
      es.addEventListener('change', () => {
        clearTimeout(timer);
        timer = setTimeout(() => qc.invalidateQueries(), 250); // re-fetch authoritative data from PostgreSQL
      });
      es.onerror = () => { setConnected(false); es.close(); retry = setTimeout(connect, 5000); };
    };
    connect();
    return () => { clearTimeout(timer); clearTimeout(retry); if (es) es.close(); };
  }, [enabled, qc]);
  return connected;
}

function Shell({ user, initialTab }) {
  const perms = useMemo(() => new Set(user.permissions || []), [user]);
  const can = useCallback((...p) => p.some((x) => perms.has(x)), [perms]);
  const visible = useMemo(() => NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(...i.perm)) })).filter((g) => g.items.length), [can]);
  const first = visible[0]?.items[0]?.id;
  const requestedTab = initialTab || new URLSearchParams(window.location.search).get('tab');
  const [tab, setTabState] = useState(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'self') return '__self';
    if (requestedTab) return requestedTab;
    const t = readPrefs().tab;
    return visible.some((g) => g.items.some((i) => i.id === t)) ? t : first;
  });
  const [month, setMonth] = useState(() => readPrefs().month || todayMonth());
  const [detail, setDetail] = useState(null);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [pageArgs, setPageArgs] = useState({});
  const live = useLiveUpdates(true);
  const setTab = (t, args = {}) => { setTabState(t); setPageArgs(args); writePrefs({ tab: t }); window.scrollTo(0, 0); };
  const changeMonth = (m) => { setMonth(m); writePrefs({ month: m }); };

  useEffect(() => {
    if (!requestedTab && tab !== '__self' && !visible.some((g) => g.items.some((i) => i.id === tab))) setTabState(first);
  }, [tab, visible, first, requestedTab]);

  const exceptionsQ = useQuery({
    queryKey: ['exceptions', month],
    queryFn: () => api.get(`/api/exceptions?month=${month}`),
    enabled: can('attendance.view_all', 'payroll.view'),
    refetchInterval: 60000,
  });
  const alertCount = exceptionsQ.data?.items?.length || 0;
  const ctx = { user, can, month, setMonth: changeMonth, tab, setTab, pageArgs, openEmployee: (employeeId) => setDetail({ employeeId }), live };
  const Page = PAGES[tab];

  if (!first) {
    return <AppCtx.Provider value={ctx}><SelfService embedded /></AppCtx.Provider>;
  }

  return (
    <AppCtx.Provider value={ctx}>
      <div className={`workforce-shell ${navCollapsed ? 'nav-collapsed' : ''}`}>
        <header className="workforce-head">
          <div className="workforce-brand">
            <span className="mark">SH</span>
            <span><b>Salary Manager / Analyzer</b><small>Analyzer payroll · Attendance · Commissions</small></span>
          </div>
          <div className="workforce-tools">
            <span className={`livedot ${live ? '' : 'off'}`} />
            <span className="workforce-live-label">{live ? 'Live' : 'Reconnecting'}</span>
            <button type="button" className="btn outline sm workforce-nav-toggle" onClick={() => setNavCollapsed(v => !v)} aria-expanded={!navCollapsed} aria-controls="workforce-sections">{navCollapsed ? 'Show sections' : 'Hide sections'}</button>
            <MonthPicker value={month} onChange={changeMonth} />
            {user.employeeId && <button className="btn outline sm" onClick={() => setTab(tab === '__self' ? first : '__self')}>{tab === '__self' ? 'Back to workspace' : 'My payslips'}</button>}
          </div>
        </header>
        <nav id="workforce-sections" className="workforce-nav" aria-label="Salary and workforce sections" hidden={navCollapsed}>
          {visible.map((g) => (
            <div className="workforce-navgroup" key={g.group}>
              <span className="workforce-navlabel">{g.group}</span>
              <div className="workforce-navitems">
                {g.items.map((i) => (
                  <button key={i.id} className={`nav ${tab === i.id ? 'active' : ''}`} onClick={() => setTab(i.id)} aria-current={tab === i.id ? 'page' : undefined}>
                    <span className="navicon" aria-hidden="true">{i.icon}</span>{i.label}
                    {i.id === 'exceptions' && alertCount > 0 && <span className="navcount">{alertCount}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <main className="workforce-main">
          {requestedTab && !visible.some((g) => g.items.some((i) => i.id === requestedTab)) ? (
            <section className="workforce-access-card" role="alert"><h2>Access denied</h2><p>Your ScholarshipHive ERP role does not permit opening this Salary Analyzer section. Ask an administrator to grant the required permission.</p></section>
          ) : tab === '__self' ? <SelfService embedded /> : Page ? <Page /> : null}
          <div className="footer">ScholarshipHive ERP · Attendance, payroll and commission workspace · Marking payroll as paid records the payment; it does not initiate a bank transfer.</div>
        </main>
      </div>
      {detail && <EmployeeDetail employeeId={detail.employeeId} onClose={() => setDetail(null)} />}
    </AppCtx.Provider>
  );
}

export default function App({ initialTab } = {}) {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get('/api/auth/me'), retry: false, staleTime: 60000 });
  if (me.isLoading) return <UiProvider><Loading text="Opening Salary & Workforce…" /></UiProvider>;
  if (!me.data?.user) {
    return (
      <UiProvider>
        <div className="workforce-access-card">
          <h2>Sign in through ScholarshipHive ERP</h2>
          <p>This workspace uses your existing ERP account and permissions. There is no separate Salary Analyzer password.</p>
          <a className="btn" href="/login">Open ERP sign in</a>
        </div>
      </UiProvider>
    );
  }
  return <UiProvider><Shell user={me.data.user} initialTab={initialTab} /></UiProvider>;
}
