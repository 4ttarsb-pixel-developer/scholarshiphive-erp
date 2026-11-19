export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}
export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'Not approved by admin', extra) => new HttpError(403, msg, { code: 'NOT_APPROVED', ...extra });
export const notFound = (msg = 'Record not found') => new HttpError(404, msg);

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, req, res, _next) {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large (maximum 5 MB).' });
  if (err?.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: `Unexpected file field "${err.field}".` });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  // PostgreSQL constraint errors → readable messages
  if (err?.code === '23505') {
    const d = String(err.detail || err.constraint || '');
    const field = (d.match(/\(([^)]+)\)=/) || [])[1] || 'value';
    return res.status(409).json({ error: `This ${field.replace(/_/g, ' ')} is already registered.` });
  }
  if (err?.code === '23503') return res.status(409).json({ error: 'This record is linked to other records and cannot be changed/deleted.' });
  if (err?.code === '23514' || err?.code === '22P02' || err?.code === '22007' || err?.code === '22008') {
    return res.status(400).json({ error: 'One of the values is not valid. Please check the form.' });
  }
  if (err instanceof HttpError) {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    if (err.fields) body.fields = err.fields;
    return res.status(err.status).json(body);
  }
  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
}
