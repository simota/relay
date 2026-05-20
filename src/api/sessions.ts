import { watch, type FSWatcher } from "node:fs";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadConfig, resolveScanRoots } from "../config.js";
import { RelayDB } from "../db/client.js";
import { scanClaudeSessionsLive } from "../lib/session-live-scan.js";
import { getSession, getSessionPath } from "../sessions/index.js";
import type { SessionDetail } from "../sessions/types.js";
import type { SessionRow, SessionStatus, SessionType } from "../types.js";

// `SessionType` includes "cursor" (Phase A) but the live-fs readers only
// know about claude/codex/antigravity. The detail + SSE endpoints reject
// anything else; cursor sessions exist purely as DB rows for `/insights`
// and the list endpoint can expose them on demand via `?type=cursor`.
const FS_BACKED_TYPES = new Set<SessionType>(["claude", "codex", "antigravity"]);
// Default list types — matches the legacy fs-based listSessions which
// never knew about cursor. Frontend type filters render only these
// three, so they are also what we surface when `type` is unset.
const DEFAULT_LIST_TYPES: readonly SessionType[] = ["claude", "codex", "antigravity"];
const LIST_TYPES_WITH_CURSOR: ReadonlySet<SessionType> = new Set([
  "claude",
  "codex",
  "antigravity",
  "cursor",
]);

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

// Debounce file-change → SSE push. Sessions are appended a few lines at a
// time, so many `change` events arrive within milliseconds; we collapse them
// into one re-parse + push per ~200 ms window.
const PUSH_DEBOUNCE_MS = 200;
// Heartbeat keeps the connection alive between filesystem-driven pushes.
// MUST be shorter than Bun.serve's idleTimeout (default 10s) — otherwise
// Bun closes the TCP socket mid-stream and the browser reports
// ERR_INCOMPLETE_CHUNKED_ENCODING. Cloudflare / nginx defaults (30-60s)
// would also tolerate this lower value.
const HEARTBEAT_INTERVAL_MS = 8_000;

// scan-live freshness window (Claude only). 5 minutes is generous enough
// to catch sessions that briefly stalled while still flagging fresh
// transitions; tighter than the list endpoint's default lookback so the
// notification hook does not pay full-list cost on every poll.
const DEFAULT_SCAN_LIVE_SINCE_MIN = 5;
const MAX_SCAN_LIVE_SINCE_MIN = 60;

// Fleet stream poll cadence. 3s feels live without dragging the DB; the
// snapshot is JSON-compared so identical polls only fire a heartbeat.
const FLEET_POLL_INTERVAL_MS = 3_000;

/**
 * Public shape returned from the list endpoint. Kept structurally
 * identical to the legacy `SessionSummary` (from `src/sessions/types.ts`)
 * so the Next.js frontend's `lib/api.ts` definition does not need to
 * change. Re-declared inline rather than imported because the legacy
 * type is gradually being retired.
 */
interface SessionListItem {
  type: SessionType;
  id: string;
  repo: string | null;
  cwd: string | null;
  title: string;
  started_at: string;
  last_active: string;
  message_count: number;
  todos_count: number;
  parent_session_id?: string;
  agent_id?: string;
  subagent_count?: number;
  // Surfaced so the list view can highlight rows waiting on the user.
  // Sourced from `sessions.status` — refreshed on every sync.
  status?: SessionStatus;
  // Truncated preview of the latest user/assistant message. Omitted when
  // the adapter can't cheaply produce one (e.g. cursor chat sessions).
  last_message?: string;
}

