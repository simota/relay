// SQL kept in sync with schema.sql (which exists for tooling / human reference).
// Inlined here so it works in both dev and bundled dist without filesystem path tricks.
export const SCHEMA_SQL = `
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
  files         TEXT,
  context_hash  TEXT,
  session_id    TEXT,
  due_at        TEXT,
  -- wait_on: who the task is currently blocked on. Lets Today split into
  -- "things I drive" vs "things waiting on someone else" without losing the
  -- task. 'self' (default) = I act next; 'reviewer' = waiting on a code
  -- reviewer (open PR I authored); 'external' = waiting on an outside
  -- party; 'scheduled' = waiting on a date/event.
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
  hash         TEXT    PRIMARY KEY,
  repo         TEXT    NOT NULL,
  branch       TEXT    NOT NULL,
  head_sha     TEXT    NOT NULL,
  dirty_files  TEXT    NOT NULL DEFAULT '[]',
  summary      TEXT    NOT NULL DEFAULT '',
  session_id   TEXT,
  created_at   TEXT    NOT NULL
);

-- idx_contexts_session is created in client.migrate() so existing DBs that
-- predate the column don't blow up here.

CREATE INDEX IF NOT EXISTS idx_contexts_repo ON contexts (repo);

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
  type               TEXT NOT NULL,
  repo               TEXT,
  cwd                TEXT,
  started_at         TEXT NOT NULL,
  last_active        TEXT NOT NULL,
  message_count      INTEGER NOT NULL DEFAULT 0,
  parent_session_id  TEXT,
  source_path        TEXT NOT NULL,
  sha                TEXT,
  -- status: 'idle' (default) | 'active' | 'waiting_for_user' | 'interrupted'.
  -- See SessionStatus in src/types.ts. ALTER for pre-v4 DBs lives in
  -- runColumnMigrations() so existing rows materialise as 'idle'.
  status             TEXT NOT NULL DEFAULT 'idle',
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
`;

export interface UndoLogRow {
  id: number;
  op_kind: string;
  payload: string;
  inverse: string;
  created_at: string;
  status: "active" | "undone";
}
