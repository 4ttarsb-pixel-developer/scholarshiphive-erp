'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { loadUser } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rate-limit');
const { errorHandler } = require('./middleware/error-handler');
const legacyRoutes = require('./routes/legacy-attendance.routes');
const apiRoutes = require('./routes/api.routes');

function corsOptions() {
  const localhost = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  return {
    origin(origin, cb) {
      if (!origin) return cb(null, true); // native mobile apps, curl, same-origin
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      if (config.corsAllowLocalhost && localhost.test(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Attendance-Session', 'Idempotency-Key'],
    maxAge: 600,
  };
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  const tp = String(config.trustProxy).toLowerCase();
  app.set('trust proxy', tp === 'true' ? true : tp === 'false' ? false : (/^\d+$/.test(tp) ? Number(tp) : tp));

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'connect-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }));
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter);
  app.use('/api', loadUser);
  app.use('/api', legacyRoutes);
  app.use('/api', apiRoutes);
  app.use('/api', (req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` }));

  // Attendance administration web (from the Flutter project), pointed at this server.
  app.get(['/attendance-admin', '/admin'], (_req, res, next) => {
    fs.readFile(config.attendanceAdminHtml, 'utf8', (err, html) => {
      if (err) return next();
      res.type('html').send(html.replace(/const API_BASE = [^;]+;/, 'const API_BASE = window.location.origin;'));
    });
  });

  if (config.serveFrontend && fs.existsSync(path.join(config.frontendDist, 'index.html'))) {
    app.use(express.static(config.frontendDist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.frontendDist, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('text').send('Workforce ERP API is running. Start the web dashboard with "npm run dev" in /frontend (http://localhost:5173), or build it with "npm run build".'));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
