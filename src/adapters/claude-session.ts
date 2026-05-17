import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRepoForCwd } from "../lib/repo-from-cwd.js";
import { compileExcludePatterns, toSessionRow, truncate } from "../lib/session-helpers.js";
import { detectClaudeSessionStatus } from "../lib/session-status.js";
import type { Adapter, AdapterContext, SessionStatus, TaskInput } from "../types.js";

/**
 * Scans ~/.claude/projects/<project-hash>/<session-uuid>.jsonl for the latest
 * task list per project and turns unfinished items into tasks.
 *
 * Also scans <project-hash>/<parent-session-id>/subagents/agent-*.jsonl for
 * subagent sessions spawned via the Claude Code Agent tool. Each subagent is
 * treated as an independent session with its own TODO list.
 *
 * Tracks two tool conventions:
 *   - `TaskCreate` / `TaskUpdate` (current): individual events with monotonic
 *     numeric ids ("1", "2", ...). `TaskUpdate.status` mutates by id.
 *   - `TodoWrite` (legacy): a single tool call replaces the entire list.
 *
 * Repo name is inferred from the event-level `cwd` field (an absolute path
 * under `scan.roots`) — far more reliable than parsing the kebab-cased
 * project directory name, which silently truncates hyphenated repo names.
 */

interface SessionTask {
  id: string;
  title: string;
  status: string;
}

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal discriminated-union for tool events parsed from a jsonl file.
// ---------------------------------------------------------------------------

interface TaskCreateEvent {
  kind: "TaskCreate";
  subject: string;
}

interface TaskUpdateEvent {
  kind: "TaskUpdate";
  taskId: string;
  status: string;
}

interface TodoItem {
  id: string;
  content: string;
  status: string;
}

interface TodoWriteEvent {
  kind: "TodoWrite";
  todos: TodoItem[];
}

type ToolEvent = TaskCreateEvent | TaskUpdateEvent | TodoWriteEvent;

