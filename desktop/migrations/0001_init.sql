CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','dispatcher','monitor')),
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
  id      TEXT PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  name    TEXT NOT NULL,
  x       REAL NOT NULL,
  y       REAL NOT NULL,
  status  TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  remark  TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  id              TEXT PRIMARY KEY,
  from_node_id    TEXT NOT NULL REFERENCES nodes(id),
  to_node_id      TEXT NOT NULL REFERENCES nodes(id),
  length_m        REAL NOT NULL CHECK (length_m > 0),
  speed_limit_mps REAL CHECK (speed_limit_mps IS NULL OR speed_limit_mps > 0),
  status          TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  remark          TEXT,
  UNIQUE (from_node_id, to_node_id),
  CHECK (from_node_id <> to_node_id)
);

CREATE TABLE IF NOT EXISTS sites (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('depot','dock','charging','gate','other')),
  node_id    TEXT REFERENCES nodes(id),
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  status     TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled')),
  remark     TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE IF NOT EXISTS vehicles (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  type              TEXT NOT NULL CHECK (type IN ('agv','carrier','drone','other')),
  status            TEXT NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle','reserved','busy','charging','offline','fault','disabled')),
  capacity_kg       REAL NOT NULL CHECK (capacity_kg > 0),
  load_kg           REAL NOT NULL DEFAULT 0 CHECK (load_kg >= 0),
  max_speed_mps     REAL NOT NULL CHECK (max_speed_mps > 0),
  battery           REAL NOT NULL DEFAULT 100 CHECK (battery BETWEEN 0 AND 100),
  x                 REAL NOT NULL,
  y                 REAL NOT NULL,
  current_node_id   TEXT REFERENCES nodes(id),
  online            INTEGER NOT NULL DEFAULT 1 CHECK (online IN (0,1)),
  last_heartbeat_at TEXT,
  remark            TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS restrictions (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('node','edge')),
  target_id    TEXT NOT NULL,
  start_at     TEXT,
  end_at       TEXT,
  vehicle_type TEXT CHECK (vehicle_type IS NULL OR vehicle_type IN ('agv','carrier','drone','other')),
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired')),
  created_at   TEXT NOT NULL,
  created_by   TEXT,
  CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at)
);

CREATE TABLE IF NOT EXISTS task_templates (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  default_cargo_kg    REAL CHECK (default_cargo_kg IS NULL OR default_cargo_kg >= 0),
  time_window_minutes INTEGER CHECK (time_window_minutes IS NULL OR time_window_minutes > 0),
  from_site_type      TEXT CHECK (from_site_type IS NULL OR from_site_type IN ('depot','dock','charging','gate','other')),
  to_site_type        TEXT CHECK (to_site_type IS NULL OR to_site_type IN ('depot','dock','charging','gate','other')),
  remark              TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,
  template_id         TEXT REFERENCES task_templates(id),
  title               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','pending','assigned','running','paused','finished','cancelled','failed')),
  priority            TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  cargo_kg            REAL NOT NULL CHECK (cargo_kg >= 0),
  cargo_desc          TEXT,
  from_site_id        TEXT NOT NULL REFERENCES sites(id),
  to_site_id          TEXT NOT NULL REFERENCES sites(id),
  time_window_start   TEXT,
  time_window_end     TEXT,
  assigned_vehicle_id TEXT REFERENCES vehicles(id),
  plan_id             TEXT,
  progress            REAL NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  cancel_reason       TEXT,
  fail_reason         TEXT,
  submitted_at        TEXT,
  assigned_at         TEXT,
  started_at          TEXT,
  finished_at         TEXT,
  cancelled_at        TEXT,
  failed_at           TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  created_by          TEXT,
  updated_by          TEXT,
  CHECK (time_window_end IS NULL OR time_window_start IS NULL OR time_window_end > time_window_start),
  CHECK (from_site_id <> to_site_id)
);

CREATE TABLE IF NOT EXISTS routes (
  id            TEXT PRIMARY KEY,
  task_id       TEXT REFERENCES tasks(id),
  algorithm     TEXT NOT NULL CHECK (algorithm IN ('aStar','dijkstra')),
  from_node_id  TEXT NOT NULL REFERENCES nodes(id),
  to_node_id    TEXT NOT NULL REFERENCES nodes(id),
  via_node_ids  TEXT NOT NULL DEFAULT '[]',
  node_ids      TEXT NOT NULL,
  edge_ids      TEXT NOT NULL,
  distance_m    REAL NOT NULL CHECK (distance_m >= 0),
  duration_s    REAL NOT NULL CHECK (duration_s >= 0),
  cost_detail   TEXT NOT NULL DEFAULT '{}',
  warnings      TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  created_by    TEXT
);

