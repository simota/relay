-- relay storage schema v6

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type   TEXT    NOT NULL,
  source_id     TEXT    NOT NULL,
  repo          TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'open',
  assignee      TEXT    NOT NULL DEFAULT 'self',
  priority      INTEGER NOT NULL DEFAULT 50,
  prompt        TEXT,
  files         TEXT,             -- JSON array
  context_hash  TEXT,
  session_id    TEXT,
  due_at        TEXT,
  -- wait_on: who the task is currently blocked on. Splits Today into
  -- "self-driven" vs "waiting on someone else" without losing the task.
  -- 'self' (default) | 'reviewer' | 'external' | 'scheduled'
  wait_on       TEXT    NOT NULL DEFAULT 'self',
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  closed_at     TEXT,
  UNIQUE (source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_repo     ON tasks (repo);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks (due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks (priority DESC);

CREATE TABLE IF NOT EXISTS queue_items (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  added_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_queue_items_task  ON queue_items (task_id);
CREATE INDEX IF NOT EXISTS idx_queue_items_added ON queue_items (added_at);

CREATE TABLE IF NOT EXISTS contexts (
  hash          TEXT    PRIMARY KEY,
  repo          TEXT    NOT NULL,
  branch        TEXT    NOT NULL,
  head_sha      TEXT    NOT NULL,
  dirty_files   TEXT    NOT NULL DEFAULT '[]',   -- JSON array
  summary       TEXT    NOT NULL DEFAULT '',
  session_id    TEXT,
  created_at    TEXT    NOT NULL,
  generated_at  TEXT,                            -- when summary was LLM-generated
  model_name    TEXT                             -- model that produced the summary
);

CREATE INDEX IF NOT EXISTS idx_contexts_repo    ON contexts (repo);
CREATE INDEX IF NOT EXISTS idx_contexts_session ON contexts (session_id);

CREATE TABLE IF NOT EXISTS runs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent           TEXT    NOT NULL,
  started_at      TEXT    NOT NULL,
  ended_at        TEXT,
  status          TEXT    NOT NULL DEFAULT 'running',
  output_summary  TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_task ON runs (task_id);

CREATE TABLE IF NOT EXISTS sync_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT    NOT NULL,
  ended_at    TEXT    NOT NULL,
  adapter     TEXT    NOT NULL,
  status      TEXT    NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  error       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_history_adapter_started
  ON sync_history (adapter, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_history_started
  ON sync_history (started_at DESC);

CREATE TABLE IF NOT EXISTS views (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  filter_json  TEXT    NOT NULL,
  pinned       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_views_pinned_created
  ON views (pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS undo_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  inverse TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_undo_log_created_at ON undo_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_undo_log_status_created_at ON undo_log(status, created_at DESC);

-- sessions: first-class store for CLI sessions (Claude / Codex / Gemini /
-- Cursor). Phase A introduces the table + helpers only; adapter ingest and
-- read-path migration land in later phases. UNIQUE on (type, id) keeps cross-
-- CLI id collisions impossible while letting each adapter UPSERT by its own
-- native session id.
CREATE TABLE IF NOT EXISTS sessions (
  id                 TEXT NOT NULL,
  type               TEXT NOT NULL,           -- claude|codex|gemini|cursor
  repo               TEXT,
  cwd                TEXT,
  started_at         TEXT NOT NULL,
  last_active        TEXT NOT NULL,
  message_count      INTEGER NOT NULL DEFAULT 0,
  parent_session_id  TEXT,
  source_path        TEXT NOT NULL,
  sha                TEXT,                    -- content hash, used by incremental sync to skip unchanged files
  -- status: lifecycle state observed by the ingest pipeline.
  -- 'idle' (default, no signal) | 'active' | 'waiting_for_user' | 'interrupted'.
  -- See `SessionStatus` in src/types.ts for the canonical enum.
  status             TEXT NOT NULL DEFAULT 'idle',
  -- last_message_text: preview of the most recent user/assistant message in
  -- the session (truncated to ~240 chars). NULL when the adapter cannot
  -- cheaply extract one (e.g. cursor chat protobuf blobs). Powers the
  -- "最終メッセージ" column on the session list.
  last_message_text  TEXT,
  PRIMARY KEY (type, id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON sessions (last_active DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_repo        ON sessions (repo);
CREATE INDEX IF NOT EXISTS idx_sessions_type_active ON sessions (type, last_active DESC);

INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (1, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (2, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (3, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (4, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (5, datetime('now'));
INSERT OR IGNORE INTO schema_version (version, applied_at)
  VALUES (6, datetime('now'));
