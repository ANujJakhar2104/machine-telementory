const bcrypt = require('bcryptjs');
const db = require('./index');
const config = require('../config');

const DEMO_USERS = [
  { name: 'Site Administrator', email: 'admin@smengineers.demo', role: 'ADMIN', password: 'Admin@123' },
  { name: 'Ravi Sharma', email: 'engineer@smengineers.demo', role: 'ENGINEER', password: 'Engineer@123' },
  { name: 'Anita Verma', email: 'engineer2@smengineers.demo', role: 'ENGINEER', password: 'Engineer@123' },
  { name: 'Plant Viewer', email: 'viewer@smengineers.demo', role: 'VIEWER', password: 'Viewer@123' },
];

// IST timestamp helper: ist('2026-11-16 07:40') -> epoch ms
const ist = (s) => Date.parse(`${s.replace(' ', 'T')}:00+05:30`);

// `registered` = date the machine was commissioned on the shop floor.
const MACHINES = [
  { code: 'CNC-01', name: 'CNC Turning Centre', type: 'CNC Lathe', location: 'Shop A · Bay 1', registered: '2019-08-12 10:30' },
  { code: 'VMC-02', name: 'Vertical Machining Centre', type: 'VMC', location: 'Shop A · Bay 2', registered: '2020-02-24 11:15' },
  { code: 'CNC-03', name: 'CNC Turning Centre', type: 'CNC Lathe', location: 'Shop A · Bay 3', registered: '2020-11-09 09:45' },
  { code: 'VMC-04', name: 'Vertical Machining Centre', type: 'VMC', location: 'Shop B · Bay 1', registered: '2021-06-17 14:20' },
  { code: 'SM-05', name: 'Press Brake', type: 'Sheet Metal', location: 'Shop B · Bay 2', registered: '2022-01-28 12:00' },
  { code: 'CNC-06', name: 'CNC Milling Machine', type: 'CNC Mill', location: 'Shop B · Bay 3', status: 'MAINTENANCE', registered: '2019-04-03 16:10' },
];

// Past alert history, 16–19 Nov 2026: 3–4 alerts a day, 3–5 hours apart, across machines.
// [raised (IST), machine, sensor, severity, value, kind, minutes to resolve, ticket?]
// kind: 'info' | 'soft' | 'hard' | 'z'. Tickets: [status, priority, title, description]
const HISTORY = [
  ['2026-11-16 07:40', 'CNC-06', 'vibration', 'WARNING', 10.21, 'soft', 70],
  ['2026-11-16 11:15', 'CNC-06', 'vibration', 'CRITICAL', 11.84, 'hard', null,
    ['IN_PROGRESS', 'HIGH', 'Spindle overhaul: CNC-06 vibration critical', 'Bearing wear suspected on main spindle. Machine taken offline for scheduled overhaul.']],
  ['2026-11-16 15:20', 'VMC-02', 'load', 'INFO', 83.4, 'info', 40],
  ['2026-11-16 19:05', 'SM-05', 'temperature', 'WARNING', 84.1, 'soft', 55],
  ['2026-11-17 08:30', 'VMC-04', 'temperature', 'INFO', 76.8, 'info', 35],
  ['2026-11-17 12:10', 'CNC-01', 'load', 'WARNING', 91.4, 'soft', 60],
  ['2026-11-17 16:45', 'VMC-04', 'vibration', 'CRITICAL', 6.42, 'z', 150,
    ['CLOSED', 'HIGH', 'Inspect VMC-04: vibration critical', 'Loose tool holder found and re-torqued. Vibration back to normal.']],
  ['2026-11-18 06:50', 'CNC-03', 'temperature', 'INFO', 77.2, 'info', 30],
  ['2026-11-18 10:35', 'SM-05', 'load', 'CRITICAL', 101.6, 'hard', 120,
    ['RESOLVED', 'HIGH', 'Inspect SM-05: load critical', 'Overload on press brake. Hydraulic pressure relief valve recalibrated.']],
  ['2026-11-18 14:20', 'VMC-02', 'vibration', 'WARNING', 10.05, 'soft', 65],
  ['2026-11-18 18:55', 'CNC-01', 'temperature', 'INFO', 75.9, 'info', 25],
  ['2026-11-19 07:15', 'VMC-04', 'load', 'WARNING', 90.8, 'soft', 50],
  ['2026-11-19 11:30', 'CNC-03', 'temperature', 'CRITICAL', 68.7, 'z', 110,
    ['RESOLVED', 'HIGH', 'Inspect CNC-03: temperature critical', 'Coolant flow restricted by a blocked filter. Filter replaced.']],
  ['2026-11-19 14:40', 'VMC-02', 'temperature', 'INFO', 76.1, 'info', 30],
];

const SENSOR_TYPES = [
  { type: 'temperature', unit: '°C', min: 15, max: 90 },
  { type: 'vibration', unit: 'mm/s', min: 0, max: 11 },
  { type: 'load', unit: '%', min: 0, max: 100 },
];

const NOTICES = [
  'Machine Telemetry & Predictive Maintenance Portal is now live for all shop-floor teams.',
  'Critical alerts now automatically create a maintenance ticket and notify the engineering team.',
  'Daily and weekly reports can be exported as CSV from the Reports section.',
  'Planned maintenance: CNC-06 milling machine is under scheduled spindle overhaul.',
];

