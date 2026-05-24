import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RelayDB } from "../db/client.js";
import { createQueueApi } from "../api/queue.js";
import { createAgendaApi } from "../api/agenda.js";
import { createClientErrorsApi } from "../api/client-errors.js";
import { createContextsApi } from "../api/contexts.js";
import { createDigestApi } from "../api/digest.js";
import { createInsightsApi } from "../api/insights.js";
import { createReviewApi } from "../api/review.js";
import { createResumeBriefApi } from "../api/resume-brief.js";
import { createSessionsApi } from "../api/sessions.js";
import { createStandupApi } from "../api/standup.js";
import { createSyncApi } from "../api/sync.js";
import { createTasksApi } from "../api/tasks.js";
import { createUndoApi } from "../api/undo.js";
import { createViewsApi } from "../api/views.js";
import { createRepoAgentsApi } from "../api/repo-agents.js";
import { createReposJournalsApi } from "../api/repos-journals.js";
import { createReposPromiseApi } from "../api/repos-promise.js";
import { createScanApi } from "../api/scan.js";
import { clearFocus, getFocus, setFocus } from "../commands/focus.js";
import { pruneMissingRepos } from "../commands/prune.js";
import { runSync } from "../commands/sync.js";
import { loadConfig, resolveScanRoots } from "../config.js";
import { resolveRepoPath } from "../repo-resolver.js";
import { Assignee } from "../types.js";
import {
  deriveGithubUrlFromSourceId,
  findMissingRepos,
  readRepoMetadata,
} from "../repo-metadata.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Asset roots, tried in order:
//   1) web/nextjs/out/  (Next.js static export — production frontend)
//   2) web/app/         (vanilla fallback / legacy)
const ROOT = resolve(__dirname, "..", "..", "web");
const ASSET_ROOTS = [join(ROOT, "nextjs", "out"), join(ROOT, "app")];

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font-woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