export function createSessionsApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const typeRaw = c.req.query("type");
    const typeFilter = parseTypeFilter(typeRaw);
    if (typeFilter === "invalid") {
      return c.json({ error: "type must be claude, codex, antigravity, or cursor" }, 400);
    }

    const repo = c.req.query("repo") || undefined;
    const limit = clampInt(c.req.query("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const lookbackDays = clampInt(c.req.query("lookback_days"), DEFAULT_LOOKBACK_DAYS, 1, 365);
    const includeSubagents = c.req.query("include") === "subagents";
    const parent = c.req.query("parent") || undefined;

    const db = new RelayDB();
    try {
      const items = collectSessionListItems(db, {
        typeFilter,
        repo,
        limit,
        lookbackDays,
        includeSubagents,
        parent,
      });
      return c.json(items);
    } finally {
      db.close();
    }
  });

  // F-realtime: fleet-wide SSE. Polls the sessions table on a short interval
  // and pushes whenever the snapshot JSON changes. Same shape as GET / so
  // the frontend can swap fetch+poll for EventSource without translation.
  // Updates are driven by `relay sync` writes; if the user prefers tighter
  // wall-clock freshness, enable `[daemon].enabled` so sync runs in the
  // background.
  app.get("/stream", (c) => {
    const typeRaw = c.req.query("type");
    const typeFilter = parseTypeFilter(typeRaw);
    if (typeFilter === "invalid") {
      return c.json({ error: "type must be claude, codex, antigravity, or cursor" }, 400);
    }
    const repo = c.req.query("repo") || undefined;
    const limit = clampInt(c.req.query("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const lookbackDays = clampInt(c.req.query("lookback_days"), DEFAULT_LOOKBACK_DAYS, 1, 365);
    const includeSubagents = c.req.query("include") === "subagents";
    const parent = c.req.query("parent") || undefined;
    const opts = { typeFilter, repo, limit, lookbackDays, includeSubagents, parent };

    return streamSSE(c, async (stream) => {
      let closed = false;
      let lastJson = "";
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let poller: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (poller) clearInterval(poller);
      };

      const push = async (eventName: "snapshot" | "update") => {
        if (closed) return;
        const db = new RelayDB();
        try {
          const items = collectSessionListItems(db, opts);
          const json = JSON.stringify(items);
          if (json === lastJson && eventName === "update") return;
          lastJson = json;
          await stream.writeSSE({ event: eventName, data: json });
        } catch (err) {
          if (closed) return;
          await stream
            .writeSSE({ event: "error", data: JSON.stringify({ message: String(err) }) })
            .catch(() => cleanup());
        } finally {
          db.close();
        }
      };

      stream.onAbort(cleanup);
      await push("snapshot");
      if (closed) return;

      poller = setInterval(() => void push("update"), FLEET_POLL_INTERVAL_MS);
      heartbeat = setInterval(() => {
        if (closed) return;
        stream
          .writeSSE({ event: "heartbeat", data: "{}" })
          .catch(() => cleanup());
      }, HEARTBEAT_INTERVAL_MS);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          cleanup();
          resolve();
        });
      });
    });
  });

  // Live status scan for Claude sessions. Reads JSONLs modified in the
  // last N minutes (default 5), runs the detector, and upserts the result
  // back to the sessions table. Drives the notification hook's tight
  // polling loop — the list endpoint alone is DB-cached, so a session
  // that flipped to waiting_for_user between syncs is invisible there
  // until the next full sync. This route closes that gap without touching
  // the slow adapters (gh, code_todo, ...).
  //
  // Returns SessionListItem[] so the notification hook can consume the
  // same shape as the existing list endpoint with zero client-side
  // branching. Routed BEFORE the /:type/:id routes so Hono does not
  // capture "scan-live" as a type parameter.
  app.get("/scan-live", async (c) => {
    const cfg = loadConfig();
    const roots = resolveScanRoots(cfg);
    const sinceMin = clampInt(
      c.req.query("since_min"),
      DEFAULT_SCAN_LIVE_SINCE_MIN,
      1,
      MAX_SCAN_LIVE_SINCE_MIN,
    );
    const includeSubagents = c.req.query("subagents") !== "0";

    const scan = await scanClaudeSessionsLive({
      sinceMs: sinceMin * 60 * 1000,
      roots,
      includeSubagents,
    });

    // Persist freshly detected status to the sessions table so the list
    // view also reflects it (and the next full sync skips files whose
    // mtime has not advanced past its cursor). Preserve started_at and
    // sha from the existing row when present — those are populated by
    // the full adapter pass and we have no reason to overwrite them.
    const db = new RelayDB();
    const items: SessionListItem[] = [];
    try {
      for (const r of scan) {
        const existing = db.getSessionByTypeId("claude", r.id);
        db.upsertSession({
          id: r.id,
          type: "claude",
          repo: r.repo ?? existing?.repo ?? null,
          cwd: r.cwd ?? existing?.cwd ?? null,
          started_at: existing?.started_at ?? r.last_active,
          last_active: r.last_active,
          message_count: r.message_count,
          parent_session_id: r.parent_session_id,
          source_path: r.source_path,
          sha: existing?.sha ?? null,
          status: r.status,
          last_message_text: r.last_message_text ?? existing?.last_message_text ?? null,
          title: existing?.title ?? null,
        });
        const item: SessionListItem = {
          type: r.type,
          id: r.id,
          repo: r.repo ?? existing?.repo ?? null,
          cwd: r.cwd ?? existing?.cwd ?? null,
          title:
            existing?.title && existing.title.length > 0
              ? existing.title
              : deriveTitleFromCwd(r.cwd ?? existing?.cwd ?? null),
          started_at: existing?.started_at ?? r.last_active,
          last_active: r.last_active,
          message_count: r.message_count,
          todos_count: 0,
          status: r.status,
        };
        if (r.parent_session_id) item.parent_session_id = r.parent_session_id;
        if (r.id.startsWith("agent-")) item.agent_id = r.id;
        // Prefer the freshly scanned preview; fall back to whatever the
        // last full sync persisted so the row is never blank just because
        // this poll happened to land before any user/assistant message
        // could be extracted.
        const preview = r.last_message_text ?? existing?.last_message_text ?? null;
        if (preview) item.last_message = preview;
        items.push(item);
      }
    } finally {
      db.close();
    }

    return c.json(items);
  });

  // F-4: list tasks ingested from this session. The Web Session Detail page
  // calls this once on tile mount to render a "Tasks from this session" panel;
  // it is intentionally NOT included in the SSE snapshot/update payload
  // (which would re-query the DB on every JSONL append). Available for every
  // SessionType including `cursor`, because cursor plans also produce
  // `cursor_session_todo` tasks.
  app.get("/:type/:id/tasks", (c) => {
    const typeParam = c.req.param("type") as SessionType;
    if (!LIST_TYPES_WITH_CURSOR.has(typeParam)) {
      return c.json({ error: "unknown session type" }, 400);
    }
    const id = c.req.param("id");
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return c.json({ error: "invalid session id" }, 400);
    }

    const db = new RelayDB();
    // session_id alone is enough — `tasks.session_id` is unique per
    // ingest (the per-adapter source_id namespacing keeps tasks distinct
    // across runs). Filtering by source_type would double-encode the
    // same information and force the caller to map type → source_type.
    const tasks = db.listTasks({ session: id, limit: 100 });
    db.close();

    return c.json({
      count: tasks.length,
      sample: tasks.slice(0, 10).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        repo: t.repo,
        source_type: t.source_type,
        updated_at: t.updated_at,
      })),
    });
  });

  app.get("/:type/:id", async (c) => {
    const cfg = loadConfig();
    const roots = resolveScanRoots(cfg);
    const typeParam = c.req.param("type");
    if (!FS_BACKED_TYPES.has(typeParam as SessionType)) {
      return c.json({ error: "unknown session type" }, 400);
    }
    const id = c.req.param("id");
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return c.json({ error: "invalid session id" }, 400);
    }
    const session = await getSession(typeParam as SessionType, id, roots);
    if (!session) return c.json({ error: "not found" }, 404);
    attachSubagentCount(session, typeParam as SessionType);
    return c.json(session);
  });

  // SSE: live-push session updates as the underlying file is appended.
  // Events:
  //   snapshot       — full SessionDetail on connect
  //   update         — full SessionDetail after each filesystem change
  //   heartbeat      — empty payload every 25 s to keep proxies alive
  //   error          — fatal condition; the client should fall back to polling
  app.get("/:type/:id/stream", async (c) => {
    const cfg = loadConfig();
    const roots = resolveScanRoots(cfg);
    const typeParam = c.req.param("type") as SessionType;
    const id = c.req.param("id");
    if (!FS_BACKED_TYPES.has(typeParam)) {
      return c.json({ error: "unknown session type" }, 400);
    }
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return c.json({ error: "invalid session id" }, 400);
    }

    const filePath = await getSessionPath(typeParam, id);
    if (!filePath) {
      return c.json({ error: "not found" }, 404);
    }

    return streamSSE(c, async (stream) => {
      let closed = false;
      let watcher: FSWatcher | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let debounce: ReturnType<typeof setTimeout> | null = null;
      let inFlight = false;
      let pendingRetry = false;

      const cleanup = () => {
        closed = true;
        if (watcher) {
          try {
            watcher.close();
          } catch {
            /* ignore */
          }
          watcher = null;
        }
        if (heartbeat) clearInterval(heartbeat);
        if (debounce) clearTimeout(debounce);
      };

      const pushSession = async (eventName: "snapshot" | "update") => {
        // Single-flight: if a parse is already running, mark a re-run so we
        // don't pile parses while a slow read is in progress.
        if (inFlight) {
          pendingRetry = true;
          return;
        }
        inFlight = true;
        try {
          const session = await getSession(typeParam, id, roots);
          if (closed) return;
          if (!session) {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ message: "session not found" }),
            });
            return;
          }
          attachSubagentCount(session, typeParam);
          await stream.writeSSE({
            event: eventName,
            data: JSON.stringify(session),
          });
        } catch (err) {
          if (closed) return;
          await stream
            .writeSSE({
              event: "error",
              data: JSON.stringify({ message: String(err) }),
            })
            .catch(() => {});
        } finally {
          inFlight = false;
          if (pendingRetry && !closed) {
            pendingRetry = false;
            void pushSession("update");
          }
        }
      };

      stream.onAbort(cleanup);

      // Initial snapshot.
      await pushSession("snapshot");
      if (closed) return;

      // fs.watch fires repeatedly during a sequence of appends; coalesce.
      try {
        watcher = watch(filePath, () => {
          if (closed) return;
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => {
            void pushSession("update");
          }, PUSH_DEBOUNCE_MS);
        });
      } catch (err) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: `watch failed: ${err}` }),
        });
        return;
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        stream
          .writeSSE({ event: "heartbeat", data: "{}" })
          .catch(() => cleanup());
      }, HEARTBEAT_INTERVAL_MS);

      // Park until the client disconnects. Hono's streamSSE callback returns
      // when this promise resolves, so we keep the connection open by
      // resolving from onAbort/cleanup.
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          cleanup();
          resolve();
        });
      });
    });
  });

  return app;
}

