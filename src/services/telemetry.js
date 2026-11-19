const db = require('../db');
const realtime = require('./realtime');
const notifier = require('./notifier');
const tickets = require('./tickets');
const logger = require('../utils/logger');
const { SensorStats, evaluateRule, healthScore, describe } = require('./alertEngine');

// In-memory structures play the role Redis plays in the full deployment:
// latest value per sensor, the write buffer, and per-sensor rolling statistics.
const latest = new Map();      // sensorId -> { value, ts, z }
const stats = new Map();       // sensorId -> SensorStats
const ruleState = new Map();   // ruleId -> { streak, active, lastFired }
let buffer = [];               // pending rows for the batched insert
let index = null;              // machine_code -> { machine, sensors: { type: sensor }, rules: { sensorId: [rule] } }
const counters = { accepted: 0, rejected: 0, duplicates: 0, flushed: 0, lastFlushMs: 0 };

function loadIndex() {
  const machines = db.all('SELECT * FROM machines');
  const sensors = db.all('SELECT * FROM sensors');
  const rules = db.all('SELECT * FROM alert_rules');
  index = new Map();
  const byId = new Map();
  for (const m of machines) {
    const entry = { machine: m, sensors: {}, rules: {} };
    index.set(m.machine_code, entry);
    byId.set(m.id, entry);
  }
  for (const s of sensors) {
    const e = byId.get(s.machine_id);
    if (e) { e.sensors[s.type] = s; e.rules[s.id] = []; }
  }
  const sensorMachine = new Map(sensors.map((s) => [s.id, s.machine_id]));
  for (const r of rules) {
    const e = byId.get(sensorMachine.get(r.sensor_id));
    if (e && e.rules[r.sensor_id]) e.rules[r.sensor_id].push(r);
  }
}

function invalidate() { index = null; }
function getIndex() { if (!index) loadIndex(); return index; }

function machineEntryById(id) {
  for (const e of getIndex().values()) if (e.machine.id === id) return e;
  return null;
}

function latestFor(machineId) {
  const e = machineEntryById(machineId);
  if (!e) return null;
  const out = {};
  for (const [type, s] of Object.entries(e.sensors)) {
    const l = latest.get(s.id);
    out[type] = l ? { value: l.value, ts: l.ts, z: l.z, unit: s.unit, min: s.min_val, max: s.max_val } : null;
  }
  return out;
}

function raiseAlert(entry, sensor, rule, value, z, ts) {
  const message = describe(rule, sensor, entry.machine, value, z ?? 0);
  const r = db.run(`INSERT INTO alerts (rule_id, machine_id, sensor_id, severity, status, message, value, raised_at)
    VALUES (?,?,?,?, 'OPEN', ?,?,?)`, rule.id, entry.machine.id, sensor.id, rule.severity, message, value, ts);
  const alert = { id: r.id, rule_id: rule.id, machine_id: entry.machine.id, machine_code: entry.machine.machine_code,
    sensor_type: sensor.type, severity: rule.severity, status: 'OPEN', message, value, raised_at: ts };
  realtime.emit('alert:new', alert);
  if (rule.severity === 'CRITICAL') {
    notifier.emailRoles(['ADMIN', 'ENGINEER'], `[CRITICAL] ${entry.machine.machine_code} – ${sensor.type}`, message);
    tickets.ensureForMachine(entry.machine.id, r.id, `Inspect ${entry.machine.machine_code}: ${sensor.type} critical`, message);
  }
  return alert;
}

/**
 * Validates and accepts one telemetry message: { machine_code, ts?, temperature?, vibration?, load? }.
 * Returns { accepted, rejected, errors }.
 */
