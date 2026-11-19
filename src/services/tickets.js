const db = require('../db');
const realtime = require('./realtime');
const notifier = require('./notifier');

function openTicketFor(machineId) {
  return db.get("SELECT id FROM maintenance_tickets WHERE machine_id = ? AND status IN ('OPEN','IN_PROGRESS') LIMIT 1", machineId);
}

function leastLoadedEngineer() {
  return db.get(`SELECT u.id, u.email, u.name FROM users u
    LEFT JOIN maintenance_tickets t ON t.assigned_to = u.id AND t.status IN ('OPEN','IN_PROGRESS')
    WHERE u.role = 'ENGINEER' AND u.is_active = 1
    GROUP BY u.id ORDER BY COUNT(t.id) ASC, u.id ASC LIMIT 1`);
}

function create({ machineId, alertId = null, title, description = null, priority = 'MEDIUM', assignedTo = null, createdBy = null, dueDate = null }) {
  const now = Date.now();
  const r = db.run(`INSERT INTO maintenance_tickets
    (alert_id, machine_id, title, description, priority, assigned_to, created_by, status, due_date, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?, 'OPEN', ?,?,?)`,
  alertId, machineId, title, description, priority, assignedTo, createdBy, dueDate, now, now);
  const ticket = getById(r.id);
  const { assignee_email: _hidden, ...publicTicket } = ticket;
  realtime.emit('ticket:update', publicTicket);
  if (ticket.assignee_email) {
    notifier.email([ticket.assignee_email], `[Ticket #${ticket.id}] ${ticket.title}`,
      `A maintenance ticket for ${ticket.machine_code} has been assigned to you. Priority: ${ticket.priority}. Due: ${ticket.due_date || '-'}.`);
  }
  return ticket;
}

/** Auto-ticket used by the alert engine and the health monitor. One open ticket per machine at most. */
function ensureForMachine(machineId, alertId, title, description) {
  if (openTicketFor(machineId)) return null;
  const eng = leastLoadedEngineer();
  const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  return create({ machineId, alertId, title, description, priority: 'HIGH', assignedTo: eng?.id ?? null, dueDate: due });
}

function getById(id) {
  return db.get(`SELECT t.*, m.machine_code, m.name AS machine_name,
      a.name AS assignee_name, a.email AS assignee_email, c.name AS creator_name
    FROM maintenance_tickets t
    JOIN machines m ON m.id = t.machine_id
    LEFT JOIN users a ON a.id = t.assigned_to
    LEFT JOIN users c ON c.id = t.created_by
    WHERE t.id = ?`, id);
}

module.exports = { create, ensureForMachine, getById, openTicketFor, leastLoadedEngineer };
