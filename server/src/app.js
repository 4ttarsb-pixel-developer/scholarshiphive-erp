import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ROOT_DIR, config } from './config.js';
import { errorHandler } from './lib/http.js';
import { sessionLoader, csrfGuard } from './middleware/auth.js';
import marketingApi from '../../marketing-backend/src/router.js';
import authRoutes from './routes/auth.js';
import userRoutes, { files, requests, admin } from './routes/users.js';
import owner from './routes/owner.js';
import formRoutes, { security } from './routes/forms.js';
import revenueRoutes from './routes/revenue.js';
import salaryRoutes from './routes/salary.js';
import expenseRoutes, { petty } from './routes/expenses.js';
import liabilityRoutes from './routes/liabilities.js';
import { assets, capital, cashflow, finance } from './routes/finance.js';
import { cashtools, myBudget } from './routes/cashflow.js';
import announcementRoutes, { dashboard } from './routes/announcements.js';
import exportRoutes from './routes/exports.js';
import notificationRoutes, { cron, clientErrors } from './routes/notifications.js';
import { query } from './db.js';
import workforce from '../workforce/index.cjs';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Trust only the configured reverse-proxy hop(s). Avoid trusting arbitrary forwarded headers.
  const proxySetting = String(config.trustProxy).toLowerCase();
  app.set('trust proxy', proxySetting === 'true' ? true : proxySetting === 'false' ? false : (/^\d+$/.test(proxySetting) ? Number(proxySetting) : proxySetting));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com', 'https://flagcdn.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'script-src': ["'self'"],
        'connect-src': ["'self'"],
        'frame-src': ["'self'"],
        'object-src': ["'self'"],
        'form-action': ["'self'", 'https://accounts.google.com'],
        'upgrade-insecure-requests': config.appUrl.startsWith('https://') ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.appUrl.startsWith('https://'),
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // ── API ──
  const api = express.Router();
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.use(sessionLoader);
  api.use(csrfGuard);
  api.get('/health', async (_req, res) => {
    try { await query('SELECT 1'); res.json({ ok: true, database: 'connected' }); } catch (e) { res.status(500).json({ ok: false, database: e.message }); }
  });
  api.use('/auth', authRoutes);
  // Same-origin Marketing Analyzer: shared ERP session, same server and same DATABASE_URL.
  api.use('/v1', (req, _res, next) => { req.erpUser = req.user || null; next(); }, marketingApi);
  api.use('/users', userRoutes);
  api.use('/files', files);
  api.use('/requests', requests);
  api.use('/admin', admin);
  api.use('/owner', owner);
  api.use('/dashboard', dashboard);
  api.use('/revenue', revenueRoutes);
  api.use('/salary', salaryRoutes);
  api.use('/workforce', workforce.createWorkforceRouter());
  api.use('/expenses', expenseRoutes);
  api.use('/petty', petty);
  api.use('/liabilities', liabilityRoutes);
  api.use('/assets', assets);
  api.use('/capital', capital);
  api.use('/cashflow', cashflow);
  api.use('/cashflow', cashtools);
  api.use('/budgets', myBudget);
  api.use('/finance', finance);
  api.use('/forms', formRoutes);
  api.use('/security', security);
  api.use('/announcements', announcementRoutes);
  api.use('/export', exportRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/cron', cron);
  api.use('/client-errors', clientErrors);
  api.use((req, res) => res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` }));
  api.use(errorHandler);
  app.use('/api', api);

  // Preserve the bundled Workforce / Flutter attendance administration page.
  // Its API calls use the same origin and the unified /api/workforce endpoints.
  app.get(['/attendance-admin', '/attendance-admin/'], (req, res, next) => {
    const attendanceAdmin = path.join(ROOT_DIR, 'server', 'workforce', 'attendance_flutter', 'admin_site', 'index.html');
    res.setHeader('Cache-Control', 'no-store');
    // This trusted local admin page still contains inline scripts/styles. Keep
    // its CSP scoped to this route rather than weakening the ERP SPA policy.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'");
    res.sendFile(attendanceAdmin, (error) => { if (error && !res.headersSent) next(error); });
  });

  // ── Front-end (built React app) ──
  const dist = path.join(ROOT_DIR, 'client', 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '7d', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });
  } else {
    app.get('*', (_req, res) => res.status(200).type('html').send(
      `<h2 style="font-family:sans-serif">ScholarshipHive ERP API is running.</h2><p style="font-family:sans-serif">The website is not built yet. Run <code>npm run build</code> and restart, or use <code>npm run dev</code> and open http://localhost:5173.</p>`));
  }
  app.use(errorHandler);
  return app;
}