function createSensorWithRules(machineId, s) {
  const sensor = db.run('INSERT INTO sensors (machine_id, type, unit, min_val, max_val) VALUES (?,?,?,?,?)',
    machineId, s.type, s.unit, s.min, s.max);
  const range = s.max - s.min;
  const rules = [
    ['>', +(s.min + range * 0.8).toFixed(2), 'INFO', 1, 600],
    ['>', +(s.min + range * 0.9).toFixed(2), 'WARNING', 1, 300],
    ['>', s.max, 'CRITICAL', 1, 300],
    ['ZSCORE', 3, 'CRITICAL', 3, 300],
  ];
  for (const [op, th, sev, consec, cd] of rules) {
    db.run('INSERT INTO alert_rules (sensor_id, operator, threshold, severity, consecutive, cooldown_s) VALUES (?,?,?,?,?,?)',
      sensor.id, op, th, sev, consec, cd);
  }
  return sensor.id;
}

function alertMessage(code, s, value, kind) {
  const range = s.max - s.min;
  const v = `${value.toFixed(2)} ${s.unit}`;
  switch (kind) {
    case 'info': return `${code}: ${s.type} ${v} is close to its limit (> ${+(s.min + range * 0.8).toFixed(2)} ${s.unit})`;
    case 'soft': return `${code}: ${s.type} ${v} crossed soft limit (> ${+(s.min + range * 0.9).toFixed(2)} ${s.unit})`;
    case 'hard': return `${code}: ${s.type} ${v} crossed hard limit (> ${s.max} ${s.unit})`;
    default: return `${code}: abnormal ${s.type} (${v}, z-score ${(4.2 + (value % 1) * 2).toFixed(1)}) for 3 readings in a row`;
  }
}

// Machine commissioning dates (also corrects databases created before these were added).
function applyRegistrationDates() {
  for (const m of MACHINES) {
    db.run('UPDATE machines SET created_at = ? WHERE machine_code = ? AND created_at <> ?', ist(m.registered), m.code, ist(m.registered));
  }
}

// One-off insert of the 16–19 Nov alert/ticket history.
function seedHistory() {
  if (db.get("SELECT value FROM site_counters WHERE key = 'history_seeded'")) return;
  const engineers = db.all("SELECT id FROM users WHERE role = 'ENGINEER' AND is_active = 1 ORDER BY id");
  const fallback = db.get("SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id");
  const handlers = engineers.length ? engineers.map((u) => u.id) : [fallback?.id ?? null];
  const ruleFor = { info: ['>', 'INFO'], soft: ['>', 'WARNING'], hard: ['>', 'CRITICAL'], z: ['ZSCORE', 'CRITICAL'] };

  db.transaction(() => {
    HISTORY.forEach(([at, code, type, severity, value, kind, resolveMin, ticket], i) => {
      const machine = db.get('SELECT id FROM machines WHERE machine_code = ?', code);
      if (!machine) return;
      const sensor = db.get('SELECT id FROM sensors WHERE machine_id = ? AND type = ?', machine.id, type);
      const [op, sev] = ruleFor[kind];
      const rule = sensor && db.get('SELECT id FROM alert_rules WHERE sensor_id = ? AND operator = ? AND severity = ?', sensor.id, op, sev);
      const s = SENSOR_TYPES.find((x) => x.type === type);
      const raised = ist(at);
      const handler = handlers[i % handlers.length];
      const resolved = resolveMin != null;
      const alert = db.run(`INSERT INTO alerts (rule_id, machine_id, sensor_id, severity, status, message, value, raised_at, acknowledged_by, acknowledged_at, resolved_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      rule?.id ?? null, machine.id, sensor?.id ?? null, severity, resolved ? 'RESOLVED' : 'ACKNOWLEDGED',
      alertMessage(code, s, value, kind), value, raised, handler, raised + 12 * 60000, resolved ? raised + resolveMin * 60000 : null);

      if (ticket) {
        const [status, priority, title, description] = ticket;
        const due = new Date(raised + (status === 'IN_PROGRESS' ? 5 : 2) * 86400000).toISOString().slice(0, 10);
        const updated = resolved ? raised + resolveMin * 60000 : raised + 3 * 3600000;
        db.run(`INSERT INTO maintenance_tickets (alert_id, machine_id, title, description, priority, assigned_to, created_by, status, due_date, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        alert.id, machine.id, title, description, priority, handler, null, status, due, raised, updated);
      }
    });
    db.run("INSERT INTO site_counters (key, value) VALUES ('history_seeded', 1)");
  });
}

function seed() {
  const now = Date.now();
  const hasUsers = db.get('SELECT COUNT(*) AS n FROM users').n > 0;
  if (!hasUsers) {
    db.transaction(() => {
      const users = config.seedDemoUsers ? DEMO_USERS : [DEMO_USERS[0]];
      for (const u of users) {
        db.run('INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?,?,?,?,?)',
          u.name, u.email, u.role, bcrypt.hashSync(u.password, 10), now);
      }
    });
  }
  const hasMachines = db.get('SELECT COUNT(*) AS n FROM machines').n > 0;
  if (!hasMachines) {
    db.transaction(() => {
      for (const m of MACHINES) {
        const r = db.run('INSERT INTO machines (machine_code, name, type, location, status, created_at) VALUES (?,?,?,?,?,?)',
          m.code, m.name, m.type, m.location, m.status || 'RUNNING', ist(m.registered));
        for (const s of SENSOR_TYPES) createSensorWithRules(r.id, s);
      }
      NOTICES.forEach((t, i) => db.run('INSERT INTO notices (title, published_at) VALUES (?,?)', t, now - i * 86400000));
    });
  }
  applyRegistrationDates();
  if (!config.isTest) seedHistory();
}

module.exports = { seed, createSensorWithRules, SENSOR_TYPES, DEMO_USERS };
