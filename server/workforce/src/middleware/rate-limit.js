'use strict';
const rateLimit = require('express-rate-limit');
const config = require('../config');

const json = (message) => ({ success: false, message });

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isTest ? 10000 : config.loginRateLimitPerMinute,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many sign-in attempts. Please wait a minute and try again.'),
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.isTest ? 100000 : config.apiRateLimitPerMinute,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many requests. Please slow down.'),
});

module.exports = { loginLimiter, apiLimiter };
