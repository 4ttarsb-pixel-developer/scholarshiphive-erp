// Daily housekeeping: payment reminders, this month's constant-expense cycles, clean-up.
// Runs from Vercel Cron (/api/cron/daily), from a timer when running on a PC, and lazily
// (at most once a day) when someone opens notifications — so it works even without cron.
import { tx } from '../db.js';
import { notify, usersWith } from './notify.js';
import { sendMail, template } from './email.js';
import { config } from '../config.js';
import { today, pkr, currentMonth, addMonths } from './money.js';

let waitUntil = () => {};
try { ({ waitUntil } = await import('@vercel/functions')); } catch { /* running locally */ }

/** Keeps a background promise alive on Vercel after the response is sent. */
export function background(promise) {
  const p = Promise.resolve(promise).catch(e => console.error('[background]', e.message));
  try { waitUntil(p); } catch { /* ignore */ }
  return p;
}

const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const daysBetween = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400000);
const waLink = (phone, text) => (phone ? `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(text)}` : null);

async function reminders(db, todayStr) {
  // Every installment that is not yet covered by payments (oldest-first allocation)
  const due = (await db.query(`
    WITH pay AS (SELECT sale_id, SUM(amount) AS paid FROM sale_payments GROUP BY sale_id),
         ref AS (SELECT sale_id, SUM(amount) AS refunded FROM sale_refunds GROUP BY sale_id),
         sch AS (SELECT i.*, SUM(i.amount) OVER (PARTITION BY i.sale_id ORDER BY i.seq) AS cum FROM sale_installments i)
    SELECT sch.id AS inst_id, sch.seq, sch.due_date, LEAST(sch.amount, sch.cum - COALESCE(pay.paid,0))::numeric AS amount_due,
           s.id AS sale_id, s.invoice_no, s.employee_id, s.reminder_days, s.reminder_channels, c.name, c.email, c.phone
      FROM sch JOIN sales s ON s.id=sch.sale_id JOIN customers c ON c.id=s.customer_id
      LEFT JOIN pay ON pay.sale_id=s.id LEFT JOIN ref ON ref.sale_id=s.id
     WHERE sch.cum > COALESCE(pay.paid,0) + 0.005
       AND NOT (COALESCE(ref.refunded,0) > 0 AND COALESCE(ref.refunded,0) >= COALESCE(pay.paid,0))
       AND sch.due_date <= $1::date + s.reminder_days
     UNION ALL
    SELECT NULL, NULL, s.due_date, (s.total_amount - COALESCE(pay.paid,0))::numeric, s.id, s.invoice_no, s.employee_id, s.reminder_days, s.reminder_channels, c.name, c.email, c.phone
      FROM sales s JOIN customers c ON c.id=s.customer_id LEFT JOIN pay ON pay.sale_id=s.id LEFT JOIN ref ON ref.sale_id=s.id
     WHERE s.due_date IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sale_installments i WHERE i.sale_id=s.id)
       AND s.total_amount - COALESCE(pay.paid,0) > 0.005
       AND NOT (COALESCE(ref.refunded,0) > 0 AND COALESCE(ref.refunded,0) >= COALESCE(pay.paid,0))
       AND s.due_date <= $1::date + s.reminder_days
     ORDER BY 3 LIMIT 500`, [todayStr])).rows;
  if (!due.length) return { reminders: 0, emails: 0 };
  const watchers = await usersWith('revenue', 'edit');
  const admins = (await db.query(`SELECT id FROM users WHERE role IN ('super_admin','admin') AND status='approved'`)).rows.map(r => r.id);
  let count = 0;
  const mails = [];
  for (const d of due) {
    const left = daysBetween(d.due_date, todayStr);
    const key = d.inst_id ? `i${d.inst_id}` : `s${d.sale_id}`;
    const stage = left > 0 ? `soon:${key}` : left === 0 ? `today:${key}` : `overdue:${key}:${Math.floor((-left - 1) / 7)}`;
    const title = left > 0 ? `Payment due in ${left} day(s): ${d.name}` : left === 0 ? `Payment due today: ${d.name}` : `Overdue ${-left} day(s): ${d.name}`;
    const body = `${d.invoice_no} · ${pkr(d.amount_due)} ${left >= 0 ? 'due' : 'was due'} ${fmtDate(d.due_date)}${d.seq ? ` (installment ${d.seq})` : ''}`;
    const msg = `Assalam-o-Alaikum ${d.name}, this is a reminder from ${config.companyName}: ${pkr(d.amount_due)} for ${d.invoice_no} ${left >= 0 ? 'is due on' : 'was due on'} ${fmtDate(d.due_date)}. Thank you.`;
    const channels = d.reminder_channels || ['app'];
    const recipients = [...new Set([d.employee_id, ...admins, ...watchers.filter(id => id === d.employee_id)])];
    const got = await notify(db, recipients, {
      kind: left < 0 ? 'payment_overdue' : 'payment_due', title, body, link: `/revenue/sales?open=${d.sale_id}`, dedupe: stage,
      meta: { sale_id: d.sale_id, whatsapp: channels.includes('whatsapp') ? waLink(d.phone, msg) : null },
    });
    if (got.length) {
      count++;
      if (channels.includes('email') && d.email) mails.push([d.email, `Payment reminder — ${d.invoice_no}`, template({ title: left < 0 ? 'Payment overdue' : 'Payment reminder', greeting: `Dear ${d.name},`, lines: [msg.replace(/^Assalam-o-Alaikum [^,]+, /, '')] })]);
    }
    if (d.inst_id) await db.query('UPDATE sale_installments SET last_reminded_on=$1 WHERE id=$2', [todayStr, d.inst_id]);
  }
  return { reminders: count, mails };
}