interface CollectOpts {
  typeFilter: SessionType | null;
  repo: string | undefined;
  limit: number;
  lookbackDays: number;
  includeSubagents: boolean;
  parent: string | undefined;
}

// Shared between GET / and GET /stream so both paths produce byte-identical
// payloads (the SSE handler JSON-compares snapshots to suppress unchanged
// pushes — any drift between paths would break that comparison).
function collectSessionListItems(db: RelayDB, opts: CollectOpts): SessionListItem[] {
  const { typeFilter, repo, limit, lookbackDays, includeSubagents, parent } = opts;
  const sinceLastActive = parent ? undefined : isoCutoff(lookbackDays);
  const types: readonly SessionType[] = typeFilter ? [typeFilter] : DEFAULT_LIST_TYPES;

  const merged: SessionRow[] = [];
  const subagentCountByType = new Map<SessionType, Map<string, number>>();
  for (const t of types) {
    const perTypeRows = db.getSessions({
      type: t,
      repo,
      sinceLastActive,
      limit: Math.min(limit, MAX_LIMIT),
      ...(parent ? { parent } : {}),
      includeSubagents: includeSubagents || !!parent,
    });
    merged.push(...perTypeRows);
    subagentCountByType.set(t, db.countSubagentsByParent(t));
  }

  merged.sort((a, b) => b.last_active.localeCompare(a.last_active));
  return merged
    .slice(0, limit)
    .map((row) => rowToListItem(row, subagentCountByType.get(row.type)));
}

