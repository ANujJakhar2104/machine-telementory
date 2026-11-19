const express = require('express');
const db = require('../db');
const tickets = require('../services/tickets');
const realtime = require('../services/realtime');
const { can } = require('../rbac');
const { authorize } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { validate, idParam, notFound, badRequest, forbidden, paging } = require('../utils/http');

const router = express.Router();
const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', authorize('tickets:view'), (req, res) => {
  const { limit, offset, page } = paging(req.query);
  const where = [];
  const params = [];
  if (req.query.status) { where.push('t.status = ?'); params.push(String(req.query.status)); }
  if (req.query.mine === 'true') { where.push('t.assigned_to = ?'); params.push(req.user.id); }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM maintenance_tickets t${w}`, ...params).n;
  const data = db.all(`SELECT t.*, m.machine_code, a.name AS assignee_name, c.name AS creator_name
    FROM maintenance_tickets t JOIN machines m ON m.id = t.machine_id
    LEFT JOIN users a ON a.id = t.assigned_to LEFT JOIN users c ON c.id = t.created_by
    ${w} ORDER BY CASE t.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, t.updated_at DESC
    LIMIT ? OFFSET ?`, ...params, limit, offset);
  res.json({ data, page, limit, total });
});

router.get('/:id', authorize('tickets:view'), (req, res) => {
  const t = tickets.getById(idParam(req));
  if (!t) throw notFound('Ticket');
  delete t.assignee_email;
  res.json({ data: t });
});

router.post('/', authorize('tickets:create'), (req, res) => {
  const body = validate(req.body, {
    machine_id: { type: 'int', required: true, min: 1 },
    alert_id: { type: 'int', min: 1 },
    title: { required: true, maxLen: 120, minLen: 4 },
    description: { maxLen: 2000 },
    priority: { enum: ['LOW', 'MEDIUM', 'HIGH'] },
    assigned_to: { type: 'int', min: 1 },
    due_date: { pattern: DATE, patternMsg: 'due_date must be YYYY-MM-DD' },
  });
  if (!db.get('SELECT id FROM machines WHERE id = ?', body.machine_id)) throw badRequest('Unknown machine');
  if (body.alert_id && !db.get('SELECT id FROM alerts WHERE id = ?', body.alert_id)) throw badRequest('Unknown alert');
  let assignee = body.assigned_to;
  if (assignee && !can(req.user.role, 'tickets:assign')) assignee = req.user.id; // engineers can only self-assign
  if (assignee && !db.get("SELECT id FROM users WHERE id = ? AND role IN ('ENGINEER','ADMIN') AND is_active = 1", assignee)) {
    throw badRequest('Tickets can only be assigned to an active engineer or admin');
  }
  if (!assignee && req.user.role === 'ENGINEER') assignee = req.user.id;
  const t = tickets.create({ machineId: body.machine_id, alertId: body.alert_id, title: body.title, description: body.description,
    priority: body.priority || 'MEDIUM', assignedTo: assignee ?? null, createdBy: req.user.id, dueDate: body.due_date });
  audit(req, 'CREATE', 'maintenance_tickets', t.id, { title: t.title });
  delete t.assignee_email;
  res.status(201).json({ data: t });
});

// Engineers may move only tickets assigned to them; admins (tickets:assign) may change any ticket and reassign.
router.patch('/:id/status', authorize('tickets:update', 'tickets:assign'), (req, res) => {
  const id = idParam(req);
  const t = db.get('SELECT * FROM maintenance_tickets WHERE id = ?', id);
  if (!t) throw notFound('Ticket');
  const isManager = can(req.user.role, 'tickets:assign');
  if (!isManager && t.assigned_to !== req.user.id) throw forbidden('You can only update tickets assigned to you');
  const body = validate(req.body, {
    status: { enum: STATUSES },
    assigned_to: { type: 'int', min: 1 },
    priority: { enum: ['LOW', 'MEDIUM', 'HIGH'] },
    due_date: { pattern: DATE, patternMsg: 'due_date must be YYYY-MM-DD' },
  });
  if (!Object.keys(body).length) throw badRequest('Nothing to update');
  if (!isManager && (body.assigned_to || body.priority || body.due_date)) throw forbidden('Only an Admin can reassign or re-prioritise tickets');
  if (!isManager && body.status === 'CLOSED') throw forbidden('Only an Admin can close a ticket');
  if (body.assigned_to && !db.get("SELECT id FROM users WHERE id = ? AND role IN ('ENGINEER','ADMIN') AND is_active = 1", body.assigned_to)) {
    throw badRequest('Tickets can only be assigned to an active engineer or admin');
  }
  const next = { ...t, ...body };
  db.run('UPDATE maintenance_tickets SET status = ?, assigned_to = ?, priority = ?, due_date = ?, updated_at = ? WHERE id = ?',
    next.status, next.assigned_to, next.priority, next.due_date, Date.now(), id);
  if (body.status === 'RESOLVED' && t.alert_id) {
    db.run("UPDATE alerts SET status = 'RESOLVED', resolved_at = ? WHERE id = ? AND status != 'RESOLVED'", Date.now(), t.alert_id);
  }
  audit(req, 'UPDATE', 'maintenance_tickets', id, body);
  const updated = tickets.getById(id);
  delete updated.assignee_email;
  realtime.emit('ticket:update', updated);
  res.json({ data: updated });
});

module.exports = router;
