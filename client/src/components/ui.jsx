import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, EyeOff, FileText, Globe, Info, Inbox,
  Loader2, Search, Upload, X, XCircle,
} from 'lucide-react';
import { STATUS_TONE, initials, titleCase, money, FLAG_CODES } from '../lib/format.js';
import { fileUrl, qs } from '../lib/api.js';

// ═════════ Toasts ═════════
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const remove = useCallback(id => setItems(x => x.filter(t => t.id !== id)), []);
  const push = useCallback((msg, type = 'info', ms = 4500) => {
    const id = Math.random().toString(36).slice(2);
    setItems(x => [...x.slice(-3), { id, msg, type }]);
    setTimeout(() => remove(id), ms);
  }, [remove]);
  const value = useMemo(() => ({ info: m => push(m, 'info'), success: m => push(m, 'success'), error: m => push(m, 'error', 7000), warn: m => push(m, 'warn', 6000) }), [push]);
  const icon = { success: <CheckCircle2 color="var(--green)" />, error: <XCircle color="var(--red)" />, warn: <AlertTriangle color="var(--orange)" />, info: <Info color="var(--primary)" /> };
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map(t => <div key={t.id} className={`toast ${t.type}`}>{icon[t.type]}<span>{t.msg}</span><button onClick={() => remove(t.id)} aria-label="Close"><X size={15} /></button></div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ═════════ Basics ═════════
export const Button = ({ variant, size, loading, icon: Icon, children, className = '', block, type = 'button', ...p }) => (
  <button type={type} className={`btn ${variant ? 'btn-' + variant : ''} ${size === 'sm' ? 'btn-sm' : ''} ${block ? 'btn-block' : ''} ${className}`} disabled={loading || p.disabled} {...p}>
    {loading ? <Loader2 className="spin" /> : Icon ? <Icon /> : null}{children}
  </button>
);

export const Badge = ({ tone, children, status }) => {
  const t = tone || STATUS_TONE[status] || 'grey';
  return <span className={`badge b-${t}`}>{children ?? titleCase(status)}</span>;
};

export const Card = ({ title, subtitle, actions, children, pad, className = '', ...p }) => (
  <section className={`card ${className}`} {...p}>
    {(title || actions) && <div className="card-head"><div>{title && <h3>{title}</h3>}{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="row">{actions}</div>}</div>}
    <div className={pad === false ? '' : 'card-body'}>{children}</div>
  </section>
);

export function Kpi({ icon: Icon, color = 'blue', label, value, sub, trend, invert }) {
  let trendEl = null;
  if (trend !== undefined && trend !== null) {
    const up = trend >= 0;
    const good = invert ? !up : up;
    trendEl = <span style={{ color: good ? 'var(--green)' : 'var(--red)', fontWeight: 700 }}>{up ? '↑' : '↓'} {Math.abs(trend)}%</span>;
  }
  return (
    <div className="card kpi">
      <div className={`kpi-icon c-${color}`}>{Icon && <Icon />}</div>
      <div style={{ minWidth: 0 }}>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">{value}</div>
        {(sub || trendEl) && <div className="kpi-sub">{trendEl}{sub && <span>{sub}</span>}</div>}
      </div>
    </div>
  );
}

export function Avatar({ fileId, name, size = 34, src }) {
  const [broken, setBroken] = useState(false);
  const url = src || (fileId ? fileUrl(fileId) : null);
  const style = { width: size, height: size, fontSize: size * 0.38 };
  if (url && !broken) return <img className="avatar" style={style} src={url} alt={name || ''} onError={() => setBroken(true)} />;
  return <span className="avatar" style={style}>{initials(name)}</span>;
}

export const Person = ({ name, sub, fileId, size }) => (
  <div className="person"><Avatar fileId={fileId} name={name} size={size} /><div style={{ minWidth: 0 }}><b>{name}</b>{sub && <small>{sub}</small>}</div></div>
);

export const Flag = ({ country }) => {
  const code = FLAG_CODES[country];
  const [broken, setBroken] = useState(false);
  if (!code || broken) return <Globe size={16} color="var(--muted)" />;
  return <img src={`https://flagcdn.com/w20/${code}.png`} width="20" height="14" alt="" style={{ borderRadius: 2, objectFit: 'cover', flexShrink: 0 }} onError={() => setBroken(true)} />;
};

export const Loader = ({ text = 'Loading…' }) => <div className="loader"><div style={{ textAlign: 'center' }}><Loader2 /><div className="small mt">{text}</div></div></div>;
export const Empty = ({ icon: Icon = Inbox, title = 'Nothing here yet', children }) => (
  <div className="empty-state"><Icon /><div className="strong" style={{ color: 'var(--text-2)' }}>{title}</div>{children && <div className="small" style={{ marginTop: 4 }}>{children}</div>}</div>
);
export const Notice = ({ type = 'info', children }) => {
  const I = { info: Info, warn: AlertTriangle, error: XCircle, success: CheckCircle2 }[type];
  return <div className={`notice ${type}`}><I />{<div>{children}</div>}</div>;
};

// ═════════ Modal / Drawer / Confirm ═════════
export function Modal({ open, onClose, title, subtitle, children, footer, size, drawer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={`overlay ${drawer ? 'drawer-overlay' : ''}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={drawer ? 'drawer' : `modal ${size || ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div><button className="icon-btn" onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="modal-body" style={drawer ? { flex: 1 } : undefined}>{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>, document.body);
}

const ConfirmCtx = createContext(null);
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const ask = useCallback(opts => new Promise(resolve => setState({ ...opts, resolve })), []);
  const close = v => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} title={state?.title || 'Are you sure?'} size="sm"
        footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state?.ok || 'Yes, continue'}</Button></>}>
        <p style={{ margin: 0, color: 'var(--text-2)' }}>{state?.message}</p>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

// ═════════ Form controls ═════════
export function Field({ label, required, hint, error, children, full, className = '' }) {
  return (
    <div className={`field ${full ? 'full' : ''} ${className}`}>
      {label && <label>{label}{required && <span className="req">*</span>}</label>}
      {children}
      {error ? <span className="error">{error}</span> : hint ? <small>{hint}</small> : null}
    </div>
  );
}
export const Input = ({ className = '', ...p }) => <input className={`input ${className}`} {...p} />;
export const Textarea = ({ className = '', ...p }) => <textarea className={`textarea ${className}`} {...p} />;
export const MoneyInput = ({ value, onChange, ...p }) => (
  <input className="input mono" inputMode="decimal" placeholder="e.g. 25000" value={value} onChange={e => onChange(e.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))} {...p} />
);

