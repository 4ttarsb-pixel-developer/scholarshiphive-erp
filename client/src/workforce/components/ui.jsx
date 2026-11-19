import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { initials, label, money, monthLabel } from '../format.js';

// ------------------------------------------------------------- badges & people
export function Badge({ text, className = '' }) {
  const t = String(text || '');
  const lbl = label(t);
  let c = 'blue';
  if (/^(Settled|Cancelled|Holiday|WeeklyOff|NotEmployed|Upcoming|Superseded|Inactive|Terminated|Not calculated)$/.test(t)) c = 'gray';
  else if (/Paid|Verified|Active|Approved|Present|Reviewed|Earned|PaidLeave/.test(t) && !/Unpaid/.test(t)) c = 'green';
  else if (/Pending|Draft|Suggested|Late|UnpaidLeave/.test(t)) c = 'amber';
  else if (/Rejected|Absent|Missing|Denied|Reversed|Blocked/.test(t)) c = 'red';
  return <span className={`tag ${c} ${className}`}>{lbl}</span>;
}

export const DemoTag = ({ show }) => (show ? <span className="tag demo" title="Demo record — safe to reset">DEMO</span> : null);

export function Person({ name, sub, code, demo }) {
  return (
    <span className="person">
      <span className="avatar">{initials(name)}</span>
      <span>
        <b>{name}<DemoTag show={demo} /></b>
        <small>{[sub, code].filter(Boolean).join(' · ')}</small>
      </span>
    </span>
  );
}

export const MoneySpan = ({ n, cls = '' }) => <span className={`money ${cls}`}>{money(n)}</span>;

// ------------------------------------------------------------- layout blocks
export function Header({ overline, title, subtitle, children, month }) {
  return (
    <div className="topbar">
      <div>
        <div className="overline">{overline}</div>
        <div className="title">{title}</div>
        <div className="sub">{subtitle}</div>
      </div>
      <div className="toptools no-print">
        {month && <span className="labelchip">{monthLabel(month)}</span>}
        {children}
      </div>
    </div>
  );
}

export const Kpis = ({ children }) => <div className="kpis">{children}</div>;
export const Kpi = ({ label: l, value, foot }) => (
  <div className="kpi"><div className="klabel">{l}</div><div className="kvalue">{value}</div><div className="kfoot">{foot}</div></div>
);

export function Card({ title, sub, extras, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || extras) && (
        <div className="section">
          <div>{title && <h2>{title}</h2>}{sub && <p>{sub}</p>}</div>
          {extras}
        </div>
      )}
      {children}
    </section>
  );
}

export function Table({ heads, children, empty = 'No matching records', minWidth }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="tablewrap">
      <table style={minWidth ? { minWidth } : undefined}>
        <thead><tr>{heads.map((h, i) => <th key={i} className={h === '' ? 'checkcell' : ''}>{h}</th>)}</tr></thead>
        <tbody>{rows.length ? rows : <tr><td colSpan={heads.length} className="empty">{empty}</td></tr>}</tbody>
      </table>
    </div>
  );
}

export const Loading = ({ text = 'Loading…' }) => <div className="loading"><span className="spinner" />{text}</div>;
export const ErrorBox = ({ error }) => (error ? <div className="errorbox">⚠ {error.message || String(error)}</div> : null);

export function Field({ label: l, children, grow, full, hint }) {
  return (
    <label className={`field ${grow ? 'grow' : ''} ${full ? 'full' : ''}`}>
      <span>{l}</span>
      {children}
      {hint && <small className="tiny">{hint}</small>}
    </label>
  );
}

export function MonthPicker({ value, onChange }) {
  return (
    <span className="monthpick" title="Payroll month">
      <span className="tiny">Month</span>
      <input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </span>
  );
}

// ------------------------------------------------------------- modal
export function Modal({ title, onClose, children, footer, width, dismissible = true }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dismissible]);
  return (
    <div className="modalarea" onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose(); }}>
      <section className="modalbox" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'} style={width ? { width: `min(${width}px,100%)` } : undefined}>
        <div className="modalhead"><h2>{title}</h2>{dismissible && <button className="modalclose" onClick={onClose} aria-label="Close">×</button>}</div>
        {children}
        {footer && <div className="modalfoot no-print">{footer}</div>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------- toast + confirm
const UiCtx = createContext(null);
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }) {
  const [toastMsg, setToast] = useState(null);
  const [confirmState, setConfirm] = useState(null);
  const timer = useRef(null);
  const toast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4200);
  }, []);
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirm({ ...opts, resolve })), []);
  const close = (v) => { confirmState?.resolve(v); setConfirm(null); };
  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      {confirmState && (
        <Modal title={confirmState.title || 'Please confirm'} onClose={() => close(false)}
          footer={<><button className="btn outline" onClick={() => close(false)}>Cancel</button>
            <button className={`btn ${confirmState.danger ? 'danger' : ''}`} onClick={() => close(true)} autoFocus>{confirmState.confirmText || 'Confirm'}</button></>}>
          <div className="sub" style={{ whiteSpace: 'pre-line' }}>{confirmState.message}</div>
          {confirmState.children}
        </Modal>
      )}
    </UiCtx.Provider>
  );
}

/** Wrap a mutation handler: shows toast on success/error, returns result or undefined. */
export function useAction() {
  const { toast } = useUi();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(typeof success === 'function' ? success(r) : success);
      return r;
    } catch (e) {
      toast(e.message || 'Something went wrong.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}
