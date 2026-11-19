const express = require('express');
const db = require('../db');
const realtime = require('../services/realtime');
const { authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { validate, idParam, notFound, badRequest, paging } = require('../utils/http');

const router = express.Router();

const SELECT = `SELECT a.*, m.machine_code, m.name AS machine_name, s.type AS sensor_type, s.unit, u.name AS acknowledged_by_name
  FROM alerts a JOIN machines m ON m.id = a.machine_id
  LEFT JOIN sensors s ON s.id = a.sensor_id LEFT JOIN users u ON u.id = a.acknowledged_by`;

router.get('/', authorize('alerts:view'), (req, res) => {
  const { limit, offset, page } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.status) { where.push('a.status = ?'); params.push(String(req.query.status)); }
  if (req.query.severity) { where.push('a.severity = ?'); params.push(String(req.query.severity)); }
  if (req.query.machineId) { where.push('a.machine_id = ?'); params.push(Number(req.query.machineId)); }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM alerts a${w}`, ...params).n;
  const data = db.all(`${SELECT}${w} ORDER BY a.raised_at DESC LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data, page, limit, total });
});

function transition(req, res, to) {
  const id = idParam(req);
  const a = db.get('SELECT * FROM alerts WHERE id = ?', id);
  if (!a) throw notFound('Alert');
  if (a.status === 'RESOLVED') throw badRequest('Alert is already resolved');
  if (to === 'ACKNOWLEDGED' && a.status !== 'OPEN') throw badRequest('Only open alerts can be acknowledged');
  const now = Date.now();
  if (to === 'ACKNOWLEDGED') {
    db.run("UPDATE alerts SET status = 'ACKNOWLEDGED', acknowledged_by = ?, acknowledged_at = ? WHERE id = ?", req.user.id, now, id);
  } else {
    db.run("UPDATE alerts SET status = 'RESOLVED', resolved_at = ?, acknowledged_by = COALESCE(acknowledged_by, ?), acknowledged_at = COALESCE(acknowledged_at, ?) WHERE id = ?", now, req.user.id, now, id);
  }
  const note = validate(req.body, { note: { maxLen: 300 } }).note;
  audit(req, to === 'ACKNOWLEDGED' ? 'ALERT_ACK' : 'ALERT_RESOLVE', 'alerts', id, note ? { note } : null);
  const updated = db.get(`${SELECT} WHERE a.id = ?`, id);
  realtime.emit('alert:update', updated);
  res.json({ data: updated });
}

router.patch('/:id/ack', authorize('alerts:ack'), (req, res) => transition(req, res, 'ACKNOWLEDGED'));
router.patch('/:id/resolve', authorize('alerts:ack'), (req, res) => transition(req, res, 'RESOLVED'));

module.exports = router;