CREATE TABLE IF NOT EXISTS dispatch_plans (
  id             TEXT PRIMARY KEY,
  request_id     TEXT NOT NULL,
  task_id        TEXT NOT NULL REFERENCES tasks(id),
  vehicle_id     TEXT NOT NULL REFERENCES vehicles(id),
  strategy       TEXT NOT NULL CHECK (strategy IN ('greedy','hungarian','genetic')),
  status         TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','superseded','cancelled')),
  cost           REAL NOT NULL DEFAULT 0,
  cost_detail    TEXT NOT NULL DEFAULT '{}',
  route_id       TEXT REFERENCES routes(id),
  occupied_from  TEXT NOT NULL,
  occupied_to    TEXT NOT NULL,
  reject_reason  TEXT,
  snapshot_id    TEXT,
  applied_at     TEXT,
  applied_by     TEXT,
  created_at     TEXT NOT NULL,
  CHECK (occupied_to > occupied_from)
);

CREATE TABLE IF NOT EXISTS dispatch_logs (
  id              TEXT PRIMARY KEY,
  request_id      TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('preview','apply','recompute','manual_assign')),
  strategy        TEXT NOT NULL CHECK (strategy IN ('greedy','hungarian','genetic','all')),
  task_ids        TEXT NOT NULL DEFAULT '[]',
  input_snapshot  TEXT,
  output_snapshot TEXT,
  summary         TEXT NOT NULL DEFAULT '{}',
  rejected        TEXT NOT NULL DEFAULT '[]',
  reason          TEXT,
  elapsed_ms      INTEGER NOT NULL DEFAULT 0,
  operator_id     TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('vehicle_offline','task_timeout','task_failed','route_blocked','data_error')),
  level        TEXT NOT NULL CHECK (level IN ('info','warning','critical')),
  object_type  TEXT NOT NULL CHECK (object_type IN ('site','vehicle','task','route','node','edge','user','system','alert','settings')),
  object_id    TEXT,
  message      TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','processing','resolved','archived')),
  dedupe_key   TEXT,
  created_at   TEXT NOT NULL,
  ack_at       TEXT,
  ack_by       TEXT,
  resolve_at   TEXT,
  resolve_by   TEXT,
  resolution   TEXT,
  archived_at  TEXT,
  archived_by  TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  ts          TEXT NOT NULL,
  actor_id    TEXT,
  actor_name  TEXT,
  role        TEXT,
  module      TEXT NOT NULL,
  action      TEXT NOT NULL,
  object_type TEXT,
  object_id   TEXT,
  before      TEXT,
  after       TEXT,
  result      TEXT NOT NULL CHECK (result IN ('success','failure')),
  message     TEXT,
  error_code  TEXT,
  cost_ms     INTEGER NOT NULL DEFAULT 0,
  trace_id    TEXT
);

CREATE TABLE IF NOT EXISTS event_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  ts          TEXT NOT NULL,
  type        TEXT NOT NULL,
  object_type TEXT,
  object_id   TEXT,
  payload     TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS vehicle_tracks (
  id         TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  ts         TEXT NOT NULL,
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  status     TEXT NOT NULL,
  speed_mps  REAL NOT NULL DEFAULT 0,
  task_id    TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status          ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority_window ON tasks(priority, time_window_start);
CREATE INDEX IF NOT EXISTS idx_tasks_vehicle         ON tasks(assigned_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_edges_from            ON edges(from_node_id);
CREATE INDEX IF NOT EXISTS idx_sites_node            ON sites(node_id);
CREATE INDEX IF NOT EXISTS idx_restrictions_target   ON restrictions(type, target_id, status);
CREATE INDEX IF NOT EXISTS idx_plans_request         ON dispatch_plans(request_id);
CREATE INDEX IF NOT EXISTS idx_plans_vehicle_time    ON dispatch_plans(vehicle_id, occupied_from, occupied_to);
CREATE INDEX IF NOT EXISTS idx_plans_task            ON dispatch_plans(task_id, status);
CREATE INDEX IF NOT EXISTS idx_dlogs_request         ON dispatch_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_dlogs_created         ON dispatch_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_status_type    ON alerts(status, type);
CREATE INDEX IF NOT EXISTS idx_alerts_dedupe         ON alerts(dedupe_key, created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_object         ON alerts(object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts              ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor           ON audit_logs(actor_id, ts);
CREATE INDEX IF NOT EXISTS idx_tracks_vehicle_ts     ON vehicle_tracks(vehicle_id, ts);
CREATE INDEX IF NOT EXISTS idx_event_ts              ON event_log(ts);
