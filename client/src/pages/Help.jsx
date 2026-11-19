import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Rocket, LayoutDashboard, TrendingUp, Receipt, Wallet, BadgeDollarSign, Landmark, BarChart3, ShieldCheck, Lock, Wrench, Search, ChevronDown, LogIn, Mail, CircleHelp,
} from 'lucide-react';
import { useLang, pick } from '../lib/i18n.jsx';
import { Card, Input } from '../components/ui.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { TOPICS } from './help/content.js';

const ICONS = { Rocket, LayoutDashboard, TrendingUp, Receipt, Wallet, BadgeDollarSign, Landmark, BarChart3, ShieldCheck, Lock, Wrench };
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[ً-ٰٟ]/g, '');

/** Renders an answer: "- " lines → bullets, "1. " lines → numbered steps, others → paragraphs. */
function Answer({ text }) {
  const blocks = [];
  for (const line of String(text).split('\n')) {
    const bullet = line.match(/^- (.*)/);
    const step = line.match(/^\d+\. (.*)/);
    const kind = bullet ? 'ul' : step ? 'ol' : 'p';
    const body = bullet ? bullet[1] : step ? step[1] : line;
    const last = blocks[blocks.length - 1];
    if (kind !== 'p' && last?.kind === kind) last.items.push(body);
    else blocks.push({ kind, items: [body] });
  }
  return blocks.map((b, i) => (b.kind === 'p'
    ? <p key={i}>{b.items[0]}</p>
    : b.kind === 'ul' ? <ul key={i}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul> : <ol key={i}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ol>));
}

/** Help centre — every common question about using the ERP, in English, Roman Urdu and Urdu. */
export default function Help({ publicView }) {
  const { topic } = useParams();
  const nav = useNavigate();
  const { lang, tx } = useLang();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const active = TOPICS.find(t => t.id === topic) ? topic : '';
  const base = '/help';

  const results = useMemo(() => {
    const term = norm(q.trim());
    return TOPICS.filter(t => !active || term || t.id === active).map(t => ({
      ...t,
      items: t.items.filter(it => !term || [it.q.en, it.a.en, pick(it.q, lang), pick(it.a, lang), pick(t.title, lang)].some(x => norm(x).includes(term))),
    })).filter(t => t.items.length);
  }, [q, active, lang]);
  const count = results.reduce((a, t) => a + t.items.length, 0);
  const toggle = key => setOpen(s => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  return (
    <div className="help">
      <div className="page-head">
        <div><h1>Help Centre</h1><p>Answers to common questions about using ScholarshipHive ERP.</p></div>
        <div className="page-actions">
          {publicView && <LanguageSwitcher />}
          {publicView && <Link className="btn" to="/login"><LogIn />Back to login</Link>}
        </div>
      </div>

      <div className="help-search">
        <Search />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search help… e.g. installment, password, receipt" aria-label="Search help" />
      </div>

      <div className="help-topics" role="tablist" aria-label="Topics">
        <button type="button" role="tab" aria-selected={!active} className={`chip ${!active ? 'on' : ''}`} onClick={() => nav(base)}>All topics</button>
        {TOPICS.map(t => {
          const I = ICONS[t.icon] || CircleHelp;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={active === t.id} className={`chip ${active === t.id ? 'on' : ''}`} onClick={() => nav(`${base}/${t.id}`)} data-no-translate>
              <I size={14} />{pick(t.title, lang)}
            </button>
          );
        })}
      </div>

      {q && <p className="small muted">{tx('{n} result(s)', { n: count })}</p>}
      {!count && <Card><div className="empty-state"><CircleHelp /><h3>No answer found</h3><p className="muted">Try another word, or ask your admin.</p></div></Card>}

      <div className="stack">
        {results.map(t => {
          const I = ICONS[t.icon] || CircleHelp;
          return (
            <section key={t.id} className="help-section" id={t.id}>
              <h2 data-no-translate><I size={18} />{pick(t.title, lang)}</h2>
              <div className="faq" data-no-translate>
                {t.items.map((it, i) => {
                  const key = `${t.id}-${i}`;
                  const isOpen = open.has(key) || !!q;
                  return (
                    <div key={key} className={`faq-item ${isOpen ? 'open' : ''}`}>
                      <button type="button" className="faq-q" aria-expanded={isOpen} onClick={() => toggle(key)}>
                        <span>{pick(it.q, lang)}</span><ChevronDown className="faq-chev" />
                      </button>
                      {isOpen && <div className="faq-a prose"><Answer text={pick(it.a, lang)} /></div>}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <Card className="help-contact">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <Mail style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <div>
            <b>Still need help?</b>
            <p className="small muted" style={{ margin: '4px 0 0' }}>Ask your admin, or send a request from My Settings → Requests. For account or password problems an admin can send you a new reset link.</p>
            <p className="small" style={{ margin: '8px 0 0' }}>
              <Link to="/privacy">Privacy Policy</Link>{!publicView && <> · <Link to="/settings/requests">My requests</Link></>}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