export function buildApp() {
  const app = new Hono();

  // --- CORS ------------------------------------------------------------
  // Allow the Next.js dev server (`next dev` on :3340) to call /api/*
  // directly. Production runs the static export from the same Hono
  // origin (:7340), so CORS is unused there — but enabling it broadly
  // is safe because the server only binds to 127.0.0.1. The dev SSE
  // stream MUST go cross-origin: Next.js's dev rewrites buffer
  // text/event-stream responses, so EventSource hits :7340 directly.
  app.use("/api/*", cors({
    origin: (origin) => {
      if (!origin) return origin;
      if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return origin;
      return null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Accept"],
  }));

  // --- Health ----------------------------------------------------------
  app.get("/api/health", (c) => {
    const cfg = loadConfig();
    const config_hash = createHash("sha256")
      .update(JSON.stringify(cfg))
      .digest("hex")
      .slice(0, 12);
    return c.json({
      status: "ok",
      version: "0.1.0",
      frontend: detectFrontend(),
      config_hash,
    });
  });

  // --- Config (read-only slice for frontend) ---------------------------
  app.get("/api/config", (c) => {
    const cfg = loadConfig();
    return c.json({
      scan_roots: resolveScanRoots(cfg),
      github_user: cfg.github.user ?? null,
      github_orgs: cfg.github.orgs,
      agents_default: cfg.agents.default,
    });
  });

  // --- Counts ----------------------------------------------------------
  app.get("/api/counts", (c) => {
    const db = new RelayDB();
    const cfg = loadConfig();
    const roots = resolveScanRoots(cfg);
    const repoNames = db.repoStats().map((r) => r.name);
    const missing = findMissingRepos(repoNames, roots);
    // Counts exclude missing-repo tasks so the headline numbers match what
    // the queue actually shows.
    const views = db.viewCounts(missing);
    // Repo count must agree with /repos which filters by `exists !== false`.
    // Mirror the same enrichment logic here: a repo is "present" when it
    // resolves to a real directory either via scan.roots or via the user's
    // tracked_repos allowlist. Tracked-only repos that exist also count.
    const trackedByName = new Map<string, string>();
    for (const p of cfg.scan.tracked_repos) {
      trackedByName.set(basename(p), p);
    }
    let presentCount = 0;
    for (const name of repoNames) {
      const trackedPath = trackedByName.get(name);
      const path = trackedPath ?? resolveRepoPath(name, cfg);
      if (path !== null && existsSync(path)) presentCount += 1;
    }
    const repoNameSet = new Set(repoNames);
    for (const p of cfg.scan.tracked_repos) {
      if (!repoNameSet.has(basename(p)) && existsSync(p)) presentCount += 1;
    }
    const repos = presentCount;
    const contexts = db.contextCount();
    const sources = db.sourceCounts();
    const source_delta_7d = db.sourceDelta7d();
    db.close();
    return c.json({ ...views, repos, contexts, sources, source_delta_7d });
  });

  // --- Saved Views -----------------------------------------------------
  app.route("/api/views", createViewsApi());

  // --- Undo ------------------------------------------------------------
  app.route("/api/undo", createUndoApi());

  // --- Client Error Reports -------------------------------------------
  app.route("/api/client-errors", createClientErrorsApi());

  // --- Today / Tasks ---------------------------------------------------
  app.route("/api/resume-brief", createResumeBriefApi());

  app.get("/api/today", (c) => {
    const limit = Number(c.req.query("limit") ?? 50);
    const db = new RelayDB();
    // Filter out tasks from repos whose directory no longer exists. The
    // rows stay in the DB (so re-clone can restore them), they just don't
    // pollute Today's queue.
    const cfg = loadConfig();
    const roots = resolveScanRoots(cfg);
    const repoNames = db.repoStats().map((r) => r.name);
    const missing = findMissingRepos(repoNames, roots);
    const tasks = db.today(limit, missing, cfg.ui.priority_decay_days);
    db.close();
    return c.json(tasks);
  });

  app.get("/api/tasks", (c) => {
    const status = c.req.query("status");
    const repo = c.req.query("repo");
    const source = c.req.query("source");
    const age = c.req.query("age");
    const assignee = c.req.query("assignee");
    const context = c.req.query("context");
    const session = c.req.query("session_id");
    const limit = Number(c.req.query("limit") ?? 500);

    const db = new RelayDB();
    const hasFilter = Boolean(status || repo || source || assignee || context || session || age);
    const tasks = hasFilter
      ? db.listTasks({ status, repo, source, assignee, context, session, age, limit })
      : db.listTasks({ limit });
    db.close();
    return c.json(tasks);
  });

  app.post("/api/tasks", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return c.json({ error: "invalid json" }, 400);
    const repo = typeof body.repo === "string" ? body.repo.trim() : "";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!repo || !title) return c.json({ error: "repo and title required" }, 400);
    const assignee = Assignee.safeParse(body.assignee ?? "self");
    if (!assignee.success) {
      return c.json({ error: "assignee must be one of: claude-code, codex, antigravity, self, human-review" }, 400);
    }
    const rawPriority = typeof body.priority === "number" ? body.priority : Number(body.priority ?? 50);
    const priority = Number.isFinite(rawPriority)
      ? Math.min(100, Math.max(0, Math.round(rawPriority)))
      : 50;

    const task = {
      source_type: "manual" as const,
      source_id: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      repo,
      title,
      body: typeof body.body === "string" ? body.body.trim() : "",
      status: "open" as const,
      assignee: assignee.data,
      priority,
      prompt: typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : null,
      files: Array.isArray(body.files)
        ? body.files
            .filter((f): f is string => typeof f === "string")
            .map((f) => f.trim())
            .filter(Boolean)
        : [],
      context_hash: null,
      session_id: null,
      due_at: typeof body.due_at === "string" ? body.due_at : null,
      wait_on: "self" as const,
    };

    const db = new RelayDB();
    db.upsertTasks([task]);
    const found = db.getTaskBySourceId("manual", task.source_id);
    db.close();
    if (!found) return c.json({ error: "insert failed" }, 500);
    return c.json(found, 201);
  });

  app.get("/api/tasks/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
    const db = new RelayDB();
    const task = db.getTask(id);
    db.close();
    if (!task) return c.json({ error: "not found" }, 404);
    return c.json(task);
  });

  // --- Mutations -------------------------------------------------------
  app.route("/api/tasks", createTasksApi());
  app.post("/api/tasks/:id/snooze", (c) => transitionStatus(c, "snoozed"));
  app.post("/api/tasks/:id/close", (c) => transitionStatus(c, "done"));
  app.post("/api/tasks/:id/reopen", (c) => transitionStatus(c, "open"));
  app.post("/api/tasks/:id/assignee", async (c) => reassign(c));

  // --- Review ----------------------------------------------------------
  app.route("/api/review", createReviewApi());

  // --- Insights --------------------------------------------------------
  app.route("/api/insights", createInsightsApi());

  // --- Digest ----------------------------------------------------------
  app.route("/api/digest", createDigestApi());

  // --- Standup ---------------------------------------------------------
  app.route("/api/standup", createStandupApi());

  // --- Agenda ----------------------------------------------------------
  app.route("/api/agenda", createAgendaApi());

  // --- Run Queue -------------------------------------------------------
  app.route("/api/queue", createQueueApi());

  // --- Sessions (claude / codex / antigravity live filesystem browser) ------
  app.route("/api/sessions", createSessionsApi());

  // --- Repos / Promise Ledger summary (Unfinished Business lane) -----
  app.route("/api/repos", createReposPromiseApi());

  // --- Repos / agent-journal summary (per-card .agents/ chips) -------
  app.route("/api/repos", createReposJournalsApi());

  // --- Scan (discover repos + tracked allowlist) -----------------------
  app.route("/api", createScanApi());

  // --- Repos / Contexts ------------------------------------------------
  app.get("/api/repos", (c) => {
    const db = new RelayDB();
    const stats = db.repoStats();
    const githubSourceIds = db.firstGithubSourceIdPerRepo();
    const myOpenPrs = db.myOpenPrCountPerRepo();
    db.close();
    const cfg = loadConfig();

    // Map of repo name → absolute path the user explicitly tracked. Lets the
    // enrichment step look up out-of-tree (scan.roots-外) paths whose repo
    // metadata resolveRepoPath() would otherwise miss, and lets us surface
    // tracked repos that have zero tasks yet as "added but empty" entries.
    const trackedByName = new Map<string, string>();
    for (const p of cfg.scan.tracked_repos) {
      trackedByName.set(basename(p), p);
    }

    // Synthesize zero-stats rows for tracked repos that haven't produced any
    // tasks yet — `relay sync` may still find none (no TODOs, no .agents/*.md,
    // no relevant remote) but the repo card should appear because the user
    // asked for it explicitly.
    const knownNames = new Set(stats.map((r) => r.name));
    const trackedOnly = cfg.scan.tracked_repos
      .filter((p) => !knownNames.has(basename(p)))
      .map((p) => ({
        name: basename(p),
        open: 0,
        in_progress: 0,
        snoozed: 0,
        // Use last-commit time when available so "recent" sort still groups
        // active tracked repos near the top; otherwise fall back to epoch.
        lastTouched: readRepoMetadata(p).lastCommitAt ?? new Date(0).toISOString(),
        dailyEventCounts: [] as number[],
      }));
    const allStats = [...stats, ...trackedOnly];

    // Annotate each repo with disk-existence + remote metadata. Remote URL
    // comes from `.git/config` for repos that exist locally, otherwise we
    // derive a GitHub URL from any github_issue/pr task's source_id so the
    // info survives even after the local directory is deleted.
    const enriched = allStats.map((r) => {
      const trackedPath = trackedByName.get(r.name);
      const path = trackedPath ?? resolveRepoPath(r.name, cfg);
      const meta = readRepoMetadata(path);
      const githubUrl =
        meta.githubUrl ??
        (() => {
          const sid = githubSourceIds.get(r.name);
          return sid ? deriveGithubUrlFromSourceId(sid) : null;
        })();
      return {
        ...r,
        exists: path !== null && existsSync(path),
        github_url: githubUrl,
        default_branch: meta.defaultBranch,
        last_commit_sha: meta.lastCommitSha,
        last_commit_at: meta.lastCommitAt,
        my_open_prs: myOpenPrs.get(r.name) ?? 0,
      };
    });
    return c.json(enriched);
  });

  app.get("/api/repos/:name/path", (c) => {
    const cfg = loadConfig();
    const path = resolveRepoPath(c.req.param("name"), cfg);
    if (!path) return c.json({ error: "not found in scan.roots" }, 404);
    return c.json({ path });
  });

  app.route("/api/repos", createRepoAgentsApi());

  app.route("/api/contexts", createContextsApi());

  // --- Focus -----------------------------------------------------------
  // Singleton focus state — backed by ~/.relay/state.json, not the DB.
  // GET returns the current focus (null when unset). POST {id: number}
  // sets focus; POST {id: null} clears. The Web Today view collapses to
  // a single card when focus_task_id is non-null.
  app.get("/api/focus", (c) => {
    return c.json({ focus_task_id: getFocus() });
  });
  app.post("/api/focus", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { id?: number | null }
      | null;
    if (!body || !("id" in body)) {
      return c.json({ error: "body must include `id` (number | null)" }, 400);
    }
    if (body.id === null) {
      clearFocus();
      return c.json({ focus_task_id: null });
    }
    if (typeof body.id !== "number" || !Number.isFinite(body.id)) {
      return c.json({ error: "`id` must be a finite number or null" }, 400);
    }
    const db = new RelayDB();
    const task = db.getTask(body.id);
    db.close();
    if (!task) return c.json({ error: "task not found" }, 404);
    setFocus(body.id);
    return c.json({ focus_task_id: body.id });
  });

  // --- Sync ------------------------------------------------------------
  app.route("/api/sync", createSyncApi());

  // Streaming sync — emits one SSE event per adapter so the browser can
  // show live progress instead of waiting for the whole run. After all
  // adapters complete, auto-prune fs-bound tasks from missing repos and
  // emit a `prune_complete` (or `prune_error`) event before `done`.
  // Preview a sync run without writing to DB. Same SSE shape as
  // /api/sync/stream so the Web UI can reuse the event handlers.
  app.get("/api/sync/preview", (c) => {
    const source = c.req.query("adapter") ?? c.req.query("source");
    return streamSSE(c, async (stream) => {
      await runSync({
        source: source ?? undefined,
        dryRun: true,
        onEvent: async (event) => {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        },
      });
    });
  });

  app.get("/api/sync/stream", (c) => {
    const source = c.req.query("adapter") ?? c.req.query("source");
    return streamSSE(c, async (stream) => {
      await runSync({
        source: source ?? undefined,
        onEvent: async (event) => {
          if (event.type === "done") {
            // Auto-prune missing-repo fs-bound tasks (Web-only).
            // Failures are non-fatal — sync itself already succeeded.
            try {
              const pruneResult = pruneMissingRepos({
                includeDone: true,
                execute: true,
              });
              const perRepoTop = pruneResult.missingRepos
                .slice(0, 3)
                .map((repo) => ({
                  repo,
                  open: pruneResult.perRepoOpen.find((r) => r.repo === repo)?.count ?? 0,
                  done: pruneResult.perRepoDone.find((r) => r.repo === repo)?.count ?? 0,
                }));
              await stream.writeSSE({
                event: "prune_complete",
                data: JSON.stringify({
                  missingRepoCount: pruneResult.missingRepos.length,
                  closedCount: pruneResult.closedCount,
                  deletedCount: pruneResult.deletedCount,
                  perRepoTop,
                }),
              });
            } catch (pruneErr) {
              const message =
                pruneErr instanceof Error ? pruneErr.message : String(pruneErr);
              await stream.writeSSE({
                event: "prune_error",
                data: JSON.stringify({ message }),
              });
            }
          }
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        },
      });
    });
  });

  // --- Static (SPA fallback) -------------------------------------------
  app.get("*", (c) => serveStatic(c.req.path));

  return app;
}

