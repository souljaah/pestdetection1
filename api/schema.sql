PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  spray_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (spray_status IN ('ready', 'spraying', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cameras (
  id INTEGER PRIMARY KEY,
  zone_id INTEGER NOT NULL UNIQUE REFERENCES zones(id) ON DELETE CASCADE,
  camera_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'offline')),
  signal TEXT NOT NULL DEFAULT 'none'
    CHECK (signal IN ('strong', 'medium', 'weak', 'none')),
  ip_address TEXT,
  frame_rate REAL,
  resolution TEXT,
  stream_url TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  camera_id INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
  pest_class TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'pending', 'false_positive')),
  box_x REAL, box_y REAL, box_w REAL, box_h REAL,
  detected_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS spray_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE RESTRICT,
  trigger TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK (duration BETWEEN 1 AND 30),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'failed', 'cancelled')),
  activated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  threshold INTEGER NOT NULL DEFAULT 85 CHECK (threshold BETWEEN 50 AND 99),
  spray_duration INTEGER NOT NULL DEFAULT 5 CHECK (spray_duration BETWEEN 1 AND 30),
  auto_spray INTEGER NOT NULL DEFAULT 1 CHECK (auto_spray IN (0, 1)),
  notifications INTEGER NOT NULL DEFAULT 1 CHECK (notifications IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Live Monitoring sessions recorded by the API (files live in instance/recordings/).
CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  camera_id INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
  stream_url TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'mjpeg' CHECK (kind IN ('mjpeg', 'video')),
  content_type TEXT,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'recording'
    CHECK (status IN ('recording', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds REAL NOT NULL DEFAULT 0,
  frame_count INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recordings_started_at ON recordings(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_zone_time ON recordings(zone_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_detections_detected_at ON detections(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_detections_zone_time ON detections(zone_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_detections_status ON detections(status);
CREATE INDEX IF NOT EXISTS idx_sprays_activated_at ON spray_logs(activated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sprays_zone_time ON spray_logs(zone_id, activated_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_occurred_at ON system_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_zone_time ON system_events(zone_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts(acknowledged, created_at DESC);

INSERT OR IGNORE INTO zones (id, name) VALUES
  (1, 'Zone 1'), (2, 'Zone 2'), (3, 'Zone 3'), (4, 'Zone 4');

INSERT OR IGNORE INTO cameras (id, zone_id, camera_code, name) VALUES
  (1, 1, 'CAM-01', 'CAMERA 01'),
  (2, 2, 'CAM-02', 'CAMERA 02'),
  (3, 3, 'CAM-03', 'CAMERA 03'),
  (4, 4, 'CAM-04', 'CAMERA 04');

INSERT OR IGNORE INTO system_settings
  (id, threshold, spray_duration, auto_spray, notifications)
VALUES (1, 85, 5, 1, 1);
