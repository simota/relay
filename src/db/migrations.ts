// Column-level migration helpers extracted from `client.ts`. Runs after
// `SCHEMA_SQL` to ALTER any columns that were added in later schema bumps
// and to lazily ensure auxiliary tables (queue/views/undo/sync_history)
// exist for DBs that predate them. Each helper is idempotent.

import type { Database } from "bun:sqlite";

/**
 * Idempotent column-level migrations for DBs created before schema bumps.
 * Runs AFTER SCHEMA_SQL so the table is guaranteed to exist; ALTERs missing
 * columns and creates any column-dependent indexes (kept here instead of in
 * SCHEMA_SQL so old DBs don't fail before ALTER runs).
 */
export function runColumnMigrations(db: Database): void {
  const ctxCols = db.prepare(`PRAGMA table_info(contexts)`).all() as Array<{ name: string }>;
  if (!ctxCols.some((c) => c.name === "session_id")) {
    db.exec(`ALTER TABLE contexts ADD COLUMN session_id TEXT`);
  }
  if (!ctxCols.some((c) => c.name === "generated_at")) {
    db.exec(`ALTER TABLE contexts ADD COLUMN generated_at TEXT`);
  }
  if (!ctxCols.some((c) => c.name === "model_name")) {
    db.exec(`ALTER TABLE contexts ADD COLUMN model_name TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_contexts_session ON contexts (session_id)`);

  // schema_version 2: tasks.wait_on. ALTER TABLE on existing DBs; the
  // NOT NULL DEFAULT 'self' fills every existing row with 'self' in a
  // single statement.
  const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name: string }>;
  if (!taskCols.some((c) => c.name === "wait_on")) {
    db.exec(`ALTER TABLE tasks ADD COLUMN wait_on TEXT NOT NULL DEFAULT 'self'`);
  }

  // schema_version 4: sessions.status. Pre-v4 DBs already have the sessions
  // table from v3 but no status column; backfill defaults all existing rows
  // to 'idle' so we never falsely advertise an unobserved state.
  // schema_version 5: sessions.last_message_text. Nullable preview field —
  // existing rows materialise as NULL until the next sync refreshes them.
  const sessionCols = db
    .prepare(`PRAGMA table_info(sessions)`)
    .all() as Array<{ name: string }>;
  if (sessionCols.length > 0 && !sessionCols.some((c) => c.name === "status")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'idle'`);
  }
  if (sessionCols.length > 0 && !sessionCols.some((c) => c.name === "last_message_text")) {
    db.exec(`ALTER TABLE sessions ADD COLUMN last_message_text TEXT`);
  }
}

export function ensureQueueSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS queue_items (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      added_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_items_task  ON queue_items (task_id);
    CREATE INDEX IF NOT EXISTS idx_queue_items_added ON queue_items (added_at);
  `);
}

export function ensureViewsSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS views (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT    NOT NULL UNIQUE,
      filter_json  TEXT    NOT NULL,
      pinned       INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_views_pinned_created
      ON views (pinned DESC, created_at DESC);
  `);
}

export function ensureUndoSchema(db: Database): void {
  db.exec(`
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
  `);

  const cols = db.prepare(`PRAGMA table_info(undo_log)`).all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === "status")) {
    db.exec(`ALTER TABLE undo_log ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
  }
}

export function ensureSyncHistorySchema(db: Database): void {
  db.exec(`
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
  `);
}
