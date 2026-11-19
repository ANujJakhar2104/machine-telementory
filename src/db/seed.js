const bcrypt = require('bcryptjs');
const db = require('./index');
const config = require('../config');

const DEMO_USERS = [
  { name: 'Site Administrator', email: 'admin@smengineers.demo', role: 'ADMIN', password: 'Admin@123' },
  { name: 'Ravi Sharma', email: 'engineer@smengineers.demo', role: 'ENGINEER', password: 'Engineer@123' },
  { name: 'Anita Verma', email: 'engineer2@smengineers.demo', role: 'ENGINEER', password: 'Engineer@123' },
  { name: 'Plant Viewer', email: 'viewer@smengineers.demo', role: 'VIEWER', password: 'Viewer@123' },
];

const MACHINES = [
  { code: 'CNC-01', name: 'CNC Turning Centre', type: 'CNC Lathe', location: 'Shop A · Bay 1' },
  { code: 'VMC-02', name: 'Vertical Machining Centre', type: 'VMC', location: 'Shop A · Bay 2' },
  { code: 'CNC-03', name: 'CNC Turning Centre', type: 'CNC Lathe', location: 'Shop A · Bay 3' },
  { code: 'VMC-04', name: 'Vertical Machining Centre', type: 'VMC', location: 'Shop B · Bay 1' },
  { code: 'SM-05', name: 'Press Brake', type: 'Sheet Metal', location: 'Shop B · Bay 2' },
  { code: 'CNC-06', name: 'CNC Milling Machine', type: 'CNC Mill', location: 'Shop B · Bay 3', status: 'MAINTENANCE' },
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
          m.code, m.name, m.type, m.location, m.status || 'RUNNING', now);
        for (const s of SENSOR_TYPES) createSensorWithRules(r.id, s);
      }
      NOTICES.forEach((t, i) => db.run('INSERT INTO notices (title, published_at) VALUES (?,?)', t, now - i * 86400000));
    });
  }
}

module.exports = { seed, createSensorWithRules, SENSOR_TYPES, DEMO_USERS };