function transitionStatus(c: Context, status: string) {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
  const db = new RelayDB();
  const task = db.getTask(id);
  if (!task) {
    db.close();
    return c.json({ error: "not found" }, 404);
  }
  db.setStatus(id, status);
  const updated = db.getTask(id);
  if (updated) {
    db.recordUndo({
      op_kind: opKindForStatus(status),
      payload: { tasks: [snapshotTask(updated)] },
      inverse: { tasks: [snapshotTask(task)] },
    });
  }
  db.close();
  return c.json(updated);
}

const ASSIGNEES = new Set([
  "claude-code",
  "codex",
  "antigravity",
  "self",
  "human-review",
]);

async function reassign(c: Context) {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "bad id" }, 400);
  const body = (await c.req.json().catch(() => null)) as { assignee?: string } | null;
  const assignee = body?.assignee;
  if (!assignee || !ASSIGNEES.has(assignee)) {
    return c.json({ error: "invalid assignee", allowed: [...ASSIGNEES] }, 400);
  }
  const db = new RelayDB();
  const before = db.getTask(id);
  if (!before) {
    db.close();
    return c.json({ error: "not found" }, 404);
  }
  if (before.assignee === assignee) {
    db.close();
    return c.json(before);
  }
  db.setAssignee(id, assignee);
  const after = db.getTask(id);
  if (after) {
    db.recordUndo({
      op_kind: "reassign",
      payload: { tasks: [{ id, assignee: after.assignee }] },
      inverse: { tasks: [{ id, assignee: before.assignee }] },
    });
  }
  db.close();
  return c.json(after);
}

