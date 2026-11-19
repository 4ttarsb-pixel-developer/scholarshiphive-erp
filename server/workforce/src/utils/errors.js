'use strict';
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const badRequest = (m, d) => new HttpError(400, m, d);
const unauthorized = (m = 'Authentication required.') => new HttpError(401, m);
const forbidden = (m = 'You do not have permission to perform this action.') => new HttpError(403, m);
const notFound = (m = 'Not found.') => new HttpError(404, m);
const conflict = (m, d) => new HttpError(409, m, d);

/** Wrap async route handlers so rejections reach the error middleware. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, ah };
