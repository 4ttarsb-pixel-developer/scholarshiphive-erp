// Central configuration — every value comes from the project-root .env file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..', '..');
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });
// The merged ERP must never silently fall back to in-memory Marketing persistence.
if (!process.env.PERSISTENCE_DRIVER) process.env.PERSISTENCE_DRIVER = 'postgres';
// All dates/months are calculated in Pakistan time unless TZ is set in .env.
if (!process.env.TZ) process.env.TZ = 'Asia/Karachi';

const env = (k, d = '') => { const x = process.env[k]; return (x === undefined || String(x).trim() === '' ? d : x).toString().trim(); };
const bool = (k, d = false) => { const v = env(k, d ? 'true' : 'false').toLowerCase(); return v === 'true' || v === '1' || v === 'yes'; };

// APP_URL falls back to the host's public domain if you did not set it:
// Railway provides RAILWAY_PUBLIC_DOMAIN, Vercel provides VERCEL_PROJECT_PRODUCTION_URL.
const hostDomain = env('RAILWAY_PUBLIC_DOMAIN') || env('VERCEL_PROJECT_PRODUCTION_URL');
const appUrl = env('APP_URL', hostDomain ? `https://${hostDomain}` : 'http://localhost:4000').replace(/\/+$/, '');
export const onVercel = Boolean(process.env.VERCEL);

export const config = {
  env: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV') === 'production' || Boolean(process.env.VERCEL),
  port: Number(env('PORT', '4000')) || 4000,
  appUrl,
  databaseUrl: env('DATABASE_URL'),
  databaseSsl: bool('DATABASE_SSL', false),
  cookieSecret: env('COOKIE_SECRET'),
  trustProxy: env('TRUST_PROXY', '1'),
  sessionIdleMinutes: Math.max(1, Number(env('SESSION_IDLE_MINUTES', '30')) || 30),
  maxAdmins: Math.max(1, Number(env('MAX_ADMINS', '3')) || 3),
  uploadDir: path.resolve(ROOT_DIR, env('UPLOAD_DIR', 'uploads')),
  google: {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
    redirectUri: env('GOOGLE_REDIRECT_URI', `${appUrl}/api/auth/google/callback`),
    devBypass: bool('GOOGLE_DEV_BYPASS', false) && env('NODE_ENV') !== 'production' && !process.env.VERCEL,
  },
  smtp: {
    host: env('SMTP_HOST', 'smtp.gmail.com'),
    port: Number(env('SMTP_PORT', '465')) || 465,
    user: env('SMTP_USER'),
    pass: env('SMTP_PASS').replace(/\s+/g, ''), // Gmail app passwords are shown with spaces
    from: env('MAIL_FROM'),
  },
  companyName: env('COMPANY_NAME', 'ScholarshipHive'),
  whatsapp: {
    accessToken: env('WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: env('WHATSAPP_PHONE_NUMBER_ID'),
    graphVersion: env('WHATSAPP_GRAPH_VERSION'),
    templateName: env('WHATSAPP_TEMPLATE_NAME', 'expense_payment_reminder'),
    languageCode: env('WHATSAPP_LANGUAGE_CODE', 'en'),
  },
};

export function googleConfigured() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}
export function smtpConfigured() {
  return Boolean(config.smtp.user && config.smtp.pass);
}

export function assertConfig() {
  const problems = [];
  if (!config.databaseUrl) problems.push('DATABASE_URL is missing in .env');
  if (!config.cookieSecret || config.cookieSecret.length < 32) problems.push('COOKIE_SECRET must be at least 32 characters (run: npm run secret)');
  if (problems.length) {
    const err = new Error('Configuration problem:\n  - ' + problems.join('\n  - ') + '\nSee SETUP_GUIDE.md and .env.example');
    err.code = 'CONFIG';
    throw err;
  }
  // Not fatal: existing users can still log in with their password. First-time setup and new
  // registrations need Google verification, and stay unavailable until these are added.
  if (config.isProd && !googleConfigured()) {
    console.warn('\n⚠ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set. Password login works, but first-time setup and new registrations need Google sign-in. Add them in your host variables.\n');
  }
  if (config.isProd && !config.appUrl.startsWith('https://')) {
    console.warn(`⚠ APP_URL is ${config.appUrl}. In production set APP_URL to your public https:// address (Google sign-in and secure cookies depend on it).`);
  }
}