async function recurringExpenseReminders(db, todayStr, nextDue) {
  const templates = (await db.query(`SELECT * FROM recurring_expenses WHERE status='approved' AND state='active' AND reminder_days BETWEEN 0 AND 30`)).rows;
  if (!templates.length) return { count: 0, mails: [], whatsapps: [] };
  const creatorIds = [...new Set(templates.map(t => Number(t.created_by)).filter(Boolean))];
  const targets = (await db.query(`
    SELECT DISTINCT u.id, u.email, u.phone1,
           (u.role IN ('super_admin','admin') OR p.level='edit') AS is_approver
      FROM users u LEFT JOIN permissions p ON p.user_id=u.id AND p.module='expense_approve'
     WHERE u.status='approved' AND (u.role IN ('super_admin','admin') OR p.level='edit' OR u.id = ANY($1::bigint[]))
  `, [creatorIds])).rows;
  if (!targets.length) return { count: 0, mails: [], whatsapps: [] };
  const mails = [];
  const whatsapps = [];
  let count = 0;
  for (const t of templates) {
    let dueDate = nextDue(t, currentMonth());
    if (!dueDate) continue;
    if (dueDate < todayStr) dueDate = nextDue(t, addMonths(currentMonth(), 1));
    if (!dueDate || daysBetween(dueDate, todayStr) !== Number(t.reminder_days)) continue;
    const channels = Array.isArray(t.reminder_channels) ? t.reminder_channels : ['app', 'email'];
    if (!channels.length) continue;
    // Only the template creator and actual expense approvers receive this reminder.
    const recipients = targets.filter(x => x.is_approver || Number(x.id) === Number(t.created_by));
    if (!recipients.length) continue;
    const claimed = await db.query(`INSERT INTO expense_reminder_sends(recurring_id,due_date,channels)
      VALUES ($1,$2,$3) ON CONFLICT (recurring_id,due_date) DO NOTHING RETURNING id`, [t.id, dueDate, channels]);
    if (!claimed.rowCount) continue;
    count++;
    const title = `Constant expense due in ${t.reminder_days} day(s): ${t.title}`;
    const body = `${t.ref_no} · ${pkr(t.amount)} · ${fmtDate(dueDate)} · ${t.paid_to}`;
    if (channels.includes('app')) {
      await notify(db, recipients.map(x => x.id), {
        kind: 'payment_due', title, body, link: '/expenses/constant?view=recurring',
        dedupe: `constant:${t.id}:${dueDate}`,
        meta: { recurring_id: t.id, due_date: dueDate, channels },
      });
    }
    if (channels.includes('email')) {
      const emails = [...new Set(recipients.map(x => x.email).filter(Boolean))];
      if (emails.length) mails.push([emails, `Expense reminder — ${t.title}`, template({
        title: 'Upcoming constant expense', greeting: 'Hello,',
        lines: [`${t.title} (${t.ref_no}) is due on ${fmtDate(dueDate)}.`, `Amount: ${pkr(t.amount)} · Payee: ${t.paid_to}.`, `Department: ${t.location || 'Not specified'}.`],
        action: { label: 'Open recurring expenses', url: `${config.appUrl}/expenses/constant?view=recurring` },
      })]);
    }
    if (channels.includes('whatsapp')) {
      for (const recipient of recipients) if (recipient.phone1) {
        whatsapps.push({ to: recipient.phone1, title: t.title, amount: pkr(t.amount), due: fmtDate(dueDate) });
      }
    }
  }
  return { count, mails, whatsapps };
}

