const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { ROLES } = require('../rbac');
const { authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { validate, idParam, notFound, badRequest, HttpError, EMAIL, STRONG_PASSWORD } = require('../utils/http');

const router = express.Router();
const COLS = 'id, name, email, role, is_active, last_login_at, created_at';

// Minimal list of assignable staff, needed by engineers too when creating tickets.
router.get('/assignees', authorize('tickets:create', 'tickets:assign'), (_req, res) => {
  res.json({ data: db.all("SELECT id, name, role FROM users WHERE is_active = 1 AND role IN ('ENGINEER','ADMIN') ORDER BY name") });
});

router.use(authorize('users:manage'));

router.get('/', (_req, res) => {
  res.json({ data: db.all(`SELECT ${COLS} FROM users ORDER BY role, name`) });
});

router.post('/', async (req, res) => {
  const body = validate(req.body, {
    name: { required: true, maxLen: 80, minLen: 2 },
    email: { required: true, maxLen: 120, pattern: EMAIL, patternMsg: 'Enter a valid email address' },
    role: { required: true, enum: ROLES },
    password: { required: true, pattern: STRONG_PASSWORD, patternMsg: 'Password must be 8–64 characters with upper-case, lower-case, a digit and a symbol' },
  });
  if (db.get('SELECT id FROM users WHERE email = ?', body.email)) throw new HttpError(409, 'A user with this email already exists');
  const r = db.run('INSERT INTO users (name, email, role, password_hash, created_at) VALUES (?,?,?,?,?)',
    body.name, body.email, body.role, await bcrypt.hash(body.password, 10), Date.now());
  audit(req, 'CREATE', 'users', r.id, { email: body.email, role: body.role });
  res.status(201).json({ data: db.get(`SELECT ${COLS} FROM users WHERE id = ?`, r.id) });
});

router.patch('/:id', async (req, res) => {
  const id = idParam(req);
  const u = db.get('SELECT * FROM users WHERE id = ?', id);
  if (!u) throw notFound('User');
  const body = validate(req.body, {
    name: { maxLen: 80, minLen: 2 },
    role: { enum: ROLES },
    is_active: { type: 'bool' },
    password: { pattern: STRONG_PASSWORD, patternMsg: 'Password must be 8–64 characters with upper-case, lower-case, a digit and a symbol' },
  }, { partial: true });
  if (!Object.keys(body).length) throw badRequest('Nothing to update');
  if (id === req.user.id && (body.role && body.role !== 'ADMIN' || body.is_active === false)) {
    throw badRequest('You cannot remove your own admin access');
  }
  const removingAdmin = u.role === 'ADMIN' && ((body.role && body.role !== 'ADMIN') || body.is_active === false);
  if (removingAdmin && db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'ADMIN' AND is_active = 1").n <= 1) {
    throw badRequest('At least one active admin is required');
  }
  const n = { ...u, ...body };
  db.run('UPDATE users SET name = ?, role = ?, is_active = ? WHERE id = ?', n.name, n.role, n.is_active ? 1 : 0, id);
  if (body.password) db.run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(body.password, 10), id);
  if (body.password || body.is_active === false || body.role) db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', id);
  const { password, ...logged } = body;
  audit(req, 'UPDATE', 'users', id, { ...logged, ...(password ? { password: 'reset' } : {}) });
  res.json({ data: db.get(`SELECT ${COLS} FROM users WHERE id = ?`, id) });
});

module.exports = router;
