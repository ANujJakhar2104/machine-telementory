const express = require('express');
const db = require('../db');
const telemetry = require('../services/telemetry');
const simulator = require('../services/simulator');
const { createSensorWithRules, SENSOR_TYPES } = require('../db/seed');
const { authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { validate, idParam, notFound, badRequest, HttpError } = require('../utils/http');

const router = express.Router();
const STATUSES = ['RUNNING', 'IDLE', 'MAINTENANCE', 'OFFLINE'];

const machineSpec = {
  machine_code: { required: true, maxLen: 20, pattern: /^[A-Z0-9-]{2,20}$/, patternMsg: 'machine_code must be 2–20 characters: A–Z, 0–9 or "-"' },
  name: { required: true, maxLen: 80 },
  type: { required: true, maxLen: 40 },
  location: { required: true, maxLen: 80 },
  status: { enum: STATUSES },
};

function withLive(m) {
  const openAlerts = db.get("SELECT COUNT(*) AS n FROM alerts WHERE machine_id = ? AND status != 'RESOLVED'", m.id).n;
  return { ...m, open_alerts: openAlerts, latest: telemetry.latestFor(m.id) };
}

router.get('/', authorize('machines:view'), (_req, res) => {
  const rows = db.all('SELECT * FROM machines ORDER BY machine_code');
  res.json({ data: rows.map(withLive) });
});

router.get('/:id', authorize('machines:view'), (req, res) => {
  const m = db.get('SELECT * FROM machines WHERE id = ?', idParam(req));
  if (!m) throw notFound('Machine');
  const sensors = db.all('SELECT * FROM sensors WHERE machine_id = ? ORDER BY id', m.id);
  res.json({ data: { ...withLive(m), sensors } });
});

router.get('/:id/health', authorize('machines:view'), (req, res) => {
  const id = idParam(req);
  const m = db.get('SELECT id, machine_code, health_score, status FROM machines WHERE id = ?', id);
  if (!m) throw notFound('Machine');
  const breakdown = db.all(`SELECT severity, status, COUNT(*) AS n FROM alerts
    WHERE machine_id = ? AND status != 'RESOLVED' AND raised_at > ? GROUP BY severity, status`, id, Date.now() - 86400000);
  const band = m.health_score >= 80 ? 'GOOD' : m.health_score >= 60 ? 'FAIR' : m.health_score >= 40 ? 'POOR' : 'CRITICAL';
  res.json({ data: { ...m, band, open_alert_breakdown: breakdown } });
});

router.get('/:id/latest', authorize('telemetry:view'), (req, res) => {
  const id = idParam(req);
  const latest = telemetry.latestFor(id);
  if (!latest) throw notFound('Machine');
  res.json({ data: latest });
});

// History: raw readings for windows up to 6 h, hourly summary beyond that.
router.get('/:id/readings', authorize('telemetry:view'), (req, res) => {
  const id = idParam(req);
  if (!db.get('SELECT id FROM machines WHERE id = ?', id)) throw notFound('Machine');
  const minutes = Math.min(Math.max(Number(req.query.minutes) || 30, 1), 7 * 24 * 60);
  const from = Date.now() - minutes * 60000;
  const sensorType = req.query.sensor;
  const sensors = db.all('SELECT * FROM sensors WHERE machine_id = ?', id).filter((s) => !sensorType || s.type === sensorType);
  const resolution = minutes <= 360 ? 'raw' : 'hourly';
  const series = sensors.map((s) => {
    const points = resolution === 'raw'
      ? db.all('SELECT recorded_at AS t, value AS v FROM readings WHERE sensor_id = ? AND recorded_at >= ? ORDER BY recorded_at', s.id, from)
      : db.all('SELECT hour_start AS t, avg_val AS v, min_val AS lo, max_val AS hi FROM readings_hourly WHERE sensor_id = ? AND hour_start >= ? ORDER BY hour_start', s.id, from);
    return { sensor_id: s.id, type: s.type, unit: s.unit, min_val: s.min_val, max_val: s.max_val, points };
  });
  res.json({ data: { resolution, from, series } });
});

router.post('/', authorize('machines:manage'), (req, res) => {
  const body = validate(req.body, machineSpec);
  if (db.get('SELECT id FROM machines WHERE machine_code = ?', body.machine_code)) throw new HttpError(409, 'A machine with this code already exists');
  const id = db.transaction(() => {
    const r = db.run('INSERT INTO machines (machine_code, name, type, location, status, created_at) VALUES (?,?,?,?,?,?)',
      body.machine_code, body.name, body.type, body.location, body.status || 'RUNNING', Date.now());
    for (const s of SENSOR_TYPES) createSensorWithRules(r.id, s);
    return r.id;
  });
  telemetry.invalidate();
  audit(req, 'CREATE', 'machines', id, body);
  res.status(201).json({ data: db.get('SELECT * FROM machines WHERE id = ?', id) });
});

router.patch('/:id', authorize('machines:manage'), (req, res) => {
  const id = idParam(req);
  const m = db.get('SELECT * FROM machines WHERE id = ?', id);
  if (!m) throw notFound('Machine');
  const body = validate(req.body, machineSpec, { partial: true });
  if (!Object.keys(body).length) throw badRequest('Nothing to update');
  if (body.machine_code && body.machine_code !== m.machine_code && db.get('SELECT id FROM machines WHERE machine_code = ?', body.machine_code)) {
    throw new HttpError(409, 'A machine with this code already exists');
  }
  const next = { ...m, ...body };
  db.run('UPDATE machines SET machine_code = ?, name = ?, type = ?, location = ?, status = ? WHERE id = ?',
    next.machine_code, next.name, next.type, next.location, next.status, id);
  telemetry.invalidate();
  audit(req, 'UPDATE', 'machines', id, body);
  res.json({ data: db.get('SELECT * FROM machines WHERE id = ?', id) });
});

router.delete('/:id', authorize('machines:manage'), (req, res) => {
  const id = idParam(req);
  const m = db.get('SELECT * FROM machines WHERE id = ?', id);
  if (!m) throw notFound('Machine');
  db.run('DELETE FROM machines WHERE id = ?', id);
  telemetry.invalidate();
  audit(req, 'DELETE', 'machines', id, { machine_code: m.machine_code });
  res.json({ ok: true });
});

router.post('/:id/simulate-fault', authorize('simulator:control'), (req, res) => {
  const id = idParam(req);
  const m = db.get('SELECT * FROM machines WHERE id = ?', id);
  if (!m) throw notFound('Machine');
  if (!['RUNNING', 'IDLE'].includes(m.status)) throw badRequest('Machine must be RUNNING or IDLE to simulate a fault');
  const fault = simulator.injectFault(id, req.body?.sensor);
  audit(req, 'SIMULATE_FAULT', 'machines', id, { sensor: fault.sensor });
  res.json({ data: fault });
});

module.exports = router;
