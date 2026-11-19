// ═══════════════════════════════════════════════════════════════
//  Languages: English · Roman Urdu · اردو (right-to-left)
//
//  1. t('text') / tx('Template {n}', { n }) — used by components for dynamic text.
//  2. A small "translator" watches the page and swaps every exact English UI phrase
//     (buttons, labels, headings, table headers, placeholders, tooltips) for the chosen
//     language. It only changes the text of existing nodes (never adds / removes nodes),
//     so React keeps working normally. Anything typed by users (names, notes) is left as is.
//     Add data-no-translate to an element to skip it.
// ═══════════════════════════════════════════════════════════════
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DICT, PATTERNS } from './dict.js';

export const LANGS = [
  { code: 'en', label: 'English', short: 'EN', native: 'English' },
  { code: 'roman', label: 'Roman Urdu', short: 'RU', native: 'Roman Urdu' },
  { code: 'ur', label: 'Urdu', short: 'اردو', native: 'اردو' },
];
const KEY = 'sh_lang';
const valid = l => LANGS.some(x => x.code === l);

export function storedLang() {
  try { const l = localStorage.getItem(KEY); return valid(l) ? l : 'en'; } catch { return 'en'; }
}

export function applyLang(lang) {
  const l = valid(lang) ? lang : 'en';
  const root = document.documentElement;
  root.setAttribute('lang', l === 'ur' ? 'ur' : 'en');
  root.setAttribute('dir', l === 'ur' ? 'rtl' : 'ltr');
  root.setAttribute('data-lang', l);
  try { localStorage.setItem(KEY, l); } catch { /* storage blocked */ }
  if (l === 'ur' && !document.getElementById('urdu-font')) {
    const link = document.createElement('link');
    link.id = 'urdu-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Noto+Nastaliq+Urdu:wght@400;600&display=swap';
    document.head.appendChild(link);
  }
  return l;
}

/** Translate one exact phrase (keeps surrounding spaces). Returns null when there is no translation. */
export function lookup(text, lang) {
  if (lang === 'en' || !text) return null;
  const t = text.trim();
  if (!t || t.length > 600) return null;
  const hit = DICT[t];
  if (hit && hit[lang]) return text.replace(t, hit[lang]);
  for (const p of PATTERNS) {
    const m = t.match(p.re);
    if (m) { const out = p[lang]?.(...m.slice(1)); if (out) return text.replace(t, out); }
  }
  return null;
}

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s);

// ── Live page translator ──
const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE', 'NOSCRIPT', 'INPUT', 'SELECT', 'OPTION']);
let current = 'en';
let observer = null;

const skipped = el => !el || SKIP_TAGS.has(el.tagName) || el.closest?.('[data-no-translate], .notranslate');
// attributes (placeholder / title / aria-label) are translated on inputs too
const skippedAttr = el => !el || el.closest?.('[data-no-translate], .notranslate');

function doText(node) {
  const cur = node.nodeValue;
  const ours = node.__shSet !== undefined && cur === node.__shSet;
  const base = ours ? node.__shOrig : cur;
  if (!ours) { node.__shOrig = cur; node.__shSet = undefined; }
  const out = lookup(base, current);
  if (out != null) { if (out !== cur) { node.__shSet = out; node.nodeValue = out; } }
  else if (ours) { node.__shSet = undefined; node.nodeValue = base; }
}
function doAttr(el, name) {
  const val = el.getAttribute(name);
  if (val == null) return;
  const store = el.__shAttr || (el.__shAttr = {});
  const s = store[name];
  const ours = s && val === s.set;
  const base = ours ? s.orig : val;
  const out = lookup(base, current);
  if (out != null) { if (out !== val) { store[name] = { orig: base, set: out }; el.setAttribute(name, out); } }
  else if (ours) { store[name] = undefined; el.setAttribute(name, base); }
}
function walk(root) {
  if (root.nodeType === 3) { if (!skipped(root.parentElement)) doText(root); return; }
  if (root.nodeType !== 1) return;
  if (!skippedAttr(root)) for (const a of ATTRS) if (root.hasAttribute(a)) doAttr(root, a);
  if (skipped(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeType === 1 ? (SKIP_TAGS.has(n.tagName) || n.hasAttribute('data-no-translate') || n.classList.contains('notranslate') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT),
  });
  root.querySelectorAll?.('[placeholder],[title],[aria-label]').forEach(el => { if (!skippedAttr(el)) for (const a of ATTRS) if (el.hasAttribute(a)) doAttr(el, a); });
  let n;
  while ((n = w.nextNode())) doText(n);
}

export function startTranslator(lang) {
  current = lang;
  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(muts => {
      for (const m of muts) {
        try {
          if (m.type === 'characterData') { if (!skipped(m.target.parentElement)) doText(m.target); }
          else if (m.type === 'attributes') { if (!skippedAttr(m.target)) doAttr(m.target, m.attributeName); }
          else m.addedNodes.forEach(walk);
        } catch (e) { /* never let translation break the page */ console.warn('[i18n]', e); }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  try { walk(document.body); } catch (e) { console.warn('[i18n]', e); }
  document.title = (lookup('ScholarshipHive ERP', lang) || 'ScholarshipHive ERP').trim();
}

// ── React context ──
const LangCtx = createContext({ lang: 'en', setLang: () => {}, t: s => s, tx: (s, v) => fill(s, v) });
export const useLang = () => useContext(LangCtx);

export function LangProvider({ children, onChange }) {
  const [lang, setLangState] = useState(() => applyLang(storedLang()));
  useEffect(() => { startTranslator(lang); }, [lang]);
  const setLang = useCallback(l => { const x = applyLang(l); setLangState(x); onChange?.(x); }, [onChange]);
  const t = useCallback(s => (lang === 'en' ? s : DICT[s]?.[lang] || s), [lang]);
  const tx = useCallback((s, vars) => fill(lang === 'en' ? s : DICT[s]?.[lang] || s, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t, tx, rtl: lang === 'ur' }), [lang, setLang, t, tx]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

/** Pick the right text from { en, roman, ur } objects (used by the Help page). */
export const pick = (obj, lang) => (obj ? obj[lang] || obj.en || '' : '');
