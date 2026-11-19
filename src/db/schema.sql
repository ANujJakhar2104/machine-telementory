PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role          TEXT NOT NULL CHECK (role IN ('ADMIN','ENGINEER','VIEWER')),
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS machines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_code  TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  location      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','IDLE','MAINTENANCE','OFFLINE')),
  health_score  REAL NOT NULL DEFAULT 100,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sensors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id  INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('temperature','vibration','load')),
  unit        TEXT NOT NULL,
  min_val     REAL NOT NULL,
  max_val     REAL NOT NULL,
  UNIQUE (machine_id, type)
);

-- Fastest-growing table: composite unique key doubles as the time-range index and drops duplicate deliveries.
CREATE TABLE IF NOT EXISTS readings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  value       REAL NOT NULL,
  recorded_at INTEGER NOT NULL,
  UNIQUE (sensor_id, recorded_at)
);

CREATE TABLE IF NOT EXISTS readings_hourly (
  sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  hour_start  INTEGER NOT NULL,
  avg_val     REAL NOT NULL,
  min_val     REAL NOT NULL,
  max_val     REAL NOT NULL,
  samples     INTEGER NOT NULL,
  PRIMARY KEY (sensor_id, hour_start)
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor_id   INTEGER NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  operator    TEXT NOT NULL CHECK (operator IN ('>','<','ZSCORE')),
  threshold   REAL NOT NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  consecutive INTEGER NOT NULL DEFAULT 1,
  cooldown_s  INTEGER NOT NULL DEFAULT 300,
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id         INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
  machine_id      INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  sensor_id       INTEGER REFERENCES sensors(id) ON DELETE SET NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  message         TEXT NOT NULL,
  value           REAL,
  raised_at       INTEGER NOT NULL,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at INTEGER,
  resolved_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, raised_at);
CREATE INDEX IF NOT EXISTS idx_alerts_machine ON alerts(machine_id, raised_at);

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id    INTEGER REFERENCES alerts(id) ON DELETE SET NULL,
  machine_id  INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  priority    TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW','MEDIUM','HIGH')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
  due_date    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  table_name  TEXT,
  record_id   INTEGER,
  details     TEXT,
  ip          TEXT,
  changed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(changed_at);

-- Supporting tables
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  INTEGER NOT NULL,
  revoked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel     TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notices (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  body         TEXT,
  is_new       INTEGER NOT NULL DEFAULT 1,
  published_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  category    TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','REVIEWED')),
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
