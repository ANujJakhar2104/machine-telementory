// OpenAPI 3 description served at /api-docs (Swagger UI).
const bearer = [{ bearerAuth: [] }];
const id = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const ok = { 200: { description: 'OK' }, 401: { description: 'Login required' }, 403: { description: 'Forbidden for your role' } };
const json = (props, required = []) => ({ required: true, content: { 'application/json': { schema: { type: 'object', required, properties: props } } } });

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Machine Telemetry & Predictive Maintenance API',
    version: '1.0.0',
    description: 'REST API of the SM Engineers telemetry portal. Log in via POST /auth/login (fetch a captcha first), then click **Authorize** and paste the accessToken. Live events over Socket.IO: `machine:update`, `alert:new`, `alert:update`, `ticket:update`.',
  },
  servers: [{ url: '/api/v1' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  tags: ['Auth', 'Machines', 'Telemetry', 'Alerts', 'Maintenance', 'Rules', 'Reports', 'Users', 'Admin', 'Public'].map((name) => ({ name })),
  paths: {
    '/auth/captcha': { get: { tags: ['Auth'], summary: 'Get a login captcha (SVG + id)', responses: { 200: { description: 'OK' } } } },
    '/auth/login': { post: { tags: ['Auth'], summary: 'Log in, returns a 15-minute access token and sets a refresh cookie',
      requestBody: json({ email: { type: 'string' }, password: { type: 'string' }, captchaId: { type: 'string' }, captchaAnswer: { type: 'string' } }, ['email', 'password', 'captchaId', 'captchaAnswer']),
      responses: { 200: { description: 'OK' }, 401: { description: 'Invalid credentials' }, 429: { description: 'Too many attempts' } } } },
    '/auth/refresh': { post: { tags: ['Auth'], summary: 'Rotate refresh cookie and get a new access token', responses: { 200: { description: 'OK' }, 401: { description: 'Session expired' } } } },
    '/auth/logout': { post: { tags: ['Auth'], summary: 'Revoke the refresh token', responses: { 200: { description: 'OK' } } } },
    '/auth/me': { get: { tags: ['Auth'], security: bearer, summary: 'Current user with permissions', responses: ok } },
    '/auth/change-password': { post: { tags: ['Auth'], security: bearer, summary: 'Change own password', requestBody: json({ currentPassword: { type: 'string' }, newPassword: { type: 'string' } }), responses: ok } },

    '/machines': {
      get: { tags: ['Machines'], security: bearer, summary: 'List machines with latest values and open alerts', responses: ok },
      post: { tags: ['Machines'], security: bearer, summary: 'Create machine (Admin) – sensors and default rules are added automatically',
        requestBody: json({ machine_code: { type: 'string', example: 'CNC-07' }, name: { type: 'string' }, type: { type: 'string' }, location: { type: 'string' }, status: { type: 'string', enum: ['RUNNING', 'IDLE', 'MAINTENANCE', 'OFFLINE'] } }, ['machine_code', 'name', 'type', 'location']), responses: ok },
    },
    '/machines/{id}': {
      get: { tags: ['Machines'], security: bearer, parameters: [id], summary: 'Machine detail with sensors', responses: ok },
      patch: { tags: ['Machines'], security: bearer, parameters: [id], summary: 'Update machine (Admin)', requestBody: json({ name: { type: 'string' }, location: { type: 'string' }, status: { type: 'string' } }), responses: ok },
      delete: { tags: ['Machines'], security: bearer, parameters: [id], summary: 'Delete machine (Admin)', responses: ok },
    },
    '/machines/{id}/health': { get: { tags: ['Machines'], security: bearer, parameters: [id], summary: 'Health score (0-100) and band', responses: ok } },
    '/machines/{id}/simulate-fault': { post: { tags: ['Machines'], security: bearer, parameters: [id], summary: 'Demo: start a degradation pattern (Admin)', requestBody: json({ sensor: { type: 'string', enum: ['vibration', 'temperature'] } }), responses: ok } },
    '/machines/{id}/latest': { get: { tags: ['Telemetry'], security: bearer, parameters: [id], summary: 'Latest value per sensor (served from memory cache)', responses: ok } },
    '/machines/{id}/readings': { get: { tags: ['Telemetry'], security: bearer, summary: 'History (raw ≤ 6 h, hourly summary beyond)',
      parameters: [id, { name: 'minutes', in: 'query', schema: { type: 'integer', default: 30 } }, { name: 'sensor', in: 'query', schema: { type: 'string', enum: ['temperature', 'vibration', 'load'] } }], responses: ok } },
    '/telemetry': { post: { tags: ['Telemetry'], summary: 'Device ingestion (header x-device-key)',
      parameters: [{ name: 'x-device-key', in: 'header', required: true, schema: { type: 'string' } }],
      requestBody: json({ machine_code: { type: 'string', example: 'CNC-01' }, ts: { type: 'integer' }, temperature: { type: 'number' }, vibration: { type: 'number' }, load: { type: 'number' } }, ['machine_code']),
      responses: { 202: { description: 'Accepted' }, 401: { description: 'Invalid device key' } } } },

    '/alerts': { get: { tags: ['Alerts'], security: bearer, summary: 'List alerts',
      parameters: ['status', 'severity', 'machineId', 'page', 'limit'].map((n) => ({ name: n, in: 'query', schema: { type: 'string' } })), responses: ok } },
    '/alerts/{id}/ack': { patch: { tags: ['Alerts'], security: bearer, parameters: [id], summary: 'Acknowledge alert (Engineer/Admin)', responses: ok } },
    '/alerts/{id}/resolve': { patch: { tags: ['Alerts'], security: bearer, parameters: [id], summary: 'Resolve alert (Engineer/Admin)', responses: ok } },

    '/tickets': {
      get: { tags: ['Maintenance'], security: bearer, summary: 'List tickets', parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }, { name: 'mine', in: 'query', schema: { type: 'boolean' } }], responses: ok },
      post: { tags: ['Maintenance'], security: bearer, summary: 'Create ticket (Engineer/Admin)',
        requestBody: json({ machine_id: { type: 'integer' }, alert_id: { type: 'integer' }, title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] }, assigned_to: { type: 'integer' }, due_date: { type: 'string', format: 'date' } }, ['machine_id', 'title']), responses: ok },
    },
    '/tickets/{id}/status': { patch: { tags: ['Maintenance'], security: bearer, parameters: [id], summary: 'Update status (assignee) or reassign (Admin)',
      requestBody: json({ status: { type: 'string', enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] }, assigned_to: { type: 'integer' } }), responses: ok } },

    '/rules': { get: { tags: ['Rules'], security: bearer, summary: 'Alert rules (Engineer/Admin)', responses: ok } },
    '/rules/{id}': { patch: { tags: ['Rules'], security: bearer, parameters: [id], summary: 'Edit threshold / severity / cooldown',
      requestBody: json({ threshold: { type: 'number' }, severity: { type: 'string' }, consecutive: { type: 'integer' }, cooldown_s: { type: 'integer' }, enabled: { type: 'boolean' } }), responses: ok } },

    '/reports/uptime': { get: { tags: ['Reports'], security: bearer, summary: 'Uptime & alert counts per machine', parameters: [{ name: 'period', in: 'query', schema: { type: 'string', enum: ['daily', 'weekly'] } }], responses: ok } },
    '/reports/summary': { get: { tags: ['Reports'], security: bearer, summary: 'Daily / weekly summary', parameters: [{ name: 'period', in: 'query', schema: { type: 'string', enum: ['daily', 'weekly'] } }], responses: ok } },
    '/reports/export': { get: { tags: ['Reports'], security: bearer, summary: 'CSV export (Engineer/Admin)',
      parameters: [{ name: 'type', in: 'query', schema: { type: 'string', enum: ['readings', 'alerts', 'tickets'] } }, { name: 'period', in: 'query', schema: { type: 'string', enum: ['daily', 'weekly'] } }], responses: ok } },

    '/users': {
      get: { tags: ['Users'], security: bearer, summary: 'List users (Admin)', responses: ok },
      post: { tags: ['Users'], security: bearer, summary: 'Create user (Admin)', requestBody: json({ name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', enum: ['ADMIN', 'ENGINEER', 'VIEWER'] }, password: { type: 'string' } }), responses: ok },
    },
    '/users/{id}': { patch: { tags: ['Users'], security: bearer, parameters: [id], summary: 'Change role / activate / reset password (Admin)', requestBody: json({ role: { type: 'string' }, is_active: { type: 'boolean' }, password: { type: 'string' } }), responses: ok } },
    '/admin/audit-logs': { get: { tags: ['Admin'], security: bearer, summary: 'Audit trail (Admin)', responses: ok } },
    '/admin/notifications': { get: { tags: ['Admin'], security: bearer, summary: 'Email outbox (Admin)', responses: ok } },
    '/admin/system': { get: { tags: ['Admin'], security: bearer, summary: 'Ingestion counters & system info (Admin)', responses: ok } },
    '/dashboard': { get: { tags: ['Machines'], security: bearer, summary: 'Dashboard KPIs', responses: ok } },
    '/health': { get: { tags: ['Public'], summary: 'Health-check for load balancers', responses: { 200: { description: 'OK' } } } },
    '/public/stats': { get: { tags: ['Public'], summary: 'Public aggregate figures', responses: { 200: { description: 'OK' } } } },
    '/public/rbac': { get: { tags: ['Public'], summary: 'Role-permission matrix', responses: { 200: { description: 'OK' } } } },
    '/public/feedback': { post: { tags: ['Public'], summary: 'Submit feedback / grievance', requestBody: json({ name: { type: 'string' }, email: { type: 'string' }, category: { type: 'string' }, message: { type: 'string' } }), responses: { 201: { description: 'Created' } } } },
  },
};
