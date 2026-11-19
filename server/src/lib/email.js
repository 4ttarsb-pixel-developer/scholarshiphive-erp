import nodemailer from 'nodemailer';
import { config, smtpConfigured } from '../config.js';
import { query, many } from '../db.js';

// On Vercel the function is frozen as soon as the response is sent; waitUntil lets the email finish first.
let waitUntil = () => {};
try { ({ waitUntil } = await import('@vercel/functions')); } catch { /* running locally */ }

let transporter;
function getTransport() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
  }
  return transporter;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Branded HTML email. `lines` are plain strings (escaped); `action` = {label,url}. */
export function template({ title, greeting, lines = [], action, footnote }) {
  const btn = action ? `<p style="margin:24px 0"><a href="${esc(action.url)}" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${esc(action.label)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#0b1733;padding:18px 24px;color:#fff;font-size:18px;font-weight:700">${esc(config.companyName)} <span style="font-weight:400;color:#93c5fd;font-size:13px">ERP</span></td></tr>
<tr><td style="padding:24px">
<h2 style="margin:0 0 12px;font-size:19px">${esc(title)}</h2>
${greeting ? `<p style="margin:0 0 12px">${esc(greeting)}</p>` : ''}
${lines.map(l => `<p style="margin:0 0 10px;line-height:1.55">${esc(l)}</p>`).join('')}
${btn}
${footnote ? `<p style="margin:16px 0 0;color:#64748b;font-size:12px">${esc(footnote)}</p>` : ''}
</td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px">This is an automatic email from ${esc(config.companyName)} ERP. © ${new Date().getFullYear()} All rights reserved by ${esc(config.companyName)}.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Sends in the background. Never throws — failures are logged in email_log. */
export function sendMail(to, subject, html) {
  const recipients = [...new Set((Array.isArray(to) ? to : [to]).filter(Boolean))];
  if (!recipients.length) return Promise.resolve();
  const job = (async () => {
    for (const addr of recipients) {
      if (!smtpConfigured()) {
        await query('INSERT INTO email_log(to_email,subject,status,error) VALUES ($1,$2,$3,$4)', [addr, subject.slice(0, 255), 'skipped', 'SMTP not configured in .env']).catch(() => {});
        continue;
      }
      try {
        await getTransport().sendMail({ from: config.smtp.from || `${config.companyName} ERP <${config.smtp.user}>`, to: addr, subject, html });
        await query('INSERT INTO email_log(to_email,subject,status) VALUES ($1,$2,$3)', [addr, subject.slice(0, 255), 'sent']).catch(() => {});
      } catch (e) {
        console.error('[email] failed to', addr, e.message);
        await query('INSERT INTO email_log(to_email,subject,status,error) VALUES ($1,$2,$3,$4)', [addr, subject.slice(0, 255), 'failed', String(e.message).slice(0, 500)]).catch(() => {});
      }
    }
  })();
  job.catch(() => {});
  try { waitUntil(job); } catch { /* ignore */ }
  return job;
}

export async function verifySmtp() {
  if (!smtpConfigured()) return { ok: false, error: 'SMTP_USER / SMTP_PASS are not set in .env' };
  try { await getTransport().verify(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

export async function adminEmails() {
  return (await many(`SELECT email FROM users WHERE role IN ('super_admin','admin') AND status='approved'`)).map(r => r.email);
}

/** Email users who are admin or have the given module permission. */
export async function moduleEmails(module, level = 'edit') {
  const rows = await many(
    `SELECT DISTINCT u.email FROM users u LEFT JOIN permissions p ON p.user_id=u.id AND p.module=$1
      WHERE u.status='approved' AND (u.role IN ('super_admin','admin') OR (p.level IS NOT NULL AND ($2='view' OR p.level='edit')))`, [module, level]);
  return rows.map(r => r.email);
}

export const link = p => `${config.appUrl}${p}`;
