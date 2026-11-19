import express from 'express';
import { one, many, query, tx } from '../db.js';
import { ah, forbidden, notFound } from '../lib/http.js';
import * as v from '../lib/validate.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';
import { can, canApprove, isAdmin } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';
import { sendMail, template, link } from '../lib/email.js';
import { computeMonth } from './salary.js';
import { pettyBalance, ensureCycles } from './expenses.js';
import { periodFigures } from './finance.js';
import { currentMonth, monthBounds } from '../lib/money.js';

// ═════════════ Announcements ═════════════
const r = express.Router();
r.use(requireAuth);

r.get('/', ah(async (req, res) => {
  const rows = await many(`SELECT a.*, u.full_name AS author, u.photo_file_id AS author_photo, u.designation AS author_designation,
      (SELECT COUNT(*)::int FROM announcement_replies x WHERE x.announcement_id=a.id) AS replies,
      EXISTS (SELECT 1 FROM announcement_reads rd WHERE rd.announcement_id=a.id AND rd.user_id=$1) AS is_read
    FROM announcements a LEFT JOIN users u ON u.id=a.created_by ORDER BY a.pinned DESC, a.created_at DESC LIMIT 200`, [req.user.id]);
  res.json({ rows, unread: rows.filter(x => !x.is_read).length, canPost: can(req.user, 'announcements', 'edit') });
}));

r.get('/unread-count', ah(async (req, res) => {
  const x = await one(`SELECT COUNT(*)::int AS n FROM announcements a WHERE NOT EXISTS (SELECT 1 FROM announcement_reads rd WHERE rd.announcement_id=a.id AND rd.user_id=$1)`, [req.user.id]);
  res.json({ unread: x.n });
}));