function ingest(msg) {
  const errors = [];
  const entry = msg && getIndex().get(String(msg.machine_code || ''));
  if (!entry) { counters.rejected += 1; return { accepted: 0, rejected: 1, errors: ['unknown machine_code'] }; }
  const ts = Number.isFinite(Number(msg.ts)) ? Math.round(Number(msg.ts)) : Date.now();
  if (Math.abs(ts - Date.now()) > 24 * 3600 * 1000) {
    counters.rejected += 1;
    return { accepted: 0, rejected: 1, errors: ['timestamp outside the accepted window'] };
  }
  let accepted = 0;
  let rejected = 0;
  const values = {};
  for (const [type, sensor] of Object.entries(entry.sensors)) {
    if (msg[type] === undefined || msg[type] === null) continue;
    const value = Number(msg[type]);
    const span = sensor.max_val - sensor.min_val;
    // Physically impossible values are sensor faults, not machine faults: reject and log them.
    if (!Number.isFinite(value) || value < sensor.min_val - span || value > sensor.max_val + span) {
      rejected += 1;
      errors.push(`${type}: implausible value ${msg[type]}`);
      continue;
    }
    accepted += 1;
    buffer.push([sensor.id, value, ts]);
    let st = stats.get(sensor.id);
    if (!st) { st = new SensorStats(); stats.set(sensor.id, st); }
    const z = st.push(value);
    const prev = latest.get(sensor.id);
    if (!prev || prev.ts <= ts) latest.set(sensor.id, { value, ts, z });
    values[type] = value;

    for (const rule of entry.rules[sensor.id] || []) {
      let s = ruleState.get(rule.id);
      if (!s) { s = { streak: 0, active: false, lastFired: null }; ruleState.set(rule.id, s); }
      if (evaluateRule(rule, value, z, s, ts)) raiseAlert(entry, sensor, rule, value, z, ts);
    }
  }
  counters.accepted += accepted;
  counters.rejected += rejected;
  if (rejected) logger.warn(`[ingest] ${entry.machine.machine_code} rejected: ${errors.join('; ')}`);
  if (accepted) {
    realtime.emit('machine:update', { machine_id: entry.machine.id, machine_code: entry.machine.machine_code, ts,
      values, health_score: entry.machine.health_score, status: entry.machine.status });
  }
  return { accepted, rejected, errors };
}

/** Batched write: one transaction per second instead of one INSERT per reading. Duplicates are ignored by the unique key. */
function flush() {
  if (!buffer.length) return 0;
  const rows = buffer;
  buffer = [];
  const t0 = Date.now();
  let inserted = 0;
  db.transaction(() => {
    for (const [sid, v, ts] of rows) inserted += db.run('INSERT OR IGNORE INTO readings (sensor_id, value, recorded_at) VALUES (?,?,?)', sid, v, ts).changes;
  });
  counters.duplicates += rows.length - inserted;
  counters.flushed += inserted;
  counters.lastFlushMs = Date.now() - t0;
  return inserted;
}

function refreshHealth() {
  const open = db.all("SELECT machine_id, severity, status FROM alerts WHERE status != 'RESOLVED' AND raised_at > ?", Date.now() - 24 * 3600 * 1000);
  const byMachine = new Map();
  for (const a of open) {
    if (!byMachine.has(a.machine_id)) byMachine.set(a.machine_id, []);
    byMachine.get(a.machine_id).push(a);
  }
  for (const entry of getIndex().values()) {
    const m = entry.machine;
    let maxZ = 0;
    for (const s of Object.values(entry.sensors)) {
      const l = latest.get(s.id);
      if (l && l.z !== null && Date.now() - l.ts < 30000) maxZ = Math.max(maxZ, Math.abs(l.z));
    }
    const score = healthScore(byMachine.get(m.id) || [], maxZ);
    if (score !== m.health_score) {
      db.run('UPDATE machines SET health_score = ? WHERE id = ?', score, m.id);
      m.health_score = score;
      realtime.emit('machine:update', { machine_id: m.id, machine_code: m.machine_code, health_score: score, status: m.status });
    }
    if (score < 40 && m.status !== 'MAINTENANCE') {
      tickets.ensureForMachine(m.id, null, `Low health score on ${m.machine_code} (${score}/100)`,
        `Health score dropped to ${score}. Schedule an inspection before failure.`);
    }
  }
}

function rollupHourly(sinceMs = Date.now() - 2 * 3600 * 1000) {
  const from = Math.floor(sinceMs / 3600000) * 3600000;
  db.run(`INSERT INTO readings_hourly (sensor_id, hour_start, avg_val, min_val, max_val, samples)
    SELECT sensor_id, (recorded_at / 3600000) * 3600000 AS h, AVG(value), MIN(value), MAX(value), COUNT(*)
    FROM readings WHERE recorded_at >= ? GROUP BY sensor_id, h
    ON CONFLICT(sensor_id, hour_start) DO UPDATE SET avg_val = excluded.avg_val, min_val = excluded.min_val,
      max_val = excluded.max_val, samples = excluded.samples`, from);
}

function purgeRaw(retentionHours) {
  return db.run('DELETE FROM readings WHERE recorded_at < ?', Date.now() - retentionHours * 3600 * 1000).changes;
}

function resetState() {
  latest.clear(); stats.clear(); ruleState.clear(); buffer = []; index = null;
  Object.keys(counters).forEach((k) => { counters[k] = 0; });
}

module.exports = { ingest, flush, refreshHealth, rollupHourly, purgeRaw, latestFor, invalidate, counters, resetState, getIndex };
