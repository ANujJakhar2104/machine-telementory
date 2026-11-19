const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const { matrix, ROLES } = require('../rbac');
const { validate, EMAIL } = require('../utils/http');

const router = express.Router();

router.get('/notices', (_req, res) => {
  res.json({ data: db.all('SELECT id, title, body, published_at FROM notices ORDER BY published_at DESC LIMIT 20') });
});

// Aggregate, non-sensitive figures for the public home page.
router.get('/stats', (_req, res) => {
  res.json({
    data: {
      machines: db.get('SELECT COUNT(*) AS n FROM machines').n,
      running: db.get("SELECT COUNT(*) AS n FROM machines WHERE status = 'RUNNING'").n,
      readings_24h: db.get('SELECT COUNT(*) AS n FROM readings WHERE recorded_at > ?', Date.now() - 86400000).n,
      alerts_24h: db.get('SELECT COUNT(*) AS n FROM alerts WHERE raised_at > ?', Date.now() - 86400000).n,
      tickets_resolved: db.get("SELECT COUNT(*) AS n FROM maintenance_tickets WHERE status IN ('RESOLVED','CLOSED')").n,
      visitors: db.get("SELECT value FROM site_counters WHERE key = 'visitors'")?.value || 0,
      demo: config.seedDemoUsers,
    },
  });
});

router.post('/visit', (_req, res) => {
  db.run("INSERT INTO site_counters (key, value) VALUES ('visitors', 1) ON CONFLICT(key) DO UPDATE SET value = value + 1");
  res.json({ visitors: db.get("SELECT value FROM site_counters WHERE key = 'visitors'").value });
});

router.get('/rbac', (_req, res) => res.json({ data: { roles: ROLES, permissions: matrix() } }));

const feedbackLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: config.isTest ? 1000 : 5, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' } });

router.post('/feedback', feedbackLimiter, (req, res) => {
  const body = validate(req.body, {
    name: { required: true, maxLen: 80, minLen: 2 },
    email: { required: true, maxLen: 120, pattern: EMAIL, patternMsg: 'Enter a valid email address' },
    category: { required: true, enum: ['Feedback', 'Grievance', 'Suggestion', 'Technical Issue'] },
    message: { required: true, maxLen: 2000, minLen: 10 },
  });
  const r = db.run('INSERT INTO feedback (name, email, category, message, created_at) VALUES (?,?,?,?,?)',
    body.name, body.email, body.category, body.message, Date.now());
  res.status(201).json({ ok: true, reference: `SMF-${String(r.id).padStart(5, '0')}` });
});

module.exports = router;
