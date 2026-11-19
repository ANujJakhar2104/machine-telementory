const express = require('express');
const db = require('../db');
const { authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { badRequest } = require('../utils/http');

const router = express.Router();
const DAY = 86400000;

function windowFor(period) {
  const days = period === 'weekly' ? 7 : 1;
  return { from: Date.now() - days * DAY, days };
}

// Uptime = share of minutes in the window in which the machine reported data (data availability).
router.get('/uptime', authorize('reports:view'), (req, res) => {
  const { from } = windowFor(req.query.period);
  const first = db.get('SELECT MIN(recorded_at) AS t FROM readings').t;
  const start = Math.max(from, first || Date.now());
  const minutes = Math.max(1, Math.round((Date.now() - start) / 60000));
  const rows = db.all(`SELECT m.id, m.machine_code, m.name, m.status, m.health_score,
      (SELECT COUNT(DISTINCT r.recorded_at / 60000) FROM readings r
         JOIN sensors s ON s.id = r.sensor_id WHERE s.machine_id = m.id AND s.type = 'load' AND r.recorded_at >= ?) AS active_minutes,
      (SELECT COUNT(*) FROM alerts a WHERE a.machine_id = m.id AND a.raised_at >= ? AND a.severity = 'CRITICAL') AS critical_alerts,
      (SELECT COUNT(*) FROM alerts a WHERE a.machine_id = m.id AND a.raised_at >= ? AND a.severity = 'WARNING') AS warning_alerts,
      (SELECT COUNT(*) FROM alerts a WHERE a.machine_id = m.id AND a.raised_at >= ? AND a.severity = 'INFO') AS info_alerts
    FROM machines m ORDER BY m.machine_code`, start, from, from, from);
  const data = rows.map((r) => ({ ...r, uptime_pct: Math.min(100, Math.round((r.active_minutes / minutes) * 1000) / 10) }));
  res.json({ data, window_minutes: minutes, from: start });
});

router.get('/summary', authorize('reports:view'), (req, res) => {
  const { from } = windowFor(req.query.period);
  const alerts = db.all('SELECT severity, COUNT(*) AS n FROM alerts WHERE raised_at >= ? GROUP BY severity', from);
  const tickets = {
    opened: db.get('SELECT COUNT(*) AS n FROM maintenance_tickets WHERE created_at >= ?', from).n,
    resolved: db.get("SELECT COUNT(*) AS n FROM maintenance_tickets WHERE status IN ('RESOLVED','CLOSED') AND updated_at >= ?", from).n,
    open_now: db.get("SELECT COUNT(*) AS n FROM maintenance_tickets WHERE status IN ('OPEN','IN_PROGRESS')").n,
    mttr_minutes: db.get(`SELECT ROUND(AVG(updated_at - created_at) / 60000.0, 1) AS v FROM maintenance_tickets
      WHERE status IN ('RESOLVED','CLOSED') AND updated_at >= ?`, from).v,
  };
  const sensors = db.all(`SELECT m.machine_code, s.type, s.unit,
      ROUND(AVG(r.value), 2) AS avg, ROUND(MIN(r.value), 2) AS min, ROUND(MAX(r.value), 2) AS max, COUNT(*) AS samples
    FROM readings r JOIN sensors s ON s.id = r.sensor_id JOIN machines m ON m.id = s.machine_id
    WHERE r.recorded_at >= ? GROUP BY s.id ORDER BY m.machine_code, s.type`, from);
  res.json({ data: { period: req.query.period === 'weekly' ? 'weekly' : 'daily', from, alerts, tickets, sensors } });
});

function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\r\n');
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : '');

router.get('/export', authorize('reports:export'), (req, res) => {
  const type = req.query.type || 'readings';
  const { from } = windowFor(req.query.period);
  let rows;
  let cols;
  if (type === 'readings') {
    rows = db.all(`SELECT m.machine_code, s.type AS sensor, s.unit, h.hour_start, ROUND(h.avg_val,3) AS avg, ROUND(h.min_val,3) AS min,
        ROUND(h.max_val,3) AS max, h.samples FROM readings_hourly h JOIN sensors s ON s.id = h.sensor_id
        JOIN machines m ON m.id = s.machine_id WHERE h.hour_start >= ? ORDER BY m.machine_code, s.type, h.hour_start`, from - 3600000)
      .map((r) => ({ ...r, hour_start: iso(r.hour_start) }));
    cols = ['machine_code', 'sensor', 'unit', 'hour_start', 'avg', 'min', 'max', 'samples'];
  } else if (type === 'alerts') {
    rows = db.all(`SELECT a.id, m.machine_code, a.severity, a.status, a.message, a.value, a.raised_at, a.resolved_at
        FROM alerts a JOIN machines m ON m.id = a.machine_id WHERE a.raised_at >= ? ORDER BY a.raised_at`, from)
      .map((r) => ({ ...r, raised_at: iso(r.raised_at), resolved_at: iso(r.resolved_at) }));
    cols = ['id', 'machine_code', 'severity', 'status', 'message', 'value', 'raised_at', 'resolved_at'];
  } else if (type === 'tickets') {
    rows = db.all(`SELECT t.id, m.machine_code, t.title, t.priority, t.status, u.name AS assignee, t.due_date, t.created_at, t.updated_at
        FROM maintenance_tickets t JOIN machines m ON m.id = t.machine_id LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.created_at >= ? ORDER BY t.created_at`, from)
      .map((r) => ({ ...r, created_at: iso(r.created_at), updated_at: iso(r.updated_at) }));
    cols = ['id', 'machine_code', 'title', 'priority', 'status', 'assignee', 'due_date', 'created_at', 'updated_at'];
  } else {
    throw badRequest('type must be readings, alerts or tickets');
  }
  audit(req, 'EXPORT', type, null, { period: req.query.period || 'daily', rows: rows.length });
  const name = `${type}-${req.query.period === 'weekly' ? 'weekly' : 'daily'}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="${name}"`).send(`﻿${toCsv(rows, cols)}`);
});

module.exports = router;