/**
 * Translate a DB `SessionRow` into the legacy `SessionSummary` shape the
 * frontend has been consuming since before the F-1 sessions table existed.
 *
 * Known degradations vs the JSONL-parsing path:
 *   - `title`        — the DB schema (Phase A) does not store a per-session
 *                      title, so we fall back to `cwd` basename when
 *                      available and `(no prompt)` otherwise. The legacy
 *                      codex/antigravity readers already emitted `(no prompt)`
 *                      when the first user message was empty, so this is
 *                      not a new sentinel.
 *   - `todos_count`  — the DB schema does not track todo counts. Returns 0.
 *                      Matches the legacy codex/antigravity behavior already;
 *                      only Claude sessions lose this badge value.
 *
 * Both are tracked as `#TODO(agent): add title/todos columns to sessions
 * table` for a follow-up phase (separate from F-1 Phase D's incremental
 * cursor work).
 */
function rowToListItem(
  row: SessionRow,
  subagentCounts: Map<string, number> | undefined,
): SessionListItem {
  const isSubagent = row.parent_session_id !== null;
  const item: SessionListItem = {
    type: row.type,
    id: row.id,
    repo: row.repo,
    cwd: row.cwd,
    title: deriveTitle(row),
    started_at: row.started_at,
    last_active: row.last_active,
    message_count: row.message_count,
    todos_count: 0,
    status: row.status,
  };
  if (row.last_message_text) item.last_message = row.last_message_text;
  if (isSubagent && row.parent_session_id) {
    item.parent_session_id = row.parent_session_id;
  }
  // Claude subagent ids are prefixed with "agent-" (see
  // `src/sessions/claude.ts` isAgentId). The detail page uses
  // `s.agent_id` to filter subagents for the "Add all subagents"
  // button, so surface the id back as agent_id when applicable.
  if (row.id.startsWith("agent-")) {
    item.agent_id = row.id;
  }
  if (!isSubagent && subagentCounts) {
    const n = subagentCounts.get(row.id);
    if (n && n > 0) item.subagent_count = n;
  }
  return item;
}

