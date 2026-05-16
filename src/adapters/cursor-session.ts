import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRepoForCwd } from "../lib/repo-from-cwd.js";
import { compileExcludePatterns, toSessionRow, truncate } from "../lib/session-helpers.js";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

/**
 * Scans Cursor's local data dirs and emits one task per open AI-plan todo.
 *
 * Cursor (a VSCode fork) stores AI artefacts under two roots:
 *
 *   ~/.cursor/plans/<name>_<hash>.plan.md      — Markdown + YAML frontmatter.
 *     The frontmatter carries `name`, `overview`, and a structured `todos: [{ id, content, status }]`
 *     list, where `status` is one of `pending` / `in_progress` / `completed` (Cursor "Agent Plan"
 *     feature). This is the highest-signal surface and serves as the primary ingest source.
 *
 *   ~/.cursor/chats/<md5(cwd)>/<agentId>/store.db  — SQLite with two tables
 *     (`meta`, `blobs`). `meta.value` is a hex-encoded JSON `{agentId, latestRootBlobId,
 *     name, mode, createdAt, lastUsedModel}`. The `blobs` table holds a Merkle DAG of
 *     proto-encoded message chunks (NOT extractable as todos). Used here only for
 *     metadata: when `store_body=true`, the chat title is emitted as a single low-signal
 *     task per agent session within `lookback_days`.
 *
 * Repo resolution:
 *   - Chat directory name is `md5(absolute project cwd)`. We reverse the hash by
 *     enumerating candidate cwds (one level under each scan root + tracked roots'
 *     parents) and hashing each, then look up the on-disk repo via the standard
 *     `.git` walk-up helper. Hashes that don't reverse (deleted repo, project
 *     outside scan.roots) are silently dropped.
 *   - Plan files don't directly carry cwd. They DO carry a `_<hash8>` suffix that
 *     is opaque, so plan-to-repo mapping is "if plan's todos all start with a clear
 *     file path containing a repo name we recognise, use that; otherwise drop".
 *     The simpler, more reliable strategy is to only emit plan todos when the plan
 *     itself appears alongside a chat directory whose md5 reverses cleanly. Since
 *     plans are global (`~/.cursor/plans/` is flat, not per-project), we instead
 *     bind each plan to whichever chat workspace updated last by mtime — this is
 *     a soft heuristic, accepted as part of the Cursor data-format risk listed in
 *     the issue.
 *
 * Privacy:
 *   - Adapter is **OFF by default** (`[adapters].cursor_session = false`) because
 *     Cursor chats can carry private prompts / credentials in plain text.
 *   - `[cursor_session].store_body` defaults to **false** even when the adapter is
 *     enabled, so the chat-meta fallback path stays opt-in.
 *
 * Format-change resilience:
 *   - Plan frontmatter parsed with a hand-rolled mini-YAML reader that only
 *     understands the subset Cursor writes (top-level scalars + a `todos:` list
 *     of `{id, content, status}` objects). Any parse failure is treated as
 *     "no todos here" rather than throwing.
 *   - Chat store.db schema (`meta` / `blobs`) is read defensively: missing
 *     tables, hex decode errors, or non-JSON values silently skip that agent.
 *   - When Cursor changes data format we expect the adapter to emit fewer (not
 *     wrong) tasks. A future hard switch (e.g. plans-as-protobuf) would surface
 *     as zero tasks ingested and is the trigger to revisit this file.
 */

interface PlanTodo {
  id: string;
  content: string;
  status: string;
}

interface PlanFile {
  planId: string; // filename without `.plan.md` suffix
  path: string;
  mtimeMs: number;
  name: string;
  overview: string;
  todos: PlanTodo[];
}

interface ChatMeta {
  agentId: string;
  name: string;
  mode: string;
  createdAt: number; // ms
}

