process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const { seed } = require('../src/db/seed');
const { createApp } = require('../src/app');
const captcha = require('../src/utils/captcha');
const telemetry = require('../src/services/telemetry');

db.open();
seed();
const app = createApp();

async function login(email, password) {
  const c = await request(app).get('/api/v1/auth/captcha');
  const res = await request(app).post('/api/v1/auth/login')
    .send({ email, password, captchaId: c.body.id, captchaAnswer: captcha._answer(c.body.id) });
  return res;
}

const tokens = {};
test.before(async () => {
  for (const [role, email, pw] of [['admin', 'admin@smengineers.demo', 'Admin@123'], ['engineer', 'engineer@smengineers.demo', 'Engineer@123'], ['viewer', 'viewer@smengineers.demo', 'Viewer@123']]) {
    const r = await login(email, pw);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tokens[role] = r.body.accessToken;
  }
});
const auth = (role) => ({ Authorization: `Bearer ${tokens[role]}` });

test('health check is public', async () => {
  const r = await request(app).get('/api/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ok');
});

test('wrong password and wrong captcha are rejected', async () => {
  assert.equal((await login('admin@smengineers.demo', 'nope')).status, 401);
  const c = await request(app).get('/api/v1/auth/captcha');
  const r = await request(app).post('/api/v1/auth/login').send({ email: 'admin@smengineers.demo', password: 'Admin@123', captchaId: c.body.id, captchaAnswer: '999' });
  assert.equal(r.status, 400);
});

test('protected routes need a token', async () => {
  assert.equal((await request(app).get('/api/v1/machines')).status, 401);
  assert.equal((await request(app).get('/api/v1/machines').set('Authorization', 'Bearer garbage')).status, 401);
});

test('login response carries role permissions', async () => {
  const r = await request(app).get('/api/v1/auth/me').set(auth('viewer'));
  assert.equal(r.body.user.role, 'VIEWER');
  assert.ok(r.body.user.permissions.includes('machines:view'));
  assert.ok(!r.body.user.permissions.includes('alerts:ack'));
});

test('RBAC: viewer can read but not write', async () => {
  assert.equal((await request(app).get('/api/v1/machines').set(auth('viewer'))).status, 200);
  assert.equal((await request(app).post('/api/v1/machines').set(auth('viewer')).send({ machine_code: 'X-1', name: 'x', type: 'x', location: 'x' })).status, 403);
  assert.equal((await request(app).get('/api/v1/users').set(auth('viewer'))).status, 403);
  assert.equal((await request(app).get('/api/v1/reports/export?type=alerts').set(auth('viewer'))).status, 403);
  assert.equal((await request(app).get('/api/v1/rules').set(auth('viewer'))).status, 403);
});

test('RBAC: engineer cannot manage users or machines, admin can', async () => {
  assert.equal((await request(app).get('/api/v1/users').set(auth('engineer'))).status, 403);
  assert.equal((await request(app).post('/api/v1/machines').set(auth('engineer')).send({ machine_code: 'CNC-90', name: 'x', type: 'x', location: 'x' })).status, 403);
  const r = await request(app).post('/api/v1/machines').set(auth('admin')).send({ machine_code: 'CNC-90', name: 'Test Lathe', type: 'CNC Lathe', location: 'Lab' });
  assert.equal(r.status, 201);
  const detail = await request(app).get(`/api/v1/machines/${r.body.data.id}`).set(auth('viewer'));
  assert.equal(detail.body.data.sensors.length, 3);
});

test('validation errors return 400 with details', async () => {
  const r = await request(app).post('/api/v1/machines').set(auth('admin')).send({ machine_code: 'bad code!' });
  assert.equal(r.status, 400);
  assert.ok(Array.isArray(r.body.details));
});

test('ingestion: device key, validation, dedupe, batched save', async () => {
  assert.equal((await request(app).post('/api/v1/telemetry').send({ machine_code: 'CNC-01', temperature: 50 })).status, 401);
  const ts = Date.now();
  const ok = await request(app).post('/api/v1/telemetry').set('x-device-key', 'dev-device-key')
    .send([{ machine_code: 'CNC-01', ts, temperature: 50, vibration: 3, load: 40 }, { machine_code: 'CNC-01', ts, temperature: 50, vibration: 3, load: 40 }]);
  assert.equal(ok.status, 202);
  assert.equal(ok.body.accepted, 6);
  const bad = await request(app).post('/api/v1/telemetry').set('x-device-key', 'dev-device-key').send({ machine_code: 'CNC-01', temperature: 5000 });
  assert.equal(bad.body.rejected, 1);
  const inserted = telemetry.flush();
  assert.equal(inserted, 3); // duplicate message ignored by the unique key
});

