const express = require('express');
const db = require('../db');
const telemetry = require('../services/telemetry');
const simulator = require('../services/simulator');
const { authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { validate, idParam, notFound, paging } = require('../utils/http');

const router = express.Router();

router.get('/audit-logs', authorize('audit:view'), (req, res) => {
  const { limit, offset, page } = paging(req.query);
  const params = [];
  let w = '';
  if (req.query.action) { w = ' WHERE l.action = ?'; params.push(String(req.query.action)); }
  const total = db.get(`SELECT COUNT(*) AS n FROM audit_logs l${w}`, ...params).n;
  const data = db.all(`SELECT l.*, u.name AS user_name, u.role AS user_role FROM audit_logs l
    LEFT JOIN users u ON u.id = l.user_id${w} ORDER BY l.changed_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data, page, limit, total });
});

router.get('/notifications', authorize('audit:view'), (req, res) => {
  const { limit, offset } = paging(req.query);
  res.json({ data: db.all('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ? OFFSET ?', limit, offset) });
});

router.get('/feedback', authorize('feedback:view'), (_req, res) => {
  res.json({ data: db.all('SELECT * FROM feedback ORDER BY created_at DESC LIMIT 500') });
});

router.patch('/feedback/:id', authorize('feedback:view'), (req, res) => {
  const id = idParam(req);
  if (!db.get('SELECT id FROM feedback WHERE id = ?', id)) throw notFound('Feedback');
  db.run("UPDATE feedback SET status = 'REVIEWED' WHERE id = ?", id);
  audit(req, 'REVIEW', 'feedback', id);
  res.json({ ok: true });
});

router.post('/notices', authorize('notices:manage'), (req, res) => {
  const body = validate(req.body, { title: { required: true, maxLen: 200, minLen: 5 }, body: { maxLen: 2000 } });
  const r = db.run('INSERT INTO notices (title, body, published_at) VALUES (?,?,?)', body.title, body.body, Date.now());
  audit(req, 'CREATE', 'notices', r.id, { title: body.title });
  res.status(201).json({ data: db.get('SELECT * FROM notices WHERE id = ?', r.id) });
});

router.delete('/notices/:id', authorize('notices:manage'), (req, res) => {
  const id = idParam(req);
  if (!db.run('DELETE FROM notices WHERE id = ?', id).changes) throw notFound('Notice');
  audit(req, 'DELETE', 'notices', id);
  res.json({ ok: true });
});

router.get('/system', authorize('audit:view'), (_req, res) => {
  res.json({
    data: {
      ingestion: telemetry.counters,
      active_faults: simulator.status(),
      rows: {
        readings: db.get('SELECT COUNT(*) AS n FROM readings').n,
        readings_hourly: db.get('SELECT COUNT(*) AS n FROM readings_hourly').n,
        alerts: db.get('SELECT COUNT(*) AS n FROM alerts').n,
        audit_logs: db.get('SELECT COUNT(*) AS n FROM audit_logs').n,
      },
      uptime_s: Math.round(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version,
    },
  });
});

module.exports = router;