/**
 * Website dropdown (no native <select> popup).
 * options: [{value,label,hint}] or strings.
 */
export function Select({ value, onChange, options, placeholder = 'Select…', disabled, searchable, id, renderOption, ariaLabel }) {
  const opts = useMemo(() => (options || []).map(o => (typeof o === 'object' ? o : { value: o, label: String(o) })), [options]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);
  const auto = useId();
  const showSearch = searchable ?? opts.length > 8;
  const filtered = q ? opts.filter(o => `${o.label} ${o.hint || ''}`.toLowerCase().includes(q.toLowerCase())) : opts;
  const current = opts.find(o => String(o.value) === String(value));

  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const h = Math.min(300, 46 + opts.length * 37);
    const up = below < h + 12 && r.top > below;
    setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 200) - 8)), width: Math.max(r.width, 200), top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined });
  }, [opts.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!btn.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(false); };
    const re = () => place();
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', re);
    window.addEventListener('scroll', re, true);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('resize', re); window.removeEventListener('scroll', re, true); };
  }, [open, place]);
  useEffect(() => { if (open) { setQ(''); setHi(Math.max(0, opts.findIndex(o => String(o.value) === String(value)))); } }, [open]);

  const choose = o => { onChange?.(o.value); setOpen(false); btn.current?.focus(); };
  const onKey = e => {
    if (disabled) return;
    if (!open && ['ArrowDown', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(filtered.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[hi]) choose(filtered[hi]); }
    else if (e.key === 'Tab') setOpen(false);
  };
  useEffect(() => { menu.current?.querySelector('.select-opt.hi')?.scrollIntoView({ block: 'nearest' }); }, [hi]);

  return (
    <>
      <button type="button" id={id || auto} ref={btn} className={`select-btn ${open ? 'open' : ''}`} disabled={disabled} onClick={() => setOpen(o => !o)} onKeyDown={onKey} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}>
        <span className={current ? 'val' : 'placeholder'}>{current ? current.label : placeholder}</span><ChevronDown />
      </button>
      {open && pos && createPortal(
        <div ref={menu} className="select-menu" role="listbox" style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }} onKeyDown={onKey}>
          {showSearch && <input className="select-search" autoFocus placeholder="Type to search…" value={q} onChange={e => { setQ(e.target.value); setHi(0); }} />}
          {filtered.map((o, i) => (
            <button type="button" key={String(o.value)} role="option" aria-selected={String(o.value) === String(value)} className={`select-opt ${i === hi ? 'hi' : ''} ${String(o.value) === String(value) ? 'sel' : ''}`} onMouseEnter={() => setHi(i)} onClick={() => choose(o)}>
              {renderOption ? renderOption(o) : <span>{o.label}</span>}{o.hint && <small>{o.hint}</small>}{String(o.value) === String(value) && !o.hint && <Check />}
            </button>
          ))}
          {!filtered.length && <div className="select-empty">No match</div>}
        </div>, document.body)}
    </>
  );
}

