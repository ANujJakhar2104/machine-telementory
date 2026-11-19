const express = require('express');
const db = require('../db');
const telemetry = require('../services/telemetry');
const { authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { validate, idParam, notFound, badRequest } = require('../utils/http');

const router = express.Router();

router.get('/', authorize('rules:view'), (req, res) => {
  const params = [];
  let w = '';
  if (req.query.machineId) { w = ' WHERE m.id = ?'; params.push(Number(req.query.machineId)); }
  const data = db.all(`SELECT r.*, s.type AS sensor_type, s.unit, m.id AS machine_id, m.machine_code
    FROM alert_rules r JOIN sensors s ON s.id = r.sensor_id JOIN machines m ON m.id = s.machine_id${w}
    ORDER BY m.machine_code, s.type, CASE r.severity WHEN 'INFO' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END`, ...params);
  res.json({ data });
});

router.patch('/:id', authorize('rules:edit'), (req, res) => {
  const id = idParam(req);
  const rule = db.get('SELECT * FROM alert_rules WHERE id = ?', id);
  if (!rule) throw notFound('Rule');
  const body = validate(req.body, {
    threshold: { type: 'number', min: -1000, max: 100000 },
    severity: { enum: ['INFO', 'WARNING', 'CRITICAL'] },
    consecutive: { type: 'int', min: 1, max: 20 },
    cooldown_s: { type: 'int', min: 0, max: 86400 },
    enabled: { type: 'bool' },
  }, { partial: true });
  if (!Object.keys(body).length) throw badRequest('Nothing to update');
  const n = { ...rule, ...body };
  db.run('UPDATE alert_rules SET threshold = ?, severity = ?, consecutive = ?, cooldown_s = ?, enabled = ? WHERE id = ?',
    n.threshold, n.severity, n.consecutive, n.cooldown_s, n.enabled ? 1 : 0, id);
  telemetry.invalidate();
  audit(req, 'UPDATE', 'alert_rules', id, { before: { threshold: rule.threshold, severity: rule.severity, enabled: rule.enabled }, after: body });
  res.json({ data: db.get('SELECT * FROM alert_rules WHERE id = ?', id) });
});

module.exports = router;
