'use strict';
const path = require('path');
const config = {
  env: process.env.NODE_ENV || 'development',
  isTest: (process.env.NODE_ENV || '') === 'test',
  // Used only by the stand-alone Workforce server (src/server.js); the ERP host uses its own PORT handling.
  port: Number(process.env.PORT) || 4000,
  serveFrontend: String(process.env.SERVE_FRONTEND || 'false').toLowerCase() === 'true',
  frontendDist: path.resolve(__dirname, '..', '..', '..', 'client', 'dist'),
  attendanceAdminHtml: path.resolve(__dirname, '..', 'attendance_flutter', 'admin_site', 'index.html'),
  isProd: (process.env.NODE_ENV || 'development') === 'production' || !!process.env.VERCEL,
  databaseUrl: process.env.DATABASE_URL || '',
  businessTimezone: process.env.BUSINESS_TIMEZONE || 'Asia/Karachi',
  trustProxy: process.env.TRUST_PROXY || '1',
  trustCloudflare: String(process.env.TRUST_CLOUDFLARE_HEADER || 'false').toLowerCase() === 'true',
  webSessionHours: Number(process.env.WORKFORCE_WEB_SESSION_HOURS || 12),
  mobileSessionDays: Number(process.env.WORKFORCE_MOBILE_SESSION_DAYS || 30),
  checkoutRequiresNetworkRule: String(process.env.CHECKOUT_REQUIRES_NETWORK_RULE || 'true').toLowerCase() === 'true',
  loginRateLimitPerMinute: Number(process.env.WORKFORCE_LOGIN_RATE_LIMIT_PER_MINUTE || 20),
  apiRateLimitPerMinute: Number(process.env.WORKFORCE_API_RATE_LIMIT_PER_MINUTE || 600),
  corsOrigins: String(process.env.CORS_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean),
  corsAllowLocalhost: true,
};
module.exports = config;
