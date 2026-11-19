const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { can } = require('../rbac');
const { HttpError } = require('../utils/http');

function verifyAccessToken(token) {
  const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  if (payload.typ !== 'access') throw new Error('wrong token type');
  return payload;
}

function authenticate(req, _res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Login required'));
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return next(new HttpError(401, 'Session expired or invalid token'));
  }
  // Re-check the account on every request so deactivation / role changes apply immediately.
  const user = db.get('SELECT id, name, email, role, is_active FROM users WHERE id = ?', payload.sub);
  if (!user || !user.is_active) return next(new HttpError(401, 'Account is disabled'));
  req.user = user;
  next();
}

function authorize(...permissions) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Login required'));
    const ok = permissions.some((p) => can(req.user.role, p));
    if (!ok) return next(new HttpError(403, 'You do not have permission to perform this action'));
    next();
  };
}

module.exports = { authenticate, authorize, verifyAccessToken };