r.get('/:id', ah(async (req, res) => {
  const a = await one(`SELECT a.*, u.full_name AS author, u.photo_file_id AS author_photo FROM announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1`, [v.id(req.params.id)]);
  if (!a) throw notFound();
  await query('INSERT INTO announcement_reads(announcement_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a.id, req.user.id]);
  const replies = await many(`SELECT x.*, u.full_name, u.photo_file_id, u.employee_code FROM announcement_replies x LEFT JOIN users u ON u.id=x.user_id WHERE x.announcement_id=$1 ORDER BY x.created_at`, [a.id]);
  res.json({ ...a, replies });
}));

r.post('/', requirePerm('announcements', 'edit'), ah(async (req, res) => {
  const f = {
    title: v.text(req.body.title, 'Title', { required: true, max: 200, min: 3 }),
    body: v.text(req.body.body, 'Message', { required: true, max: 5000 }),
    link_url: v.url(req.body.link_url, 'Link'),
    link_label: v.text(req.body.link_label, 'Link text', { max: 120 }) || null,
    pinned: Boolean(req.body.pinned) && isAdmin(req.user),
    notify: req.body.notify !== false,
  };
  const a = await tx(async db => {
    const x = (await db.query('INSERT INTO announcements(title,body,link_url,link_label,pinned,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [f.title, f.body, f.link_url, f.link_label, f.pinned, req.user.id])).rows[0];
    await db.query('INSERT INTO announcement_reads(announcement_id,user_id) VALUES ($1,$2)', [x.id, req.user.id]);
    await audit(db, req.user, 'announcement.create', 'announcement', x.id, { title: f.title });
    return x;
  });
  if (f.notify) {
    const emails = (await many(`SELECT email FROM users WHERE status='approved' AND id<>$1`, [req.user.id])).map(x => x.email);
    sendMail(emails, `Announcement: ${f.title}`, template({
      title: f.title, lines: [...f.body.split(/\n+/).slice(0, 12), f.link_url ? `Link: ${f.link_url}` : ''].filter(Boolean), footnote: `Posted by ${req.user.full_name}`,
      action: { label: 'Read & reply', url: link(`/announcements?id=${a.id}`) },
    }));
  }
  res.status(201).json(a);
}));

r.put('/:id', ah(async (req, res) => {
  const a = await one('SELECT * FROM announcements WHERE id=$1', [v.id(req.params.id)]);
  if (!a) throw notFound();
  if (!isAdmin(req.user) && !(a.created_by === req.user.id && can(req.user, 'announcements', 'edit'))) throw forbidden();
  const title = v.text(req.body.title, 'Title', { required: true, max: 200, min: 3 });
  const body = v.text(req.body.body, 'Message', { required: true, max: 5000 });
  const link_url = v.url(req.body.link_url, 'Link');
  const link_label = v.text(req.body.link_label, 'Link text', { max: 120 }) || null;
  const pinned = isAdmin(req.user) ? Boolean(req.body.pinned) : a.pinned;
  await query('UPDATE announcements SET title=$1, body=$2, link_url=$3, link_label=$4, pinned=$5 WHERE id=$6', [title, body, link_url, link_label, pinned, a.id]);
  res.json({ ok: true });
}));

r.delete('/:id', ah(async (req, res) => {
  const a = await one('SELECT * FROM announcements WHERE id=$1', [v.id(req.params.id)]);
  if (!a) throw notFound();
  if (!isAdmin(req.user) && a.created_by !== req.user.id) throw forbidden();
  await query('DELETE FROM announcements WHERE id=$1', [a.id]);
  await audit(null, req.user, 'announcement.delete', 'announcement', a.id, { title: a.title });
  res.json({ ok: true });
}));

r.post('/:id/replies', ah(async (req, res) => {
  const a = await one('SELECT a.*, u.email AS author_email, u.full_name AS author_name FROM announcements a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=$1', [v.id(req.params.id)]);
  if (!a) throw notFound();
  const body = v.text(req.body.body, 'Reply', { required: true, max: 2000 });
  const x = await one('INSERT INTO announcement_replies(announcement_id,user_id,body) VALUES ($1,$2,$3) RETURNING *', [a.id, req.user.id, body]);
  if (a.author_email && a.created_by !== req.user.id) {
    sendMail(a.author_email, `New reply on "${a.title}"`, template({ title: 'New reply to your announcement', lines: [`${req.user.full_name}: ${body}`], action: { label: 'Open', url: link(`/announcements?id=${a.id}`) } }));
  }
  res.status(201).json(x);
}));

r.delete('/replies/:rid', ah(async (req, res) => {
  const x = await one('SELECT * FROM announcement_replies WHERE id=$1', [v.id(req.params.rid)]);
  if (!x) throw notFound();
  if (!isAdmin(req.user) && x.user_id !== req.user.id) throw forbidden();
  await query('DELETE FROM announcement_replies WHERE id=$1', [x.id]);
  res.json({ ok: true });
}));

export default r;

// ═════════════ Dashboard ═════════════
export const dashboard = express.Router();
dashboard.use(requireAuth);
dashboard.get('/', ah(async (req, res) => {
  const u = req.user;
  const month = currentMonth();
  const { from, next } = monthBounds(month);
  const to = new Date(new Date(next + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
  const out = { month, mySalary: await computeMonth(null, u.id, month) };
  out.unread = (await one(`SELECT COUNT(*)::int AS n FROM announcements a WHERE NOT EXISTS (SELECT 1 FROM announcement_reads rd WHERE rd.announcement_id=a.id AND rd.user_id=$1)`, [u.id])).n;
  out.latestAnnouncements = await many('SELECT id, title, created_at, pinned FROM announcements ORDER BY pinned DESC, created_at DESC LIMIT 4');
  out.myRequests = await many(`SELECT id, type, module, level, status, created_at FROM user_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5`, [u.id]);
  const showFinance = ['revenue', 'expenses', 'cashflow'].some(m => can(u, m, 'view'));
  if (showFinance) await ensureCycles([month]).catch(e => console.error('[cycles]', e.message)); // this month's constant expenses
  if (showFinance) {
    const p = await periodFigures(from, to);
    if (can(u, 'revenue', 'view')) out.revenue = p.revenue;
    if (can(u, 'expenses', 'view')) out.expenses = p.expenses;
    if (can(u, 'cashflow', 'view')) { out.profit = p.profit; out.cash = { inflow: p.cash.inflow, outflow: p.cash.outflow, net: p.cash.net }; }
  }
  if (can(u, 'petty_cash', 'view')) out.petty = await pettyBalance();
  if (isAdmin(u)) {
    out.pending = {
      users: (await one(`SELECT COUNT(*)::int AS n FROM users WHERE status='pending'`)).n,
      requests: (await one(`SELECT COUNT(*)::int AS n FROM user_requests WHERE status='open'`)).n,
      expenses: (await one(`SELECT COUNT(*)::int AS n FROM expenses WHERE status='pending'`)).n
        + (await one(`SELECT COUNT(*)::int AS n FROM recurring_expenses WHERE status='pending'`)).n,
      petty: (await one(`SELECT COUNT(*)::int AS n FROM petty_cash_entries WHERE status='pending'`)).n,
      salaries: (await one(`SELECT COUNT(*)::int AS n FROM payroll_months WHERE status='in_process'`)).n,
    };
  } else if (canApprove(u)) {
    const me = u.id;
    out.approvals = (await one(`SELECT (SELECT COUNT(*) FROM expenses WHERE status='pending' AND created_by IS DISTINCT FROM $1)
                                     + (SELECT COUNT(*) FROM recurring_expenses WHERE status='pending' AND created_by IS DISTINCT FROM $1)
                                     + (SELECT COUNT(*) FROM petty_cash_entries WHERE status='pending' AND created_by IS DISTINCT FROM $1) AS n`, [me])).n;
  }
  res.json(out);
}));
