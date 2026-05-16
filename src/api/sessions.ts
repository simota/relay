import { watch, type FSWatcher } from "node:fs";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { loadConfig, resolveScanRoots } from "../config.js";
import { RelayDB } from "../db/client.js";
import { getSession, getSessionPath } from "../sessions/index.js";
import type { SessionRow, SessionStatus, SessionType } from "../types.js";

// `SessionType` includes "cursor" (Phase A) but the live-fs readers only
// know about claude/codex/gemini. The detail + SSE endpoints reject
// anything else; cursor sessions exist purely as DB rows for `/insights`
// and the list endpoint can expose them on demand via `?type=cursor`.
const FS_BACKED_TYPES = new Set<SessionType>(["claude", "codex", "gemini"]);
// Default list types — matches the legacy fs-based listSessions which
// never knew about cursor. Frontend type filters render only these
// three, so they are also what we surface when `type` is unset.
const DEFAULT_LIST_TYPES: readonly SessionType[] = ["claude", "codex", "gemini"];
const LIST_TYPES_WITH_CURSOR: ReadonlySet<SessionType> = new Set([
  "claude",
  "codex",
  "gemini",
  "cursor",
]);

const DEFAULT_LOOKBACK_DAYS = 30;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

// Debounce file-change → SSE push. Sessions are appended a few lines at a
// time, so many `change` events arrive within milliseconds; we collapse them
// into one re-parse + push per ~200 ms window.
const PUSH_DEBOUNCE_MS = 200;
// Heartbeat keeps proxies from killing idle SSE connections. 25s is safely
// under the common 30-60s idle timeout for Cloudflare / nginx defaults.
const HEARTBEAT_INTERVAL_MS = 25_000;

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
}

export function createSessionsApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const typeRaw = c.req.query("type");
    const typeFilter = parseTypeFilter(typeRaw);
    if (typeFilter === "invalid") {
      return c.json({ error: "type must be claude, codex, gemini, or cursor" }, 400);
    }

    const repo = c.req.query("repo") || undefined;
    const limit = clampInt(c.req.query("limit"), DEFAULT_LIMIT, 1, MAX_LIMIT);
    const lookbackDays = clampInt(c.req.query("lookback_days"), DEFAULT_LOOKBACK_DAYS, 1, 365);
    const includeSubagents = c.req.query("include") === "subagents";
    const parent = c.req.query("parent") || undefined;

    const sinceLastActive = isoCutoff(lookbackDays);

    const db = new RelayDB();

    // When `type` is set we honor it 1:1 (including cursor). When unset,
    // restrict to the legacy three so the frontend never sees rows it
    // can't render (TypeBadge has hard-coded colors for claude/codex/gemini).
    const types: readonly SessionType[] = typeFilter ? [typeFilter] : DEFAULT_LIST_TYPES;

    // The legacy implementation queried each source separately and merged.
    // We do the same to keep the per-type subagent_count aggregation simple
    // (one SQL group-by per type), which is unmeasurably cheap for these
    // table sizes.
    const merged: SessionRow[] = [];
    const subagentCountByType = new Map<SessionType, Map<string, number>>();
    for (const t of types) {
      // `parent` is meaningful per type — push the actual sub-query and let
      // SQL handle filtering. Use a generous per-type slice; final cap is
      // applied after the merged sort.
      const perTypeRows = db.getSessions({
        type: t,
        repo,
        sinceLastActive,
        limit: Math.min(limit, MAX_LIMIT),
        // `parent` and `includeSubagents` semantics mirror the legacy
        // listClaudeSessions: a `parent` query forces subagent inclusion
        // because the caller is explicitly asking for that parent's children.
        ...(parent ? { parent } : {}),
        includeSubagents: includeSubagents || !!parent,
      });
      merged.push(...perTypeRows);

      // Subagent counts are only meaningful for claude (the only adapter
      // emitting parent/child rows). Skip the SQL round-trip for the other
      // three types.
      if (t === "claude") {
        subagentCountByType.set(t, db.countSubagentsByParent(t));
      }
    }

    // Merge-sort across types by last_active DESC, then cap at the
    // user-requested limit. The per-type slice may have over-returned
    // (limit applied per-type), so the cut here is what enforces the
    // overall cap.
    merged.sort((a, b) => b.last_active.localeCompare(a.last_active));
    const capped = merged.slice(0, limit);

    const items: SessionListItem[] = capped.map((row) =>
      rowToListItem(row, subagentCountByType.get(row.type)),
    );

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

/**
 * Translate a DB `SessionRow` into the legacy `SessionSummary` shape the
 * frontend has been consuming since before the F-1 sessions table existed.
 *
 * Known degradations vs the JSONL-parsing path:
 *   - `title`        — the DB schema (Phase A) does not store a per-session
 *                      title, so we fall back to `cwd` basename when
 *                      available and `(no prompt)` otherwise. The legacy
 *                      codex/gemini readers already emitted `(no prompt)`
 *                      when the first user message was empty, so this is
 *                      not a new sentinel.
 *   - `todos_count`  — the DB schema does not track todo counts. Returns 0.
 *                      Matches the legacy codex/gemini behavior already;
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
  // `cwd` basename is the next best handle when no first-user-message is
  // available. Skips empty paths and the root segment.
  if (row.cwd) {
    const parts = row.cwd.split("/").filter((p) => p.length > 0);
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

function isoCutoff(lookbackDays: number): string {
  return new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
}