function deriveTitle(row: SessionRow): string {
  // Schema v8: adapter writes the first-user-message into sessions.title.
  // Prefer it whenever populated; the cwd basename fallback exists only for
  // pre-v8 rows and for adapters that don't fill the field yet.
  if (row.title && row.title.length > 0) return row.title;
  return deriveTitleFromCwd(row.cwd);
}

function deriveTitleFromCwd(cwd: string | null): string {
  // `cwd` basename is the next best handle when no first-user-message is
  // available. Skips empty paths and the root segment.
  if (cwd) {
    const parts = cwd.split("/").filter((p) => p.length > 0);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "(no prompt)";
}

function parseTypeFilter(raw: string | undefined): SessionType | null | "invalid" {
  if (!raw) return null;
  if (LIST_TYPES_WITH_CURSOR.has(raw as SessionType)) return raw as SessionType;
  return "invalid";
}

function clampInt(raw: string | undefined, dflt: number, min: number, max: number): number {
  if (!raw) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// `getSession` reads the JSONL alone and has no idea how many subagents
// the parent owns. The detail page's tree / DAG / flock tabs all gate on
// `subagent_count > 0` and `useSubagents` short-circuits before fetching
// when it's zero, so without this augmentation the tabs never render.
// No-op on subagent (leaf) sessions and on zero-child parents.
function attachSubagentCount(session: SessionDetail, type: SessionType): void {
  if (session.parent_session_id) return;
  const db = new RelayDB();
  try {
    const n = db.countSubagentsByParent(type).get(session.id);
    if (n && n > 0) session.subagent_count = n;
  } finally {
    db.close();
  }
}

function isoCutoff(lookbackDays: number): string {
  return new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
}