export function Segmented({ value, onChange, options }) {
  return <div className="seg">{options.map(o => { const v = typeof o === 'object' ? o.value : o; const l = typeof o === 'object' ? o.label : o; return <button type="button" key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>; })}</div>;
}

// Password length rule from Admin Settings → Security (loaded with the app; default exactly 12).
let POLICY = { min: 12, max: 12 };
export function setPasswordPolicy(p) { if (p && p.min) POLICY = { min: Number(p.min), max: Number(p.max) || Number(p.min) }; }
export const passwordPolicy = () => POLICY;
export const passwordRuleText = () => (POLICY.min === POLICY.max
  ? `Password must be exactly ${POLICY.min} characters with a capital letter, a small letter, a number and a special character (no spaces).`
  : `Password must be ${POLICY.min} to ${POLICY.max} characters with a capital letter, a small letter, a number and a special character (no spaces).`);

/**
 * Password box with a working show / hide (eye) button, Caps Lock warning and character counter.
 * showRules = choosing a new password (rules + strength meter, length limited by the policy).
 * autoComplete="current-password" = typing an existing password (never cut short, so old passwords still work).
 */
export function PasswordInput({ value, onChange, showRules, autoComplete, ...p }) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const current = String(autoComplete || '').includes('current');
  const { min, max } = POLICY;
  const lenOk = value.length >= min && value.length <= max;
  const rules = [
    [min === max ? `Exactly ${min} characters` : `${min}–${max} characters`, lenOk], ['Capital letter', /[A-Z]/.test(value)], ['Small letter', /[a-z]/.test(value)],
    ['Number', /\d/.test(value)], ['Special character', /[^A-Za-z0-9\s]/.test(value)],
  ];
  const score = rules.filter(r => r[1]).length;
  const keyCheck = e => { try { setCaps(Boolean(e.getModifierState && e.getModifierState('CapsLock'))); } catch { /* ignore */ } };
  return (
    <>
      <div className="input-affix">
        <input className="input" type={show ? 'text' : 'password'} value={value} spellCheck={false} autoCapitalize="off" autoCorrect="off"
          maxLength={current ? 128 : max} autoComplete={autoComplete || 'new-password'}
          onChange={e => onChange(e.target.value.replace(/\s/g, ''))} onKeyUp={keyCheck} onKeyDown={keyCheck} onBlur={() => setCaps(false)} {...p} />
        <button type="button" className="affix" onClick={() => setShow(s => !s)} onMouseDown={e => e.preventDefault()} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} title={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff /> : <Eye />}</button>
      </div>
      {(caps || value.length > 0) && (
        <div className="pw-meta">
          <span className="caps">{caps ? 'Caps Lock is on' : ''}</span>
          <span className={`count ${!current && value.length ? (lenOk ? 'ok' : 'bad') : ''}`} dir="ltr">{current ? value.length : `${value.length} / ${min === max ? min : `${min}–${max}`}`}</span>
        </div>
      )}
      {showRules && <>
        <div className="pw-meter">{rules.map((r, i) => <span key={i} className={i < score ? 'on' : ''} style={i < score && score < 5 ? { background: score < 3 ? 'var(--red)' : 'var(--orange)' } : undefined} />)}</div>
        <div className="pw-rules">{rules.map(([t, ok]) => <span key={t} className={ok ? 'ok' : ''}>{ok ? '✓' : '•'} {t}</span>)}</div>
      </>}
    </>
  );
}
export const passwordOk = v => v.length >= POLICY.min && v.length <= POLICY.max && /[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9\s]/.test(v) && !/\s/.test(v);

