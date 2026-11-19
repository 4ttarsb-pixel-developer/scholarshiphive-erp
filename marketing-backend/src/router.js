// Mountable Marketing Expense Analyzer API. The ERP Express app mounts this
// router at /api/v1 so it shares the ERP host, cookies, database and session.
const express = require('express');
const { HttpError, wrap } = require('./utils/http');
const dashboard = require('./services/dashboard.service');
const budgetService = require('./services/budget.service');
const { requireAuth, adminOnly } = require('./middleware/auth');
const IS_PG = (process.env.PERSISTENCE_DRIVER || 'postgres').toLowerCase() === 'postgres';
const router = express.Router();

router.get('/health', wrap(async (_req, res) => {
  const base = { success: true, message: 'ScholarshipHive Marketing Analyzer API is running' };
  if (!IS_PG) return res.status(503).json({ ...base, database: 'not-connected', db_connected: false, mode: 'memory-disabled' });
  try {
    const ok = await require('./db/pool').healthCheck();
    return res.json({ ...base, database: ok ? 'connected' : 'error', db_connected: !!ok, mode: 'postgres' });
  } catch {
    return res.status(503).json({ success: false, message: 'Database unavailable', database: 'error', db_connected: false, mode: 'postgres' });
  }
}));

// No Marketing-specific login endpoint is mounted. The middleware maps the
// authenticated ScholarshipHive user to a stable Marketing profile by email.
router.use(requireAuth);
router.use('/categories', require('./routes/category.routes'));
router.use('/expenses', require('./routes/expense.routes'));
router.use('/budgets', require('./routes/budget.routes'));
router.use('/audit', require('./routes/audit.routes'));
router.get('/users', adminOnly, wrap(async (_req, res) => {
  const repo = require('./repositories');
  res.json({ success: true, data: await repo.users.list() });
}));
router.use('/ad-accounts', require('./routes/ad-account.routes'));
router.use('/ad-integrations', require('./routes/ad-integration.routes'));
router.use('/fx', require('./routes/fx.routes'));
router.use('/attribution', require('./routes/attribution.routes'));
router.get('/dashboard/summary', wrap(async (req, res) => res.json({ success: true, data: await dashboard.summaryForUser(req.user, req.query.month || budgetService.currentMonth(), req.query) })));
router.get('/reports/overview', adminOnly, wrap(async (req, res) => res.json({ success: true, data: await dashboard.report(req.query) })));
router.use((req, res) => res.status(404).json({ success: false, message: 'Marketing API route not found' }));
router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Upload exceeds the Marketing document limit' });
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return res.status(400).json({ success: false, message: 'Invalid JSON body' });
  if (IS_PG && ['P0001', '23505', '23503', '23514', '23P01'].includes(err.code)) return res.status(409).json({ success: false, message: err.code === 'P0001' ? err.message : 'Database constraint prevents this operation' });
  if (!(err instanceof HttpError)) console.error('[MEA] Unexpected API error:', err);
  return res.status(err.status || 500).json({ success: false, message: err instanceof HttpError ? err.message : 'Internal server error' });
});
module.exports = router;
