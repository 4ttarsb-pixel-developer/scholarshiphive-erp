'use strict';
const config = require('../config');
const { cleanIp } = require('./ip');

/** Client IP as the server sees it (honours TRUST_PROXY / TRUST_CLOUDFLARE_HEADER). */
function clientIp(req) {
  if (config.trustCloudflare && req.get('cf-connecting-ip')) return cleanIp(req.get('cf-connecting-ip'));
  return cleanIp(req.ip || req.socket?.remoteAddress || 'unknown');
}

/** Read a field accepting both PascalCase (ASP.NET) and camelCase (Worker) names. */
function pick(body, ...names) {
  for (const n of names) if (body && body[n] !== undefined && body[n] !== null) return body[n];
  return undefined;
}

module.exports = { clientIp, pick };
