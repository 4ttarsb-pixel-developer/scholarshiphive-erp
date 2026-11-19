// Step-by-step form shell (same look as New Sale / Deal): steps on top, one card, Back / Next / Save.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw, Save } from 'lucide-react';
import { useLang } from '../lib/i18n.jsx';
import { Button, Card, Notice } from './ui.jsx';

export function Wizard({ title, subtitle, backTo, steps, step, onStep, validate, onSubmit, busy, submitLabel = 'Save', onReset, restored, error, children }) {
  const nav = useNavigate();
  const { tx } = useLang();
  const top = useRef(null);
  useEffect(() => { top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, [step]);
  const last = step === steps.length - 1;
  const next = () => { if (validate(step)) onStep(step + 1); };
  const submit = () => {
    for (let s = 0; s < steps.length; s++) if (!validate(s)) { onStep(s); return; }
    onSubmit();
  };
  return (
    <div className="wizard" ref={top}>
      <div className="page-head">
        <div className="row" style={{ gap: 10 }}>
          <button className="icon-btn" onClick={() => nav(backTo)} aria-label="Back"><ArrowLeft className="chev-flip" /></button>
          <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
        </div>
        {onReset && <div className="page-actions"><Button icon={RotateCcw} onClick={onReset}>Clear form</Button></div>}
      </div>
      {restored && <Notice type="info">Your unsaved draft was restored on this device.</Notice>}
      <ol className={`wizard-steps n${steps.length}`} aria-label="Steps" style={{ marginTop: restored ? 12 : 0 }}>
        {steps.map((s, i) => (
          <li key={s.title} className={i === step ? 'current' : i < step ? 'done' : ''}>
            <button type="button" onClick={() => i < step && onStep(i)} disabled={i >= step} aria-current={i === step ? 'step' : undefined}>
              <span className="step-dot">{i < step ? <CheckCircle2 size={16} /> : s.icon ? <s.icon size={15} /> : null}</span>
              <span className="step-label"><small>{tx('Step {n}', { n: i + 1 })}</small>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <Card>
        {children}
        {error && <div style={{ marginTop: 14 }}><Notice type="error">{error}</Notice></div>}
        <div className="wizard-foot">
          <Button icon={ArrowLeft} disabled={step === 0 || busy} onClick={() => onStep(step - 1)}>Back</Button>
          {!last ? <Button variant="primary" onClick={next}>Next<ArrowRight size={16} /></Button>
            : <Button variant="primary" icon={Save} loading={busy} onClick={submit}>{submitLabel}</Button>}
        </div>
      </Card>
    </div>
  );
}

/** Keeps a draft of a new (not edit) form in this browser so a refresh does not lose typing. */
export function useDraft(key, blank, { enabled = true, userId } = {}) {
  const [init] = useState(() => {
    if (!enabled) return { form: blank, restored: false };
    try {
      const d = JSON.parse(localStorage.getItem(key) || 'null');
      const merged = d && d.user === userId && d.form ? { ...blank, ...d.form } : null;
      if (merged && JSON.stringify(merged) !== JSON.stringify(blank)) return { form: merged, restored: true };
    } catch { /* storage blocked */ }
    return { form: blank, restored: false };
  });
  const [form, setForm] = useState(init.form);
  const [restored, setRestored] = useState(init.restored);
  useEffect(() => {
    if (!enabled) return undefined;
    const t = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify({ user: userId, form })); } catch { /* ignore */ } }, 400);
    return () => clearTimeout(t);
  }, [form, key, enabled, userId]);
  const clear = () => { try { localStorage.removeItem(key); } catch { /* ignore */ } setRestored(false); };
  return { form, setForm, restored, clear, reset: () => { clear(); setForm(blank); } };
}

/** Big tappable options (used for "first pick the main field, then its sub-field"). */
export function ChoiceGrid({ value, onChange, options, error }) {
  return (
    <div className="choice-grid" role="radiogroup">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`choice ${value === o.value ? 'on' : ''} ${error ? 'err' : ''}`} onClick={() => onChange(o.value)}>
          <b>{o.icon && <o.icon />}<span data-no-translate={o.noTranslate ? '' : undefined}>{o.label}</span></b>
          {o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}
