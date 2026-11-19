class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
function requireDemoMutation(req, res, next) {
  // Under ScholarshipHive SSO, view-only Expenses access is never sufficient to write.
  if (req.erpUser) {
    const admin = ['admin', 'super_admin'].includes(String(req.erpUser.role || '').toLowerCase());
    if (!admin && req.erpUser.perms?.marketing !== 'edit') {
      return res.status(403).json({ success: false, message: 'Marketing Analyzer edit permission is required for this action.' });
    }
  }
  // Writes are blocked in production until the durable PostgreSQL driver is active.
  const isPg = (process.env.PERSISTENCE_DRIVER || 'memory').toLowerCase() === 'postgres';
  if (process.env.NODE_ENV === 'production' && !isPg) {
    return res.status(503).json({ success: false, message: 'Writes disabled until authentication and PostgreSQL integration are configured.' });
  }
  next();
}
const requiredText = (v, label, max = 120) => {
  if (typeof v !== 'string' || v.trim().length < 2 || v.trim().length > max) {
    throw new HttpError(400, `${label} must be between 2 and ${max} characters`);
  }
  return v.trim();
};
function validAmount(v, label='Amount') {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) {
    throw new HttpError(400, `${label} must be a positive number with at most 2 decimal places`);
  }
  return v;
}
function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)) || new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)!==v) {
    throw new HttpError(400, 'Date must be valid YYYY-MM-DD');
  }
  return v;
}
module.exports = { HttpError, wrap, requireDemoMutation, requiredText, validAmount, validDate };