export const cursorSessionAdapter: Adapter = {
  name: "cursor_session_todo",
  flagKeys: ["cursor_session"] as const,

  precheck() {
    const cursorRoot = join(homedir(), ".cursor");
    if (!existsSync(cursorRoot)) {
      return { skip: true, reason: `${cursorRoot} not found (Cursor not installed?)` };
    }
    const plansDir = join(cursorRoot, "plans");
    const chatsDir = join(cursorRoot, "chats");
    if (!existsSync(plansDir) && !existsSync(chatsDir)) {
      return {
        skip: true,
        reason: `${cursorRoot} has neither plans/ nor chats/ (no Cursor AI history yet)`,
      };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const cursorRoot = join(homedir(), ".cursor");
    const plansDir = join(cursorRoot, "plans");
    const chatsDir = join(cursorRoot, "chats");

    const excludes = ctx.cursorSession?.excludePatterns ?? [];
    const isExcluded = compileExcludePatterns(excludes);
    const storeBody = ctx.cursorSession?.storeBody ?? false;
    const lookbackDays = ctx.cursorSession?.lookbackDays ?? 14;
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    // F-1 Phase D: mtime-based incremental cursor.
    //  - plan.md: mtime changes every time Cursor rewrites todos → safe.
    //  - chat store.db: SQLite WAL/commits bump mtime per chat update →
    //    safe witness for the chat-meta task (we only read `meta.value`
    //    which is set once at session start, so an unchanged mtime trivially
    //    implies "nothing new to ingest").
    // Cursor's `fetchResolved` deliberately bypasses this skip — closed-todo
    // detection must re-scan all plans regardless of mtime cursor so a plan
    // that flipped to `completed` last sync isn't missed on the next one.
    const cursorMs = parseCursorMs(ctx.lastSyncCursor);

    // Build md5(cwd) → cwd reverse map by hashing every candidate path the user
    // is plausibly working in. Same trick as gemini-session (sha256 over
    // ~/.gemini/projects.json) but with md5 and the scan-roots enumeration.
    const hashToCwd = await buildCwdHashMap(ctx);

    const tasks: TaskInput[] = [];

    // --- Primary source: plan files ---
    const plans = await loadPlans(plansDir, isExcluded, cutoff, ctx);
    const freshPlans =
      cursorMs !== null ? plans.filter((p) => p.mtimeMs > cursorMs) : plans;
    if (freshPlans.length > 0) {
      // Heuristic: bind each plan to the most-recently-touched chat workspace
      // whose md5 we can reverse to a real repo. Plans are global, so this is
      // the best signal Cursor exposes locally without state.vscdb access.
      // `mostRecentChatRepo` walks the chats dir regardless of `cursorMs` —
      // the heuristic intentionally picks the freshest workspace, which is
      // the one we want the plan associated with even when its own mtime
      // didn't move this sync.
      const planRepo = await mostRecentChatRepo(chatsDir, hashToCwd, ctx.roots, cutoff);

      for (const plan of freshPlans) {
        if (planRepo) {
          for (const todo of plan.todos) {
            if (todo.status === "completed") continue;
            tasks.push({
              source_type: "cursor_session_todo",
              source_id: `cursor:plan:${plan.planId}:${todo.id}`,
              repo: planRepo,
              title: truncate(todo.content || "(empty todo)", 120),
              body: storeBody ? formatPlanBody(plan, todo) : "",
              status: todo.status === "in_progress" ? "in_progress" : "open",
              assignee: "self",
              priority: 55,
              prompt: null,
              files: [],
              context_hash: null,
              session_id: plan.planId,
              due_at: null,
              wait_on: "self",
            });
          }
        } else {
          ctx.log?.(`  ⊘ plan ${plan.planId}: no associated repo found`);
        }

        // F-1 Phase B: sessions table row per plan. `planRepo` is the
        // best-effort heuristic value (most recently touched chat workspace);
        // null when no chat reverse-resolves cleanly. The plan id alone is
        // unique across all Cursor plans, so we namespace the sessions.id
        // with a `plan:` prefix to make room for the `chat:`-prefixed rows
        // below (chats and plans live in distinct id spaces).
        if (ctx.db && !ctx.dryRun) {
          try {
            const iso = new Date(plan.mtimeMs).toISOString();
            ctx.db.upsertSession(
              toSessionRow({
                id: `plan:${plan.planId}`,
                type: "cursor",
                repo: planRepo,
                cwd: null, // plan files don't carry cwd directly
                startedAt: iso,
                lastActive: iso,
                messageCount: plan.todos.length,
                sourcePath: plan.path,
              }),
            );
          } catch (err) {
            console.warn(
              `[cursor-session] plan upsert failed: ${plan.planId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }

    // --- Secondary source: chat session metadata (opt-in via store_body) ---
    if (storeBody && existsSync(chatsDir)) {
      const chatTasks = await loadChatMetaTasks(
        chatsDir,
        hashToCwd,
        ctx.roots,
        isExcluded,
        cutoff,
        cursorMs,
        ctx,
      );
      tasks.push(...chatTasks);
    }

    return tasks;
  },

  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    // Same plan walk as fetch(), but emit any todo whose current status is
    // "completed". autoCloseResolvedRemoteTasks will mark matching DB rows
    // done. Closed chats have no terminal marker (Cursor doesn't expose a
    // "this conversation is archived" flag on disk), so we don't generate
    // resolved entries for chat-meta tasks.
    const cursorRoot = join(homedir(), ".cursor");
    const plansDir = join(cursorRoot, "plans");
    if (!existsSync(plansDir)) return [];

    const excludes = ctx.cursorSession?.excludePatterns ?? [];
    const isExcluded = compileExcludePatterns(excludes);

    const plans = await loadPlans(plansDir, isExcluded, 0, ctx);
    const resolved: ResolvedSource[] = [];
    for (const plan of plans) {
      for (const todo of plan.todos) {
        if (todo.status === "completed") {
          resolved.push({
            source_type: "cursor_session_todo",
            source_id: `cursor:plan:${plan.planId}:${todo.id}`,
          });
        }
      }
    }
    return resolved;
  },
};

async function buildCwdHashMap(ctx: AdapterContext): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const root of ctx.roots) {
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(root, entry);
      let s;
      try {
        s = await stat(full);
      } catch {
        continue;
      }
      if (!s.isDirectory()) continue;
      const hash = createHash("md5").update(full).digest("hex");
      map.set(hash, full);

      // Cursor often opens sub-projects of a monorepo (apps/<svc>) directly,
      // so include one extra level. Same depth as scan.max_depth=2 default.
      let subs: string[];
      try {
        subs = await readdir(full);
      } catch {
        continue;
      }
      for (const sub of subs) {
        if (sub.startsWith(".")) continue;
        const subFull = join(full, sub);
        let ss;
        try {
          ss = await stat(subFull);
        } catch {
          continue;
        }
        if (!ss.isDirectory()) continue;
        const subHash = createHash("md5").update(subFull).digest("hex");
        map.set(subHash, subFull);
      }
    }
  }
  return map;
}

async function loadPlans(
  plansDir: string,
  isExcluded: (path: string) => boolean,
  cutoffMs: number,
  ctx: AdapterContext,
): Promise<PlanFile[]> {
  if (!existsSync(plansDir)) return [];
  let entries: string[];
  try {
    entries = await readdir(plansDir);
  } catch {
    return [];
  }

  const out: PlanFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".plan.md")) continue;
    const full = join(plansDir, entry);
    if (isExcluded(full)) {
      ctx.log?.(`  ⊘ excluded: ${full}`);
      continue;
    }
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (cutoffMs > 0 && s.mtimeMs < cutoffMs) continue;

    if (ctx.dryRun) ctx.log?.(`  ✓ would read: ${full}`);

    const text = await readFile(full, "utf8").catch(() => "");
    if (!text) continue;
    const parsed = parsePlanFrontmatter(text);
    if (!parsed) continue;

    out.push({
      planId: entry.replace(/\.plan\.md$/, ""),
      path: full,
      mtimeMs: s.mtimeMs,
      name: parsed.name,
      overview: parsed.overview,
      todos: parsed.todos,
    });
  }
  return out;
}

/**
 * Parse the subset of YAML frontmatter Cursor writes for plan files:
 *
 *   ---
 *   name: <single-line scalar>
 *   overview: <single-line scalar>
 *   todos:
 *     - id: <scalar>
 *       content: <scalar>
 *       status: <scalar>
 *     - id: ...
 *   ---
 *
 * Returns null if the frontmatter is absent, malformed, or carries no todos.
 * We deliberately do not pull in a full YAML parser: the surface here is
 * small enough to read by hand, and a strict reader fails closed when Cursor
 * adds new fields (we just skip them and keep the todos we recognise).
 */
function parsePlanFrontmatter(
  text: string,
): { name: string; overview: string; todos: PlanTodo[] } | null {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*(\n|$)/);
  if (!match) return null;
  const fm = match[1] ?? "";
  const lines = fm.split("\n");

  let name = "";
  let overview = "";
  const todos: PlanTodo[] = [];
  let cursor: { id: string; content: string; status: string } | null = null;
  let inTodos = false;

  const flushCursor = () => {
    if (cursor && cursor.id && cursor.content) {
      todos.push({
        id: cursor.id,
        content: cursor.content,
        status: cursor.status || "pending",
      });
    }
    cursor = null;
  };

  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (raw.startsWith("todos:")) {
      flushCursor();
      inTodos = true;
      continue;
    }
    if (!inTodos) {
      const m = raw.match(/^(name|overview):\s*(.*)$/);
      if (m && m[1] && m[2] !== undefined) {
        const val = unquote(m[2]);
        if (m[1] === "name") name = val;
        else overview = val;
      }
      continue;
    }

    // Inside `todos:`. A new entry starts with `- id:`; sub-fields are
    // indented `id`/`content`/`status` lines.
    const itemStart = raw.match(/^\s*-\s*id:\s*(.*)$/);
    if (itemStart && itemStart[1] !== undefined) {
      flushCursor();
      cursor = { id: unquote(itemStart[1]), content: "", status: "" };
      continue;
    }
    const sub = raw.match(/^\s+(id|content|status):\s*(.*)$/);
    if (sub && cursor && sub[1] && sub[2] !== undefined) {
      const v = unquote(sub[2]);
      if (sub[1] === "id") cursor.id = v;
      else if (sub[1] === "content") cursor.content = v;
      else if (sub[1] === "status") cursor.status = v;
    }
  }
  flushCursor();

  if (todos.length === 0) return null;
  return { name, overview, todos };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2) {
    const first = t[0];
    const last = t[t.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return t.slice(1, -1);
    }
  }
  return t;
}

function formatPlanBody(plan: PlanFile, todo: PlanTodo): string {
  const lines: string[] = [];
  lines.push(`From Cursor plan \`${plan.planId}\` (status: ${todo.status}).`);
  if (plan.name) lines.push(`plan: ${plan.name}`);
  if (plan.overview) lines.push(`overview: ${plan.overview}`);
  return lines.join("\n");
}

async function mostRecentChatRepo(
  chatsDir: string,
  hashToCwd: Map<string, string>,
  roots: string[],
  cutoffMs: number,
): Promise<string | null> {
  if (!existsSync(chatsDir)) return null;
  let entries: string[];
  try {
    entries = await readdir(chatsDir);
  } catch {
    return null;
  }

  let best: { repo: string; mtimeMs: number } | null = null;
  for (const hash of entries) {
    const cwd = hashToCwd.get(hash);
    if (!cwd) continue;
    const dir = join(chatsDir, hash);
    let s;
    try {
      s = await stat(dir);
    } catch {
      continue;
    }
    if (cutoffMs > 0 && s.mtimeMs < cutoffMs) continue;
    const repo = resolveRepoForCwd(cwd, roots);
    if (!repo) continue;
    if (!best || s.mtimeMs > best.mtimeMs) best = { repo, mtimeMs: s.mtimeMs };
  }
  return best?.repo ?? null;
}

async function loadChatMetaTasks(
  chatsDir: string,
  hashToCwd: Map<string, string>,
  roots: string[],
  isExcluded: (path: string) => boolean,
  cutoffMs: number,
  cursorMs: number | null,
  ctx: AdapterContext,
): Promise<TaskInput[]> {
  let entries: string[];
  try {
    entries = await readdir(chatsDir);
  } catch {
    return [];
  }

  const tasks: TaskInput[] = [];
  for (const hash of entries) {
    const cwd = hashToCwd.get(hash);
    if (!cwd) continue;
    const repo = resolveRepoForCwd(cwd, roots);
    if (!repo) continue;
    const hashDir = join(chatsDir, hash);

    let agents: string[];
    try {
      agents = await readdir(hashDir);
    } catch {
      continue;
    }

    for (const agent of agents) {
      const agentDir = join(hashDir, agent);
      const sdb = join(agentDir, "store.db");
      if (!existsSync(sdb)) continue;
      if (isExcluded(sdb)) {
        ctx.log?.(`  ⊘ excluded: ${sdb}`);
        continue;
      }
      // Incremental skip via store.db mtime — SQLite writes (chat updates)
      // touch the file even when `meta.value` itself is unchanged, so a
      // stale mtime guarantees nothing new for the chat-meta path. Stat
      // failure falls through to the existing readChatMeta which already
      // tolerates corrupt/missing rows.
      if (cursorMs !== null) {
        const sdbStat = await stat(sdb).catch(() => null);
        if (sdbStat && sdbStat.mtimeMs <= cursorMs) continue;
      }
      const meta = await readChatMeta(sdb);
      if (!meta) continue;
      if (cutoffMs > 0 && meta.createdAt < cutoffMs) continue;
      if (ctx.dryRun) ctx.log?.(`  ✓ would read: ${sdb}`);

      const title = truncate(meta.name || "(unnamed Cursor chat)", 120);
      tasks.push({
        source_type: "cursor_session_todo",
        source_id: `cursor:chat:${meta.agentId}`,
        repo,
        title,
        body: `From Cursor chat \`${meta.agentId}\` (mode: ${meta.mode}, cwd: ${cwd}).`,
        status: "in_progress",
        assignee: "self",
        priority: 50,
        prompt: null,
        files: [],
        context_hash: null,
        session_id: meta.agentId,
        due_at: null,
        wait_on: "self",
      });

      // F-1 Phase B: chat session row. `id` is prefixed `chat:` so it
      // doesn't collide with plan rows under the same `type=cursor`.
      // Sessions table contains only metadata (no chat body), so this is
      // safe to write even though `storeBody=false` blocks the body field
      // on the corresponding TaskInput.
      if (ctx.db && !ctx.dryRun) {
        try {
          const iso = new Date(meta.createdAt).toISOString();
          ctx.db.upsertSession(
            toSessionRow({
              id: `chat:${meta.agentId}`,
              type: "cursor",
              repo,
              cwd,
              startedAt: iso,
              lastActive: iso,
              messageCount: 0, // chat blobs are encoded protobufs — can't count cheaply
              sourcePath: sdb,
            }),
          );
        } catch (err) {
          console.warn(
            `[cursor-session] chat upsert failed: ${meta.agentId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
  return tasks;
}

/**
 * Convert an ISO 8601 cursor (`ctx.lastSyncCursor`) into millis for direct
 * comparison against `fs.Stats.mtimeMs`. Returns null when the cursor is
 * absent or unparseable so callers fall back to a full sweep.
 */
function parseCursorMs(cursor: string | undefined): number | null {
  if (!cursor) return null;
  const ms = Date.parse(cursor);
  return Number.isFinite(ms) ? ms : null;
}

async function readChatMeta(sdbPath: string): Promise<ChatMeta | null> {
  // `bun:sqlite` is used elsewhere in the codebase; import dynamically so
  // adapter still compiles + runs under plain node (e.g. some CI tools).
  let Database: typeof import("bun:sqlite").Database;
  try {
    ({ Database } = (await import("bun:sqlite")) as typeof import("bun:sqlite"));
  } catch {
    return null;
  }
  let db;
  try {
    db = new Database(sdbPath, { readonly: true });
  } catch {
    return null;
  }
  try {
    const row = db
      .prepare("SELECT value FROM meta LIMIT 1")
      .get() as { value: string } | null;
    if (!row?.value) return null;
    let decoded: string;
    try {
      decoded = Buffer.from(row.value, "hex").toString("utf8");
    } catch {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const agentId = typeof obj.agentId === "string" ? obj.agentId : null;
    const name = typeof obj.name === "string" ? obj.name : "";
    const mode = typeof obj.mode === "string" ? obj.mode : "";
    const createdAt = typeof obj.createdAt === "number" ? obj.createdAt : 0;
    if (!agentId) return null;
    return { agentId, name, mode, createdAt };
  } catch {
    return null;
  } finally {
    db.close();
  }
}
