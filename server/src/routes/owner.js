// Owner Information — a portfolio-style profile (photo, about, skills, experience, education,
// services, work gallery, social accounts). Everyone can read it; only admin / owner can change it.
import express from 'express';
import { one, query, tx } from '../db.js';
import { ah, bad } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { upload, saveFile } from '../lib/files.js';
import { readCustom } from '../lib/forms.js';

export const SOCIALS = ['facebook', 'instagram', 'linkedin', 'x', 'youtube', 'tiktok', 'whatsapp', 'telegram', 'snapchat', 'pinterest', 'threads', 'github', 'behance', 'dribbble', 'medium', 'reddit', 'discord', 'upwork', 'fiverr', 'quora', 'twitch', 'spotify', 'website'];
// Accepted hosts per platform (a Facebook link must really be facebook.com, etc.)
const HOSTS = {
  facebook: ['facebook.com', 'fb.com', 'fb.me'], instagram: ['instagram.com', 'instagr.am'], linkedin: ['linkedin.com', 'lnkd.in'], x: ['x.com', 'twitter.com'],
  youtube: ['youtube.com', 'youtu.be'], tiktok: ['tiktok.com'], whatsapp: ['wa.me', 'whatsapp.com', 'api.whatsapp.com'], telegram: ['t.me', 'telegram.me', 'telegram.org'],
  snapchat: ['snapchat.com'], pinterest: ['pinterest.com', 'pin.it'], threads: ['threads.net', 'threads.com'], github: ['github.com'], behance: ['behance.net'], dribbble: ['dribbble.com'],
  medium: ['medium.com'], reddit: ['reddit.com'], discord: ['discord.gg', 'discord.com'], upwork: ['upwork.com'], fiverr: ['fiverr.com'], quora: ['quora.com'], twitch: ['twitch.tv'], spotify: ['spotify.com'],
};
const SINGLE = ['company_name', 'owner_name', 'designation', 'headline', 'intro', 'about', 'email', 'phone', 'whatsapp', 'website', 'portfolio_url', 'address', 'registration_no', 'ntn', 'founded', 'photo_file_id', 'cv_file_id'];
const LISTS = { skills: 30, experience: 20, education: 20, services: 12, work: 24, socials: 23, extra: 20 };

const t = (x, label, max = 300, min = 0) => v.text(x, label, { max, min });

