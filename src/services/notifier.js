const db = require('../db');
const logger = require('../utils/logger');

/**
 * Email notifications are written to an outbox table (visible to Admins in the portal) and logged.
 * Plugging in a real SMTP transport only requires changing deliver().
 */
function deliver(n) {
  logger.info(`[email] to=${n.recipient} subject="${n.subject}"`);
}

function email(recipients, subject, body) {
  const now = Date.now();
  for (const r of recipients) {
    const n = { channel: 'EMAIL', recipient: r, subject, body };
    db.run('INSERT INTO notifications (channel, recipient, subject, body, created_at) VALUES (?,?,?,?,?)',
      n.channel, n.recipient, n.subject, n.body, now);
    deliver(n);
  }
}

function emailRoles(roles, subject, body) {
  const placeholders = roles.map(() => '?').join(',');
  const rows = db.all(`SELECT email FROM users WHERE is_active = 1 AND role IN (${placeholders})`, ...roles);
  email(rows.map((r) => r.email), subject, body);
}

module.exports = { email, emailRoles };
