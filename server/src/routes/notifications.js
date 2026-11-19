import express from 'express';
import { one, many, query } from '../db.js';
import { ah, HttpError } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requireAdmin, rateLimit } from '../middleware/auth.js';
import { runDaily, runDailyIfDue } from '../lib/jobs.js';
import { audit } from '../lib/audit.js';

// ═════════ In-app notifications (bell) ═════════
const r = express.Router();
r.use(requireAuth);
r.get('/', ah(async (req, res) => {
  runDailyIfDue(); // payment reminders etc. — at most once a day, in the background
  const rows = await many(`SELECT id, kind, title, body, link, meta, is_read, created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC, id DESC LIMIT 40`, [req.user.id]);
  const unread = (await one('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id=$1 AND NOT is_read', [req.user.id])).n;
  res.json({ rows, unread });
}));
r.post('/read', ah(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 200).map(x => v.id(x)) : null;
  if (ids?.length) await query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND id = ANY($2::bigint[])', [req.user.id, ids]);
  else await query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND NOT is_read', [req.user.id]);
  res.json({ ok: true });
}));
r.delete('/', ah(async (req, res) => { await query('DELETE FROM notifications WHERE user_id=$1 AND is_read', [req.user.id]); res.json({ ok: true }); }));
r.post('/run-daily', requireAdmin, ah(async (req, res) => {
  const out = await runDaily({ force: true });
  await audit(null, req.user, 'daily.run', 'system', null, out);
  res.json(out);
}));
export default r;

// ═════════ Vercel Cron (vercel.json → GET /api/cron/daily, sends "Authorization: Bearer <CRON_SECRET>") ═════════
export const cron = express.Router();
cron.get('/daily', ah(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'Not allowed.');
  res.json(await runDaily());
}));

// ═════════ Browser crash reports (shown in Vercel → Logs) ═════════
export const clientErrors = express.Router();
clientErrors.post('/', rateLimit('client-error', 20, 10 * 60 * 1000), (req, res) => {
  const b = req.body || {};
  const msg = String(b.message || '').slice(0, 500);
  if (!msg) return res.status(204).end();
  console.error('[client-error]', JSON.stringify({ user: req.user?.id || null, url: String(b.url || '').slice(0, 300), message: msg, stack: String(b.stack || '').slice(0, 1500) }));
  res.status(204).end();
});
