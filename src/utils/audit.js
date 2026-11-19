const db = require('../db');

function audit(req, action, tableName = null, recordId = null, details = null) {
  db.run('INSERT INTO audit_logs (user_id, action, table_name, record_id, details, ip, changed_at) VALUES (?,?,?,?,?,?,?)',
    req?.user?.id ?? null, action, tableName, recordId, details ? JSON.stringify(details) : null,
    req?.ip ?? null, Date.now());
}

module.exports = { audit };