export const claudeSessionAdapter: Adapter = {
  name: "claude_session_todo",
  flagKeys: ["claude_session"] as const,

  precheck() {
    const projectsRoot = join(homedir(), ".claude", "projects");
    if (!existsSync(projectsRoot)) {
      return { skip: true, reason: `${projectsRoot} not found (Claude Code not installed?)` };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const projectsRoot = join(homedir(), ".claude", "projects");
    const tasks: TaskInput[] = [];
    const excludes = ctx.claudeSession?.excludePatterns ?? [];
    const isExcluded = compileExcludePatterns(excludes);
    const storeBody = ctx.claudeSession?.storeBody ?? true;
    const lookbackDays = ctx.claudeSession?.lookbackDays ?? 7;
    const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    // F-1 Phase D: mtime-based incremental cursor. When the previous successful
    // sync left a `lastSyncCursor` (ISO 8601), skip every JSONL whose mtime
    // is at or before that timestamp — the session content (cwd, todos,
    // message count) is identical to what we ingested last time, so re-running
    // task ingest + session upsert would just thrash with idempotent no-ops.
    // First-ever sync (cursor undefined) → cursorMs = null → full sweep.
    // A garbled cursor string (Date.parse → NaN) also falls back to full
    // sweep, never silently dropping sessions.
    const cursorMs = parseCursorMs(ctx.lastSyncCursor);

    let projects: string[];
    try {
      projects = await readdir(projectsRoot);
    } catch {
      return tasks;
    }

    for (const project of projects) {
      const projectDir = join(projectsRoot, project);
      const entries = await readdir(projectDir).catch(() => []);
      const jsonls = entries.filter((f) => f.endsWith(".jsonl"));

      // Process parent sessions: all JSONLs within the lookback window.
      if (jsonls.length > 0) {
        const candidates = await pickWithinLookback(projectDir, jsonls, cutoffMs);
        for (const candidate of candidates) {
          const sessionId = candidate.name.replace(/\.jsonl$/, "");
          const fullPath = join(projectDir, candidate.name);

          if (isExcluded(fullPath)) {
            ctx.log?.(`  ⊘ excluded: ${fullPath}`);
            continue;
          }

          // Incremental skip: mtime unchanged since last sync ⇒ contents
          // unchanged ⇒ no new tasks AND session-row already matches.
          if (cursorMs !== null && candidate.mtime <= cursorMs) continue;

          if (ctx.dryRun) {
            ctx.log?.(`  ✓ would read: ${fullPath}`);
          }

          const { cwd, sessionTasks, messageCount, status, lastMessageText } =
            await parseSession(fullPath);
          const repo = resolveRepoForCwd(cwd, ctx.roots) ?? legacyProjectToRepo(project);

          if (sessionTasks.length > 0 && repo) {
            for (const t of sessionTasks) {
              if (t.status === "completed") continue;
              tasks.push({
                source_type: "claude_session_todo",
                source_id: `${sessionId}:${t.id}`,
                repo,
                title: t.title,
                body: storeBody
                  ? `From Claude session \`${sessionId}\` (status: ${t.status}).`
                  : "",
                status: t.status === "in_progress" ? "in_progress" : "open",
                assignee: "claude-code",
                priority: 60,
                prompt: null,
                files: [],
                context_hash: null,
                session_id: sessionId,
                due_at: null,
                wait_on: "self",
              });
            }
          }

          // F-1 Phase B: upsert into `sessions` regardless of todo presence —
          // the row is interesting even when no live todos exist (e.g. a
          // finished session still counts toward /insights activity heatmap).
          // Best-effort: failures here MUST NOT taint the task ingest path.
          if (ctx.db && !ctx.dryRun) {
            try {
              const iso = new Date(candidate.mtime).toISOString();
              ctx.db.upsertSession(
                toSessionRow({
                  id: sessionId,
                  type: "claude",
                  repo,
                  cwd,
                  startedAt: iso,
                  lastActive: iso,
                  messageCount,
                  sourcePath: fullPath,
                  status,
                  lastMessageText,
                }),
              );
            } catch (err) {
              console.warn(
                `[claude-session] session upsert failed: ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
      }

      // Process subagent sessions: <projectDir>/<parent-uuid>/subagents/agent-*.jsonl
      const subdirs = entries.filter((e) => isUuid(e));
      for (const subdir of subdirs) {
        const subagentsDir = join(projectDir, subdir, "subagents");
        const agentFiles = await readdir(subagentsDir).catch(() => []);
        const agentJsonls = agentFiles.filter((f) => f.startsWith("agent-") && f.endsWith(".jsonl"));

        for (const agentFile of agentJsonls) {
          const agentId = agentFile.replace(/\.jsonl$/, ""); // e.g. "agent-a920f50"
          const fullPath = join(subagentsDir, agentFile);

          if (isExcluded(fullPath)) {
            ctx.log?.(`  ⊘ excluded (subagent): ${fullPath}`);
            continue;
          }

          if (ctx.dryRun) {
            ctx.log?.(`  ✓ would read (subagent): ${fullPath}`);
          }

          // Subagent jsonls don't pass through pickWithinLookback so we stat
          // here. Outside-window subagents are still upserted: live ingest
          // happens here, the lookback gate primarily exists for the parent
          // session loop where the gate also bounds the read cost.
          const subStat = await stat(fullPath).catch(() => null);
          const subMtimeMs = subStat?.mtimeMs ?? Date.now();

          // Incremental skip for subagent file as well. If stat failed
          // (subStat=null) we fell back to Date.now() above, which always
          // beats cursor — so a stat failure conservatively re-processes.
          if (cursorMs !== null && subStat && subMtimeMs <= cursorMs) continue;

          const { cwd, sessionTasks, messageCount, status, lastMessageText } =
            await parseSession(fullPath);
          const repo = resolveRepoForCwd(cwd, ctx.roots) ?? legacyProjectToRepo(project);

          if (sessionTasks.length > 0 && repo) {
            for (const t of sessionTasks) {
              if (t.status === "completed") continue;
              tasks.push({
                source_type: "claude_session_todo",
                source_id: `${agentId}:${t.id}`,
                repo,
                title: t.title,
                body: storeBody
                  ? `From Claude subagent \`${agentId}\` (parent: \`${subdir}\`, status: ${t.status}).`
                  : "",
                status: t.status === "in_progress" ? "in_progress" : "open",
                assignee: "claude-code",
                priority: 60,
                prompt: null,
                files: [],
                context_hash: null,
                session_id: agentId,
                due_at: null,
                wait_on: "self",
              });
            }
          }

          // F-1 Phase B: subagent rows carry their parent uuid so Phase C can
          // surface "Claude session X spawned N subagents" without re-walking
          // the filesystem.
          if (ctx.db && !ctx.dryRun) {
            try {
              const iso = new Date(subMtimeMs).toISOString();
              ctx.db.upsertSession(
                toSessionRow({
                  id: agentId,
                  type: "claude",
                  repo,
                  cwd,
                  startedAt: iso,
                  lastActive: iso,
                  messageCount,
                  parentSessionId: subdir,
                  sourcePath: fullPath,
                  status,
                  lastMessageText,
                }),
              );
            } catch (err) {
              console.warn(
                `[claude-session] subagent upsert failed: ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
      }
    }

    return tasks;
  },
};

/** UUID v4 形式 (8-4-4-4-12 hex) のディレクトリ名かを判定する */
function isUuid(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name);
}

/**
 * Returns all JSONL files whose mtime is at or after `cutoffMs`, sorted by
 * mtime descending (newest first). Files that cannot be stat-ed are skipped.
 * Deduplication is not needed here because each file name is unique within the
 * directory listing provided by the caller.
 *
 * `mtime` is preserved so callers can use it as the session's `last_active`
 * timestamp when populating the `sessions` table without an extra `stat` call.
 */
async function pickWithinLookback(
  dir: string,
  files: string[],
  cutoffMs: number,
): Promise<{ name: string; mtime: number }[]> {
  const candidates: { name: string; mtime: number }[] = [];
  for (const f of files) {
    try {
      const s = await stat(join(dir, f));
      if (s.mtimeMs >= cutoffMs) {
        candidates.push({ name: f, mtime: s.mtimeMs });
      }
    } catch {
      // skip unreadable files
    }
  }
  // Sort newest-first so callers process the most recent session first.
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates;
}

/**
 * Parse a jsonl text into a structured event list.
 * Extracts the first `cwd` seen in the file and collects all tool-use events
 * that match TaskCreate / TaskUpdate / TodoWrite.
 * Pure with respect to I/O — all file reading happens in the caller.
 */
function extractToolEvents(text: string): { cwd: string | null; events: ToolEvent[] } {
  const lines = text.split("\n");
  let cwd: string | null = null;
  const events: ToolEvent[] = [];

  for (const line of lines) {
    if (!line) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (!evt || typeof evt !== "object") continue;
    const obj = evt as Record<string, unknown>;

    if (!cwd && typeof obj.cwd === "string" && obj.cwd) {
      cwd = obj.cwd;
    }

    for (const block of getToolUseBlocks(obj)) {
      if (block.name === "TaskCreate") {
        const subject = typeof block.input.subject === "string" ? block.input.subject : "";
        if (subject) {
          events.push({ kind: "TaskCreate", subject });
        }
      } else if (block.name === "TaskUpdate") {
        const taskId = block.input.taskId;
        const status = block.input.status;
        if (typeof taskId === "string" && typeof status === "string") {
          events.push({ kind: "TaskUpdate", taskId, status });
        }
      } else if (block.name === "TodoWrite") {
        const todos = block.input.todos;
        if (Array.isArray(todos)) {
          const items: TodoItem[] = [];
          for (const todo of todos as Array<Record<string, unknown>>) {
            const id = typeof todo.id === "string" ? todo.id : String(todo.id ?? "");
            const content = typeof todo.content === "string" ? todo.content : "";
            const status = typeof todo.status === "string" ? todo.status : "pending";
            if (id && content) {
              items.push({ id, content, status });
            }
          }
          events.push({ kind: "TodoWrite", todos: items });
        }
      }
    }
  }

  return { cwd, events };
}

/**
 * Reduce a sequence of tool events into a final task list.
 * Pure function — no I/O, deterministic given the same event sequence.
 * Preserves the same semantics as the original monolithic parseSession:
 *   - TaskCreate uses a monotonic counter as id, namespaced with "tc-" prefix.
 *   - TaskUpdate mutates by the namespaced id.
 *   - TodoWrite replaces the entire list and resets the counter; ids are
 *     namespaced with "tw-" prefix to avoid collisions with TaskCreate ids.
 *
 * Namespace prefixes prevent source_id collisions when both TaskCreate and
 * TodoWrite appear in the same session (both use numeric ids starting from 1).
 */
function reduceEvents(events: ToolEvent[]): SessionTask[] {
  const tasks = new Map<string, SessionTask>();
  let taskCreateCount = 0;

  for (const event of events) {
    if (event.kind === "TaskCreate") {
      taskCreateCount += 1;
      const id = `tc-${taskCreateCount}`;
      tasks.set(id, { id, title: event.subject, status: "pending" });
    } else if (event.kind === "TaskUpdate") {
      // TaskUpdate.taskId is the raw numeric string from the tool call (e.g. "1").
      // Resolve against the current namespace by trying "tc-<taskId>" first,
      // then fall back to the bare key for forward-compat with any future
      // non-numeric ids.
      const namespacedKey = `tc-${event.taskId}`;
      const existing = tasks.get(namespacedKey) ?? tasks.get(event.taskId);
      if (existing) existing.status = event.status;
    } else if (event.kind === "TodoWrite") {
      tasks.clear();
      taskCreateCount = 0;
      for (const item of event.todos) {
        const id = `tw-${item.id}`;
        tasks.set(id, { id, title: item.content, status: item.status });
      }
    }
  }

  return [...tasks.values()];
}

async function parseSession(
  path: string,
): Promise<{
  cwd: string | null;
  sessionTasks: SessionTask[];
  messageCount: number;
  status: SessionStatus;
  lastMessageText: string | null;
}> {
  const text = await readFile(path, "utf8");
  const { cwd, events } = extractToolEvents(text);
  // Each non-empty line in a Claude JSONL is one event (user prompt, assistant
  // reply, tool use, etc). Used as `message_count` in the sessions table —
  // not a strict "messages only" count, but close enough for /insights ordering.
  let messageCount = 0;
  for (const line of text.split("\n")) {
    if (line.trim()) messageCount += 1;
  }
  // Status detection runs on the same text we just parsed — reusing the
  // string keeps this cheap (one extra tail walk, no second readFile).
  const status = detectClaudeSessionStatus(text);
  const lastMessageText = extractLastMessageText(text);
  return { cwd, sessionTasks: reduceEvents(events), messageCount, status, lastMessageText };
}

/**
 * Walk a Claude JSONL backwards to find the most recent user or assistant
 * message text. Returns a one-line preview truncated to 240 chars, or null
 * when the file has no extractable message body.
 *
 * Claude wraps the real role/content under `message.role` / `message.content`.
 * `content` can be a string or an array of text/tool blocks; we collect only
 * `type === "text"` blocks so tool outputs don't poison the preview.
 */
function extractLastMessageText(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (!evt || typeof evt !== "object") continue;
    const obj = evt as Record<string, unknown>;
    const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
    const role = (wrapper as Record<string, unknown>).role;
    if (role !== "user" && role !== "assistant") continue;
    const content = (wrapper as Record<string, unknown>).content;
    let body = "";
    if (typeof content === "string") {
      body = content;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const c of content) {
        if (c && typeof c === "object") {
          const block = c as Record<string, unknown>;
          if (block.type === "text" && typeof block.text === "string") {
            parts.push(block.text);
          }
        }
      }
      body = parts.join("\n");
    }
    const oneLine = firstSignificantLine(body);
    if (oneLine) return truncate(oneLine, 240);
  }
  return null;
}

function firstSignificantLine(s: string): string {
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return "";
}

function getToolUseBlocks(evt: Record<string, unknown>): ToolUse[] {
  const wrapper = (evt.message as Record<string, unknown> | undefined) ?? evt;
  const blocks = (wrapper as Record<string, unknown>).content;
  if (!Array.isArray(blocks)) return [];
  const out: ToolUse[] = [];
  for (const b of blocks) {
    if (
      b &&
      typeof b === "object" &&
      (b as Record<string, unknown>).type === "tool_use" &&
      typeof (b as Record<string, unknown>).name === "string"
    ) {
      const block = b as Record<string, unknown>;
      const input =
        block.input && typeof block.input === "object"
          ? (block.input as Record<string, unknown>)
          : {};
      out.push({ name: block.name as string, input });
    }
  }
  return out;
}

/**
 * Convert an ISO 8601 cursor (`ctx.lastSyncCursor`) into millis for direct
 * comparison against `fs.Stats.mtimeMs`. Returns null when the cursor is
 * absent or unparseable so callers can fall back to a full sweep instead of
 * silently dropping every session.
 */
function parseCursorMs(cursor: string | undefined): number | null {
  if (!cursor) return null;
  const ms = Date.parse(cursor);
  return Number.isFinite(ms) ? ms : null;
}

function legacyProjectToRepo(projectDir: string): string | null {
  // Fallback for sessions where cwd is absent (older format).
  // Known to truncate kebab-cased repo names — accepted as best-effort.
  const segments = projectDir.split("-").filter(Boolean);
  const ghIdx = segments.findIndex((s) => s === "github");
  if (ghIdx < 0 || segments.length <= ghIdx + 2) return null;
  return segments[ghIdx + 2] ?? null;
}
