// Shop-floor simulator: stands in for CNC sensors publishing over MQTT.
// It feeds the exact same ingest() path that the HTTP device endpoint uses.
const db = require('../db');
const telemetry = require('./telemetry');
const logger = require('../utils/logger');

const state = new Map(); // machineId -> { phase, fault }
let timer = null;
let nextAutoFault = 0;

function gauss() {
  let u = 0; let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function machineState(id) {
  if (!state.has(id)) state.set(id, { phase: Math.random() * Math.PI * 2, base: { t: 48 + Math.random() * 8, v: 2.5 + Math.random(), l: 50 + Math.random() * 10 }, fault: null });
  return state.get(id);
}

/** Starts a degradation pattern on a machine: values ramp up over ~45 s, hold, then recover. */
function injectFault(machineId, sensor = null) {
  const kinds = ['vibration', 'temperature'];
  const s = machineState(machineId);
  s.fault = { sensor: sensor && kinds.includes(sensor) ? sensor : kinds[Math.floor(Math.random() * kinds.length)], start: Date.now(), duration: 120000 };
  logger.info(`[simulator] fault injected on machine ${machineId} (${s.fault.sensor})`);
  return s.fault;
}

function faultLevel(f, now) {
  if (!f) return 0;
  const t = now - f.start;
  if (t > f.duration) return -1;
  if (t < 45000) return t / 45000;
  if (t > f.duration - 20000) return (f.duration - t) / 20000;
  return 1;
}

function tick() {
  const now = Date.now();
  const machines = db.all("SELECT id, machine_code FROM machines WHERE status IN ('RUNNING','IDLE')");
  if (now > nextAutoFault && machines.length) {
    const m = machines[Math.floor(Math.random() * machines.length)];
    if (!machineState(m.id).fault) injectFault(m.id);
    nextAutoFault = now + (4 + Math.random() * 5) * 60000;
  }
  for (const m of machines) {
    const s = machineState(m.id);
    let lvl = faultLevel(s.fault, now);
    if (lvl < 0) { s.fault = null; lvl = 0; }
    s.phase += 0.05;
    const load = s.base.l + 12 * Math.sin(s.phase) + gauss() * 2.5;
    let temperature = s.base.t + (load - 50) * 0.12 + gauss() * 0.6;
    let vibration = s.base.v + gauss() * 0.2;
    if (s.fault?.sensor === 'vibration') vibration += lvl * 9;
    if (s.fault?.sensor === 'temperature') temperature += lvl * 44;
    telemetry.ingest({
      machine_code: m.machine_code,
      ts: now,
      temperature: +temperature.toFixed(2),
      vibration: +Math.max(0, vibration).toFixed(3),
      load: +Math.min(100, Math.max(0, load)).toFixed(1),
    });
  }
}

function start(intervalMs) {
  if (timer) return;
  nextAutoFault = Date.now() + 90000; // first automatic fault ~90 s after boot so a demo shows alerts quickly
  timer = setInterval(() => {
    try { tick(); } catch (e) { logger.error(`[simulator] ${e.message}`); }
  }, intervalMs);
  logger.info(`[simulator] started (every ${intervalMs} ms)`);
}

function stop() { clearInterval(timer); timer = null; }

function status() {
  return [...state.entries()].filter(([, s]) => s.fault).map(([id, s]) => ({ machine_id: id, sensor: s.fault.sensor, since: s.fault.start }));
}

module.exports = { start, stop, tick, injectFault, status };