/** Big phone photos are shrunk in the browser (Vercel accepts max ~4.5 MB per request). PDFs/DOCX are left alone. */
async function shrinkImage(file) {
  try {
    if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 900 * 1024) return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch { return file; }
}

export function FileInput({ file, onChange, accept, label = 'Choose file', hint, image, existing }) {
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (image && file) { const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u); }
    setPreview(null);
  }, [file, image]);
  return (
    <div className={`filebox ${drag ? 'drag' : ''}`} onClick={() => ref.current?.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={async e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) onChange(await shrinkImage(e.dataTransfer.files[0])); }} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') ref.current?.click(); }}>
      {preview ? <img className="thumb" src={preview} alt="" /> : file ? <FileText /> : <Upload />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="fname">{file ? file.name : existing || label}</div>
        <div className="hint">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : hint}</div>
      </div>
      {file && <button type="button" className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); onChange(null); if (ref.current) ref.current.value = ''; }}><X /></button>}
      <input ref={ref} type="file" accept={accept} hidden onChange={async e => { const f = e.target.files?.[0]; onChange(f ? await shrinkImage(f) : null); }} />
    </div>
  );
}

export function MonthPicker({ value, onChange }) {
  const [y, m] = value.split('-').map(Number);
  const move = n => { const t = y * 12 + m - 1 + n; onChange(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`); };
  return (
    <div className="row" style={{ gap: 4 }}>
      <button type="button" className="icon-btn" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft /></button>
      <div className="btn" style={{ minWidth: 150, cursor: 'default' }}>{new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })}</div>
      <button type="button" className="icon-btn" onClick={() => move(1)} aria-label="Next month"><ChevronRight /></button>
    </div>
  );
}

export function DateRange({ from, to, onChange, allowAll }) {
  const presets = useMemo(() => {
    const d = new Date(); const p = n => String(n).padStart(2, '0');
    const ym = (yy, mm) => `${yy}-${p(mm)}`;
    const end = (yy, mm) => `${ym(yy, mm)}-${p(new Date(yy, mm, 0).getDate())}`;
    const Y = d.getFullYear(), M = d.getMonth() + 1;
    const lm = M === 1 ? [Y - 1, 12] : [Y, M - 1];
    const iso = x => `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
    const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const y12 = M === 12 ? [Y, 1] : [Y - 1, M + 1];
    return [
      { value: 'week', label: 'This week', from: iso(mon), to: iso(sun) },
      { value: 'this', label: 'This month', from: `${ym(Y, M)}-01`, to: end(Y, M) },
      { value: 'last', label: 'Last month', from: `${ym(...lm)}-01`, to: end(...lm) },
      { value: 'q', label: 'Last 3 months', from: `${ym(...(M > 2 ? [Y, M - 2] : [Y - 1, M + 10]))}-01`, to: end(Y, M) },
      { value: '12m', label: 'Last 12 months', from: `${ym(...y12)}-01`, to: end(Y, M) },
      { value: 'year', label: 'This year', from: `${Y}-01-01`, to: `${Y}-12-31` },
      { value: 'lastyear', label: 'Last year', from: `${Y - 1}-01-01`, to: `${Y - 1}-12-31` },
      ...(allowAll ? [{ value: 'all', label: 'All time', from: '', to: '' }] : []),
      { value: 'custom', label: 'Custom dates' },
    ];
  }, [allowAll]);
  const match = presets.find(p => p.from === (from || '') && p.to === (to || ''));
  const [custom, setCustom] = useState(!match);
  return (
    <div className="row" style={{ gap: 6 }}>
      <div style={{ minWidth: 150 }}>
        <Select value={custom ? 'custom' : match?.value} options={presets} onChange={v => { if (v === 'custom') setCustom(true); else { setCustom(false); const p = presets.find(x => x.value === v); onChange(p.from, p.to); } }} ariaLabel="Date range" />
      </div>
      {custom && <>
        <input type="date" className="input" style={{ width: 150 }} value={from || ''} max={to || undefined} onChange={e => e.target.value && onChange(e.target.value, to || e.target.value)} aria-label="From date" />
        <input type="date" className="input" style={{ width: 150 }} value={to || ''} min={from || undefined} onChange={e => e.target.value && onChange(from || e.target.value, e.target.value)} aria-label="To date" />
      </>}
    </div>
  );
}

