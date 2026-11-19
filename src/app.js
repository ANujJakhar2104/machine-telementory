const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const logger = require('./utils/logger');
const openapi = require('./docs/openapi');
const { HttpError } = require('./utils/http');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Allowed-origins list for cross-site API callers (same-origin requests need no CORS).
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && config.corsOrigins.includes(origin)) {
      res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE' });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  if (!config.isTest) {
    app.use((req, res, next) => {
      const t0 = Date.now();
      res.on('finish', () => {
        if (req.originalUrl.startsWith('/api/')) logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t0}ms`);
      });
      next();
    });
  }

  app.use('/api/', rateLimit({ windowMs: 60 * 1000, limit: config.isTest ? 100000 : 600, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api/v1', require('./routes'));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found')));

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'SM Telemetry API Docs' }));
  app.get('/api-docs.json', (_req, res) => res.json(openapi));

  // chart.js's "exports" map hides dist/chart.umd.js, so locate it next to the package's CommonJS entry.
  const chartUmd = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js');
  app.get('/vendor/chart.umd.js', (_req, res) => res.sendFile(chartUmd, { maxAge: '7d' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '1h' : 0, index: 'index.html' }));

  // Central error handler: consistent JSON shape, no stack traces leaked to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Malformed JSON body');
    const status = err.status || err.statusCode || 500;
    if (status >= 500) logger.error(`${req.method} ${req.originalUrl}: ${err.stack || err.message}`);
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message, ...(err.details ? { details: err.details } : {}) });
  });

  return app;
}

module.exports = { createApp };