function opKindForStatus(status: string): string {
  if (status === "snoozed") return "snooze";
  if (status === "done") return "close";
  if (status === "open") return "reopen";
  return status;
}

function snapshotTask(task: {
  id: number;
  status: "open" | "in_progress" | "blocked" | "snoozed" | "done";
  due_at: string | null;
  closed_at: string | null;
}) {
  return {
    id: task.id,
    status: task.status,
    due_at: task.due_at,
    closed_at: task.closed_at,
  };
}

function serveStatic(path: string): Response {
  const candidates = candidatePaths(path);
  for (const root of ASSET_ROOTS) {
    for (const rel of candidates) {
      const abs = join(root, rel);
      if (!abs.startsWith(root)) continue; // path-traversal guard
      if (existsSync(abs) && isFile(abs)) {
        const mime = MIME[extname(abs).toLowerCase()] ?? "application/octet-stream";
        return new Response(readFileSync(abs), {
          headers: { "content-type": mime, "cache-control": "no-store" },
        });
      }
    }
  }
  // Frontend missing — return a friendly hint instead of 404 for /
  if (path === "/" || path === "/index.html") {
    return new Response(missingFrontendPage(), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response("not found", { status: 404 });
}

function candidatePaths(reqPath: string): string[] {
  // Normalize: strip leading slash, treat "/" as "index.html".
  const p = reqPath.replace(/^\/+/, "");
  if (!p || p.endsWith("/")) return [`${p}index.html`];
  return [p, `${p}.html`, `${p}/index.html`];
}

function isFile(p: string): boolean {
  try {
    const s = require("node:fs").statSync(p);
    return s.isFile();
  } catch {
    return false;
  }
}

function detectFrontend(): "nextjs" | "vanilla" | "missing" {
  if (existsSync(join(ROOT, "nextjs", "out", "index.html"))) return "nextjs";
  if (existsSync(join(ROOT, "app", "index.html"))) return "vanilla";
  return "missing";
}

function missingFrontendPage(): string {
  return `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>relay — frontend not built</title>
  <style>
    body { background: #0d1117; color: #e6edf3; font: 14px/1.5 ui-sans-serif, system-ui; padding: 40px; max-width: 720px; margin: 0 auto; }
    h1 { font-size: 18px; margin: 0 0 8px; color: #7ee787; }
    code, pre { font-family: ui-monospace, Menlo, monospace; }
    pre { background: #161b22; padding: 14px 18px; border-radius: 6px; border: 1px solid #30363d; overflow-x: auto; }
    .muted { color: #8b949e; font-size: 13px; }
  </style>
</head><body>
  <h1>API is up · frontend is not built</h1>
  <p class="muted">The Hono backend at <code>:7340</code> is healthy. Run one command to install deps and build the Web UI:</p>
  <pre>relay setup</pre>
  <p class="muted">Then refresh this page. (Manual fallback: <code>cd web/nextjs &amp;&amp; bun install &amp;&amp; bun run build</code>)</p>
</body></html>`;
}
