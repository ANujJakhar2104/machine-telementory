const express = require('express');
const config = require('../config');
const telemetry = require('../services/telemetry');
const db = require('../db');
const { authenticate, authorize } = require('../middleware/auth');
const { HttpError } = require('../utils/http');

const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/public', require('./public'));

router.get('/health', (_req, res) => {
  db.get('SELECT 1 AS ok');
  res.json({ status: 'ok', uptime_s: Math.round(process.uptime()), time: new Date().toISOString() });
});

// Device ingestion endpoint (what an MQTT bridge or a PLC gateway would call). Authenticated by device key.
router.post('/telemetry', (req, res) => {
  if (req.get('x-device-key') !== config.deviceApiKey) throw new HttpError(401, 'Invalid device key');
  const messages = Array.isArray(req.body) ? req.body.slice(0, 500) : [req.body];
  const result = messages.reduce((acc, m) => {
    const r = telemetry.ingest(m);
    acc.accepted += r.accepted; acc.rejected += r.rejected; acc.errors.push(...r.errors);
    return acc;
  }, { accepted: 0, rejected: 0, errors: [] });
  res.status(202).json(result);
});

router.use(authenticate);
router.use('/machines', require('./machines'));
router.use('/alerts', require('./alerts'));
router.use('/tickets', require('./tickets'));
router.use('/rules', require('./rules'));
router.use('/reports', require('./reports'));
router.use('/users', require('./users'));
router.use('/admin', require('./admin'));

router.get('/dashboard', authorize('dashboard:view'), (_req, res) => {
  const since = Date.now() - 86400000;
  res.json({
    data: {
      machines: db.get('SELECT COUNT(*) AS n FROM machines').n,
      by_status: db.all('SELECT status, COUNT(*) AS n FROM machines GROUP BY status'),
      avg_health: db.get('SELECT ROUND(AVG(health_score), 1) AS v FROM machines WHERE status != \'OFFLINE\'').v,
      open_alerts: db.all("SELECT severity, COUNT(*) AS n FROM alerts WHERE status != 'RESOLVED' GROUP BY severity"),
      alerts_24h: db.get('SELECT COUNT(*) AS n FROM alerts WHERE raised_at > ?', since).n,
      open_tickets: db.get("SELECT COUNT(*) AS n FROM maintenance_tickets WHERE status IN ('OPEN','IN_PROGRESS')").n,
      readings_24h: db.get('SELECT COUNT(*) AS n FROM readings WHERE recorded_at > ?', since).n,
      alerts_by_hour: db.all(`SELECT (raised_at / 3600000) * 3600000 AS hour, severity, COUNT(*) AS n FROM alerts
        WHERE raised_at > ? GROUP BY hour, severity ORDER BY hour`, since),
    },
  });
});

router.use((_req, _res, next) => next(new HttpError(404, 'API route not found')));

module.exports = router;
