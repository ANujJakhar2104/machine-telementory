const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const captcha = require('../utils/captcha');
const { audit } = require('../utils/audit');
const { permissionsFor } = require('../rbac');
const { authenticate } = require('../middleware/auth');
const { HttpError, validate, EMAIL, STRONG_PASSWORD } = require('../utils/http');

const router = express.Router();
const COOKIE = 'sm_rt';
const cookieOpts = () => ({
  httpOnly: true, secure: config.isProd, sameSite: 'strict', path: '/api/v1/auth',
  maxAge: config.refreshTokenDays * 86400000,
});
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: config.isTest ? 1000 : 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
});

function profile(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, last_login_at: u.last_login_at, permissions: permissionsFor(u.role) };
}

function issueTokens(res, user) {
  const accessToken = jwt.sign({ sub: user.id, role: user.role, typ: 'access' }, config.jwtSecret,
    { expiresIn: config.accessTokenTtl, algorithm: 'HS256' });
  const refresh = crypto.randomBytes(48).toString('base64url');
  db.run('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)',
    user.id, sha256(refresh), Date.now() + config.refreshTokenDays * 86400000);
  res.cookie(COOKIE, refresh, cookieOpts());
  return accessToken;
}

router.get('/captcha', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(captcha.create());
});

router.post('/login', loginLimiter, async (req, res) => {
  const body = validate(req.body, {
    email: { required: true, maxLen: 120, pattern: EMAIL, patternMsg: 'Enter a valid email address' },
    password: { required: true, maxLen: 128 },
    captchaId: { required: true, maxLen: 64 },
    captchaAnswer: { required: true, maxLen: 8 },
  });
  if (!captcha.verify(body.captchaId, body.captchaAnswer)) throw new HttpError(400, 'Incorrect captcha. Please try again.');
  const user = db.get('SELECT * FROM users WHERE email = ?', body.email);
  const ok = user && user.is_active && (await bcrypt.compare(body.password, user.password_hash));
  if (!ok) {
    audit({ ip: req.ip, user: user ? { id: user.id } : null }, 'LOGIN_FAILED', 'users', user?.id ?? null, { email: body.email });
    throw new HttpError(401, 'Invalid email or password');
  }
  const previousLogin = user.last_login_at;
  db.run('UPDATE users SET last_login_at = ? WHERE id = ?', Date.now(), user.id);
  const accessToken = issueTokens(res, user);
  audit({ ip: req.ip, user }, 'LOGIN', 'users', user.id);
  res.json({ accessToken, user: profile({ ...user, last_login_at: previousLogin }) });
});

router.post('/refresh', (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (!token) throw new HttpError(401, 'No session');
  const row = db.get('SELECT * FROM refresh_tokens WHERE token_hash = ?', sha256(token));
  if (!row || row.revoked || row.expires_at < Date.now()) {
    if (row && row.revoked) {
      // Re-use of a rotated token: revoke the whole family for safety.
      db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', row.user_id);
    }
    res.clearCookie(COOKIE, { path: '/api/v1/auth' });
    throw new HttpError(401, 'Session expired. Please log in again.');
  }
  const user = db.get('SELECT * FROM users WHERE id = ?', row.user_id);
  if (!user || !user.is_active) throw new HttpError(401, 'Account is disabled');
  db.run('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', row.id); // rotation
  const accessToken = issueTokens(res, user);
  res.json({ accessToken, user: profile(user) });
});

router.post('/logout', (req, res) => {
  const token = req.cookies?.[COOKIE];
  if (token) db.run('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?', sha256(token));
  res.clearCookie(COOKIE, { path: '/api/v1/auth' });
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  res.json({ user: profile(u) });
});

router.post('/change-password', authenticate, async (req, res) => {
  const body = validate(req.body, {
    currentPassword: { required: true, maxLen: 128 },
    newPassword: { required: true, pattern: STRONG_PASSWORD, patternMsg: 'New password must be 8–64 characters with upper-case, lower-case, a digit and a symbol' },
  });
  const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!(await bcrypt.compare(body.currentPassword, u.password_hash))) throw new HttpError(400, 'Current password is incorrect');
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', await bcrypt.hash(body.newPassword, 10), u.id);
  db.run('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', u.id); // sign out every other session
  audit(req, 'PASSWORD_CHANGED', 'users', u.id);
  const accessToken = issueTokens(res, u); // keep this session alive with a fresh token pair
  res.json({ ok: true, accessToken, user: profile(u) });
});

module.exports = router;