function socialUrl(platform, raw) {
  let s = String(raw || '').trim();
  if (!s) throw bad('Enter the link.');
  if (platform === 'whatsapp' && /^\+?[\d\s-]{8,18}$/.test(s)) s = `https://wa.me/${s.replace(/\D/g, '')}`;
  if (!/^https?:\/\//i.test(s)) s = `https://${s.replace(/^\/+/, '')}`;
  const url = v.url(s, 'Link');
  const host = new URL(url).hostname.replace(/^www\.|^m\.|^mobile\./, '').toLowerCase();
  if (HOSTS[platform] && !HOSTS[platform].some(h => host === h || host.endsWith('.' + h))) throw bad(`This does not look like a ${platform === 'x' ? 'X (Twitter)' : platform} link (expected ${HOSTS[platform][0]}).`);
  return url;
}

const fileId = x => (x === null || x === undefined || x === '' ? null : v.id(x, 'File'));

/** Cleans one item of a list section. */
function cleanItem(section, x) {
  x = x || {};
  switch (section) {
    case 'skills': return { name: t(x.name, 'Skill', 80, 1), level: x.level === '' || x.level === undefined || x.level === null ? null : v.int(x.level, 'Skill level', { min: 1, max: 100 }) };
    case 'experience': return { period: t(x.period, 'Period', 60), title: t(x.title, 'Role / title', 120, 2), org: t(x.org, 'Company / organisation', 120), detail: t(x.detail, 'Details', 500) };
    case 'education': return { period: t(x.period, 'Period', 60), title: t(x.title, 'Degree / course', 120, 2), institute: t(x.institute, 'Institute', 120) };
    case 'services': return { title: t(x.title, 'Service', 100, 2), description: t(x.description, 'Description', 400), link: x.link ? v.url(x.link, 'Link') : null };
    case 'work': return { title: t(x.title, 'Title', 120, 2), description: t(x.description, 'Description', 300), link: x.link ? v.url(x.link, 'Link') : null, image_file_id: fileId(x.image_file_id) };
    case 'socials': { const platform = v.oneOf(x.platform, SOCIALS, 'Platform'); return { platform, url: platform === 'website' ? v.url(/^https?:/i.test(x.url || '') ? x.url : `https://${x.url || ''}`, 'Website') : socialUrl(platform, x.url) }; }
    case 'extra': return { label: t(x.label, 'Label', 80, 1), value: t(x.value, 'Value', 500, 1) };
    default: throw bad('Unknown section.');
  }
}

function cleanSingle(k, val) {
  if (k === 'photo_file_id' || k === 'cv_file_id') return fileId(val);
  const s = t(val, k.replace(/_/g, ' '), k === 'about' ? 4000 : k === 'intro' ? 600 : 300);
  if (!s) return '';
  if (k === 'email') return v.email(s);
  if (k === 'website' || k === 'portfolio_url') return v.url(/^https?:/i.test(s) ? s : `https://${s}`, k === 'website' ? 'Website' : 'Portfolio URL');
  if ((k === 'phone' || k === 'whatsapp') && !/^\+?[\d\s()-]{7,20}$/.test(s)) throw bad(`${k === 'phone' ? 'Phone' : 'WhatsApp'} number is not valid.`);
  return s;
}

async function load() {
  const row = await one(`SELECT value, updated_at FROM app_settings WHERE key='owner_info'`);
  return { info: row?.value || {}, updated_at: row?.updated_at || null };
}
async function store(info, user, action) {
  await query(`INSERT INTO app_settings(key,value,updated_by,updated_at) VALUES ('owner_info',$1,$2,NOW())
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=NOW()`, [JSON.stringify(info), user.id]);
  await audit(null, user, action, 'settings', 'owner_info');
}

const r = express.Router();
r.use(requireAuth);

r.get('/', ah(async (_req, res) => res.json({ ...(await load()), platforms: SOCIALS })));

/** Save the whole profile. */
r.put('/', requireAdmin, ah(async (req, res) => {
  const b = req.body || {};
  const { info: cur } = await load();
  const info = {};
  for (const k of SINGLE) info[k] = cleanSingle(k, b[k]);
  for (const [k, max] of Object.entries(LISTS)) {
    const list = Array.isArray(b[k]) ? b[k] : [];
    if (list.length > max) throw bad(`At most ${max} items in ${k}.`);
    info[k] = list.map(x => cleanItem(k, x));
  }
  const platforms = info.socials.map(s => s.platform);
  if (new Set(platforms).size !== platforms.length) throw bad('Each social platform can be added only once.');
  info.custom = await readCustom('owner', b.custom, { existing: cur.custom });
  await store(info, req.user, 'owner.update');
  res.json({ ok: true, info });
}));

/** "Select a field and enter data" — add one item to a section, or set one single field. */
r.post('/item', requireAdmin, ah(async (req, res) => {
  const section = String(req.body.section || '');
  const { info } = await load();
  if (SINGLE.includes(section)) {
    info[section] = cleanSingle(section, req.body.value);
  } else if (LISTS[section]) {
    const item = cleanItem(section, req.body.data);
    const list = Array.isArray(info[section]) ? [...info[section]] : [];
    const idx = req.body.index === undefined || req.body.index === null || req.body.index === '' ? -1 : v.int(req.body.index, 'Index', { min: 0, max: 100 });
    if (section === 'socials' && list.some((s, i) => s.platform === item.platform && i !== idx)) throw bad('This platform is already added — edit it instead.');
    if (idx >= 0 && idx < list.length) list[idx] = item; else {
      if (list.length >= LISTS[section]) throw bad(`At most ${LISTS[section]} items in this section.`);
      list.push(item);
    }
    info[section] = list;
  } else throw bad('Choose which field to fill.');
  await store(info, req.user, `owner.item.${section}`);
  res.json({ ok: true, info });
}));

r.delete('/item', requireAdmin, ah(async (req, res) => {
  const section = String(req.query.section || '');
  const { info } = await load();
  if (SINGLE.includes(section)) info[section] = section.endsWith('_file_id') ? null : '';
  else if (LISTS[section]) {
    const idx = v.int(req.query.index, 'Index', { min: 0, max: 100 });
    info[section] = (info[section] || []).filter((_, i) => i !== idx);
  } else throw bad('Unknown section.');
  await store(info, req.user, `owner.remove.${section}`);
  res.json({ ok: true, info });
}));

/** Upload a profile photo, CV or gallery image. Returns the file id. */
r.post('/upload', requireAdmin, upload.single('file'), ah(async (req, res) => {
  const kind = { photo: 'owner_image', image: 'owner_image', cv: 'owner_cv' }[req.body.kind] || 'owner_image';
  if (!req.file) throw bad('Choose a file.');
  const f = await tx(db => saveFile(db, req.file, kind, req.user.id));
  await audit(null, req.user, 'owner.upload', 'file', f.id, { kind });
  res.status(201).json(f);
}));

export default r;