async function sendWhatsAppTemplate({ to, title, amount, due }) {
  const w = config.whatsapp || {};
  if (!w.accessToken || !w.phoneNumberId || !w.graphVersion || !w.templateName) return { skipped: true };
  const phone = String(to).replace(/\D/g, '');
  if (!phone) return { skipped: true };
  const response = await fetch(`https://graph.facebook.com/${w.graphVersion}/${w.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${w.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: phone, type: 'template',
      template: { name: w.templateName, language: { code: w.languageCode || 'en' }, components: [{ type: 'body', parameters: [
        { type: 'text', text: String(title).slice(0, 80) },
        { type: 'text', text: String(amount).slice(0, 80) },
        { type: 'text', text: String(due).slice(0, 80) },
      ] }] },
    }),
  });
  if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return { sent: true };
}

/** Runs the daily job once per day (or always with force). Safe if two instances start together. */
export async function runDaily({ force = false } = {}) {
  const todayStr = today();
  // Imported lazily to avoid the route/job module cycle during application startup.
  const { ensureCycles, nextDue } = await import('../routes/expenses.js');
  const out = await tx(async db => {
    const lock = (await db.query('SELECT pg_try_advisory_xact_lock(7703) AS ok')).rows[0];
    if (!lock.ok) return { skipped: 'busy' };
    const last = (await db.query(`SELECT value->>'date' AS d FROM app_settings WHERE key='daily:last_run'`)).rows[0]?.d;
    if (!force && last === todayStr) return { skipped: 'already ran today' };
    const r = await reminders(db, todayStr);
    const er = await recurringExpenseReminders(db, todayStr, nextDue);
    await db.query(`DELETE FROM sessions WHERE last_activity < NOW() - INTERVAL '1 day'`);
    await db.query(`DELETE FROM password_resets WHERE created_at < NOW() - INTERVAL '7 days'`);
    await db.query(`DELETE FROM notifications WHERE is_read AND created_at < NOW() - INTERVAL '90 days'`);
    await db.query(`INSERT INTO app_settings(key,value,updated_at) VALUES ('daily:last_run',$1,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [JSON.stringify({ date: todayStr, reminders: r.reminders, constantExpenseReminders: er.count })]);
    return { ran: true, date: todayStr, reminders: r.reminders, constantExpenseReminders: er.count,
      mails: [...(r.mails || []), ...(er.mails || [])], whatsapps: er.whatsapps || [] };
  });
  for (const [to, subject, html] of out.mails || []) sendMail(to, subject, html);
  let whatsappSent = 0;
  for (const msg of out.whatsapps || []) {
    try { const result = await sendWhatsAppTemplate(msg); if (result.sent) whatsappSent++; }
    catch (e) { console.error('[whatsapp expense reminder]', e.message); }
  }
  if (out.ran) await ensureCycles([currentMonth()]).catch(e => console.error('[daily cycles]', e.message));
  const { mails: _m, whatsapps: _w, ...summary } = out;
  return { ...summary, emails: (out.mails || []).length, whatsapps: whatsappSent,
    whatsappConfigured: Boolean(config.whatsapp?.accessToken && config.whatsapp?.phoneNumberId && config.whatsapp?.graphVersion) };
}

let lastCheck = 0;
/** Cheap check used on normal requests: at most one DB look-up per instance every 10 minutes. */
export function runDailyIfDue() {
  if (Date.now() - lastCheck < 10 * 60 * 1000) return;
  lastCheck = Date.now();
  background(runDaily().catch(e => { lastCheck = 0; throw e; }));
}