test('hard-limit breach raises a critical alert and an auto ticket', async () => {
  const before = db.get('SELECT COUNT(*) AS n FROM maintenance_tickets').n;
  await request(app).post('/api/v1/telemetry').set('x-device-key', 'dev-device-key').send({ machine_code: 'VMC-02', temperature: 120 });
  const alerts = await request(app).get('/api/v1/alerts?severity=CRITICAL').set(auth('viewer'));
  assert.ok(alerts.body.data.some((a) => a.machine_code === 'VMC-02'));
  assert.equal(db.get('SELECT COUNT(*) AS n FROM maintenance_tickets').n, before + 1);
  assert.ok(db.get("SELECT COUNT(*) AS n FROM notifications WHERE subject LIKE '[CRITICAL]%'").n > 0);
});

test('alert acknowledge: viewer forbidden, engineer allowed', async () => {
  const a = (await request(app).get('/api/v1/alerts?status=OPEN').set(auth('viewer'))).body.data[0];
  assert.equal((await request(app).patch(`/api/v1/alerts/${a.id}/ack`).set(auth('viewer'))).status, 403);
  const r = await request(app).patch(`/api/v1/alerts/${a.id}/ack`).set(auth('engineer'));
  assert.equal(r.status, 200);
  assert.equal(r.body.data.status, 'ACKNOWLEDGED');
});

test('tickets: engineer may only update tickets assigned to them', async () => {
  const machine = db.get("SELECT id FROM machines WHERE machine_code = 'CNC-03'");
  const t = await request(app).post('/api/v1/tickets').set(auth('admin')).send({ machine_id: machine.id, title: 'Check spindle', assigned_to: db.get("SELECT id FROM users WHERE email = 'engineer2@smengineers.demo'").id });
  assert.equal(t.status, 201);
  assert.equal((await request(app).patch(`/api/v1/tickets/${t.body.data.id}/status`).set(auth('engineer')).send({ status: 'IN_PROGRESS' })).status, 403);
  const own = await request(app).post('/api/v1/tickets').set(auth('engineer')).send({ machine_id: machine.id, title: 'Replace coolant' });
  assert.equal(own.status, 201);
  assert.equal((await request(app).patch(`/api/v1/tickets/${own.body.data.id}/status`).set(auth('engineer')).send({ status: 'RESOLVED' })).status, 200);
  assert.equal((await request(app).patch(`/api/v1/tickets/${own.body.data.id}/status`).set(auth('engineer')).send({ status: 'CLOSED' })).status, 403);
});

test('reports and CSV export', async () => {
  telemetry.rollupHourly(0);
  assert.equal((await request(app).get('/api/v1/reports/uptime').set(auth('viewer'))).status, 200);
  const csv = await request(app).get('/api/v1/reports/export?type=alerts').set(auth('engineer'));
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /machine_code/);
});

test('audit trail records actions and is admin-only', async () => {
  assert.equal((await request(app).get('/api/v1/admin/audit-logs').set(auth('engineer'))).status, 403);
  const r = await request(app).get('/api/v1/admin/audit-logs').set(auth('admin'));
  assert.ok(r.body.data.some((l) => l.action === 'LOGIN'));
  assert.ok(r.body.data.some((l) => l.action === 'LOGIN_FAILED'));
});

test('public feedback and RBAC matrix', async () => {
  const f = await request(app).post('/api/v1/public/feedback').send({ name: 'Visitor', email: 'v@example.com', category: 'Suggestion', message: 'Please add SMS alerts.' });
  assert.equal(f.status, 201);
  assert.match(f.body.reference, /^SMF-/);
  const m = await request(app).get('/api/v1/public/rbac');
  assert.deepEqual(m.body.data.roles, ['ADMIN', 'ENGINEER', 'VIEWER']);
});

test('refresh token rotation and logout', async () => {
  const c = await request(app).get('/api/v1/auth/captcha');
  const agent = request.agent(app);
  const l = await agent.post('/api/v1/auth/login').send({ email: 'viewer@smengineers.demo', password: 'Viewer@123', captchaId: c.body.id, captchaAnswer: captcha._answer(c.body.id) });
  assert.equal(l.status, 200);
  const cookie = l.headers['set-cookie'][0].split(';')[0];
  const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
  assert.equal(r1.status, 200);
  const r2 = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie); // reused old token
  assert.equal(r2.status, 401);
});
