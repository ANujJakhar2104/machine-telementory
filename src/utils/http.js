class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg, details);
const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
const forbidden = (msg = 'You do not have permission to perform this action') => new HttpError(403, msg);

/**
 * Tiny schema validator. Spec: { field: { type, required, min, max, maxLen, enum, pattern } }
 * Returns a cleaned object containing only declared fields.
 */
function validate(body, spec, { partial = false } = {}) {
  const out = {};
  const errors = [];
  const src = body && typeof body === 'object' ? body : {};
  for (const [key, rule] of Object.entries(spec)) {
    let v = src[key];
    if (v === undefined || v === null || v === '') {
      if (rule.required && !partial) errors.push(`${key} is required`);
      continue;
    }
    if (rule.type === 'number' || rule.type === 'int') {
      v = Number(v);
      if (!Number.isFinite(v)) { errors.push(`${key} must be a number`); continue; }
      if (rule.type === 'int' && !Number.isInteger(v)) { errors.push(`${key} must be an integer`); continue; }
      if (rule.min !== undefined && v < rule.min) errors.push(`${key} must be ≥ ${rule.min}`);
      if (rule.max !== undefined && v > rule.max) errors.push(`${key} must be ≤ ${rule.max}`);
    } else if (rule.type === 'bool') {
      v = v === true || v === 'true' || v === 1 || v === '1';
    } else {
      v = String(v).trim();
      if (rule.maxLen && v.length > rule.maxLen) errors.push(`${key} must be at most ${rule.maxLen} characters`);
      if (rule.minLen && v.length < rule.minLen) errors.push(`${key} must be at least ${rule.minLen} characters`);
      if (rule.pattern && !rule.pattern.test(v)) errors.push(rule.patternMsg || `${key} has an invalid format`);
    }
    if (rule.enum && !rule.enum.includes(v)) errors.push(`${key} must be one of ${rule.enum.join(', ')}`);
    out[key] = v;
  }
  if (errors.length) throw badRequest('Validation failed', errors);
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STRONG_PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,64}$/;

function idParam(req, name = 'id') {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(`Invalid ${name}`);
  return id;
}

function paging(q, { defaultLimit = 50, maxLimit = 500 } = {}) {
  const limit = Math.min(Math.max(Number(q.limit) || defaultLimit, 1), maxLimit);
  const page = Math.max(Number(q.page) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

module.exports = { HttpError, badRequest, notFound, forbidden, validate, EMAIL, STRONG_PASSWORD, idParam, paging };
