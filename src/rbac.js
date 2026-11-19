// Central role -> permission map. Every protected route checks a permission, never a role name,
// so roles can be re-shaped here without touching route code.

const ROLES = ['ADMIN', 'ENGINEER', 'VIEWER'];

const PERMISSION_LABELS = {
  'dashboard:view': 'View dashboard & live machine status',
  'machines:view': 'View machines, sensors & health score',
  'machines:manage': 'Add, edit and delete machines',
  'telemetry:view': 'View sensor readings & charts',
  'alerts:view': 'View alerts',
  'alerts:ack': 'Acknowledge / resolve alerts',
  'rules:view': 'View alert rules',
  'rules:edit': 'Edit alert rules & thresholds',
  'tickets:view': 'View maintenance tickets',
  'tickets:create': 'Create maintenance tickets',
  'tickets:update': 'Update status of own (assigned) tickets',
  'tickets:assign': 'Assign / update any ticket',
  'reports:view': 'View uptime & summary reports',
  'reports:export': 'Export reports as CSV',
  'simulator:control': 'Inject faults in the machine simulator (demo)',
  'notices:manage': 'Publish "What\'s New" notices',
  'feedback:view': 'Read public feedback / grievances',
  'users:manage': 'Manage user accounts & roles',
  'audit:view': 'View audit trail',
};

const VIEWER = [
  'dashboard:view', 'machines:view', 'telemetry:view', 'alerts:view', 'tickets:view', 'reports:view',
];

const ENGINEER = [
  ...VIEWER, 'alerts:ack', 'rules:view', 'rules:edit', 'tickets:create', 'tickets:update', 'reports:export',
];

const ADMIN = Object.keys(PERMISSION_LABELS);

const ROLE_PERMISSIONS = { ADMIN, ENGINEER, VIEWER };

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function can(role, permission) {
  return permissionsFor(role).includes(permission);
}

function matrix() {
  return Object.entries(PERMISSION_LABELS).map(([key, label]) => ({
    key,
    label,
    roles: Object.fromEntries(ROLES.map((r) => [r, can(r, key)])),
  }));
}

module.exports = { ROLES, PERMISSION_LABELS, permissionsFor, can, matrix };
