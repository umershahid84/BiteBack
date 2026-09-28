const path = require('node:path');
const express = require('express');
const { createSessionStore } = require('./auth');
const { createOrderService } = require('./orders');
const { HttpError } = require('./errors');

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://js.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "connect-src 'self' https://api.stripe.com",
  "img-src 'self' data: https://*.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function createApp({ db, config, payments }) {
  const app = express();
  const sessions = createSessionStore(db, config);
  const orders = createOrderService({ db, config, payments });
  const deps = { db, config, payments, sessions, orders };

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), payment=(self)');
    next();
  });

  app.use('/api', express.json({ limit: '50kb' }));
  // CSRF protection: state-changing API calls must carry a custom header, which browsers
  // only allow from same-origin scripts.
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'BiteBack') {
      return next(new HttpError(403, 'Request blocked.'));
    }
    next();
  });
  app.use('/api', sessions.middleware);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api/auth', require('./routes/auth')(deps));
  app.use('/api/restaurant', require('./routes/restaurant')(deps));
  app.use('/api', require('./routes/customer')(deps));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 && !(err instanceof HttpError) ? 'Something went wrong. Please try again.' : err.message;
    res.status(status).json({ error: message });
  });

  return { app, orders };
}

module.exports = { createApp };