// ═════════ Data table ═════════
/** columns: [{key,label,render(row),money,align,sortValue,width}] */
export function DataTable({ columns, rows, onRowClick, search = true, searchKeys, pageSize = 25, empty = 'No records yet', tools, footer, loading, initialSort }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState(initialSort || null);
  useEffect(() => setPage(0), [q, rows]);
  const filtered = useMemo(() => {
    let list = rows || [];
    if (q) {
      const s = q.toLowerCase();
      list = list.filter(r => (searchKeys || columns.map(c => c.key)).some(k => String(r[k] ?? '').toLowerCase().includes(s)));
    }
    if (sort) {
      const col = columns.find(c => c.key === sort.key);
      const val = r => (col?.sortValue ? col.sortValue(r) : r[sort.key]);
      list = [...list].sort((a, b) => { const x = val(a), y = val(b); const n = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }); return sort.dir === 'asc' ? n : -n; });
    }
    return list;
  }, [rows, q, sort, columns, searchKeys]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const view = filtered.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <>
      {(search || tools) && <div className="table-tools">
        {search && <div className="search"><Search /><input className="input" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search table" /></div>}
        <div className="spacer" />{tools}
      </div>}
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr>{columns.map(c => (
            <th key={c.key} className={c.money || c.align === 'right' ? 'num' : ''} style={{ width: c.width, cursor: c.sortable === false ? 'default' : 'pointer' }}
              onClick={() => c.sortable !== false && setSort(s => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'desc' }))}>
              {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
            </th>))}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={columns.length} className="tbl-empty"><Loader2 className="spin" /></td></tr>
              : view.length ? view.map((r, i) => (
                <tr key={r.id ?? i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                  {columns.map(c => <td key={c.key} className={c.money || c.align === 'right' ? 'num' : c.wrap ? 'wrap' : ''}>{c.render ? c.render(r) : c.money ? money(r[c.key]) : (r[c.key] ?? '—')}</td>)}
                </tr>))
                : <tr><td colSpan={columns.length} className="tbl-empty"><Inbox />{q ? 'No records match your search.' : empty}</td></tr>}
          </tbody>
          {footer && view.length > 0 && <tfoot>{footer(filtered)}</tfoot>}
        </table>
      </div>
      {filtered.length > pageSize && (
        <div className="pager">
          <span>Showing <b dir="ltr">{page * pageSize + 1}–{Math.min(filtered.length, (page + 1) * pageSize)}</b> of {filtered.length}</span>
          <div className="row" style={{ gap: 4 }}>
            <Button size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} icon={ChevronLeft}>Prev</Button>
            <span>Page {page + 1} / {pages}</span>
            <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next <ChevronRight /></Button>
          </div>
        </div>
      )}
    </>
  );
}

export function ExportButtons({ dataset, params }) {
  const href = f => `/api/export/${dataset}${qs({ ...params, format: f })}`;
  return (
    <div className="row" style={{ gap: 6 }}>
      <a className="btn btn-sm" href={href('csv')} download><Download />CSV</a>
      <a className="btn btn-sm" href={href('pdf')} download><Download />PDF</a>
    </div>
  );
}

export const Legend = ({ items }) => <div className="legend">{items.map(i => <span key={i.label}><i style={{ background: i.color }} />{i.label}</span>)}</div>;
