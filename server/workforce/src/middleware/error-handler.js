'use strict';
const { HttpError } = require('../utils/errors');
const config = require('../config');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message, details: err.details });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON body.' });
  }
  // PostgreSQL errors -> safe client messages
  if (err && err.code === 'P0001') return res.status(409).json({ success: false, message: err.message });
  if (err && err.code === '23505') return res.status(409).json({ success: false, message: 'Duplicate record: this entry already exists.' });
  if (err && err.code === '23514') return res.status(400).json({ success: false, message: 'Value rejected by a database rule (check amounts, dates and percentages).' });
  if (err && err.code === '23503') return res.status(409).json({ success: false, message: 'Related record is missing or still in use.' });
  if (err && err.code === '22P02') return res.status(400).json({ success: false, message: 'Invalid value format.' });
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  return res.status(500).json({ success: false, message: config.isProd ? 'Internal server error.' : (err && err.message) || 'Internal server error.' });
}

module.exports = { errorHandler };
