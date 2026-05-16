import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRepoForCwd } from "../lib/repo-from-cwd.js";
import {
  compileExcludePatterns,
  firstNonEmptyLine,
  toSessionRow,
  truncate,
} from "../lib/session-helpers.js";
import type { Adapter, AdapterContext, TaskInput } from "../types.js";

/**
 * Scans ~/.gemini/tmp/<projectHash>/chats/session-*.json and emits one task
 * per session (all sessions within the lookback window).
 *
 * Gemini CLI stores each project's sessions under a folder named by the
 * SHA-256 of the absolute project root path. The hash → cwd reverse map is
 * built from ~/.gemini/projects.json so we can find which on-disk repo a
 * session belongs to. Gemini doesn't have an explicit "done" marker, so
 * every session within the lookback window is considered live.
 *
 * Multiple sessions from the same repo are all ingested as individual tasks.
 * The `priority_decay_days` mechanism attenuates older sessions so they do
 * not dominate `relay today`.
 */

interface GeminiParsed {
  projectHash: string | null;
  sessionId: string | null;
  firstUserMessage: string | null;
  lastUpdated: string | null;
  /** Total entries in the `messages` array — used as message_count. */
  messageCount: number;
}

export const geminiSessionAdapter: Adapter = {
  name: "gemini_session_todo",
  flagKeys: ["gemini_session"] as const,

  precheck() {
    const tmpRoot = join(homedir(), ".gemini", "tmp");
    if (!existsSync(tmpRoot)) {
      return { skip: true, reason: `${tmpRoot} not found (Gemini CLI not installed?)` };
    }
    // ~/.gemini/tmp/ alone is insufficient: without projects.json the hash →
    // cwd reverse map is empty and every session silently fails repo lookup.
    // Surface this as SKIPPED instead of a green-but-zero sync.
    const projectsJsonPath = join(homedir(), ".gemini", "projects.json");
    if (!existsSync(projectsJsonPath)) {
      return {
        skip: true,
        reason: "no entries in ~/.gemini/projects.json (use Gemini CLI at least once)",
      };
    }
    let text: string;
    try {
      text = readFileSync(projectsJsonPath, "utf8");
    } catch {
      return {
        skip: true,
        reason: "no entries in ~/.gemini/projects.json (use Gemini CLI at least once)",
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        skip: true,
        reason: "no entries in ~/.gemini/projects.json (use Gemini CLI at least once)",
      };
    }
    const projects =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).projects
        : null;
    if (!projects || typeof projects !== "object" || Object.keys(projects).length === 0) {
      return {
        skip: true,
        reason: "no entries in ~/.gemini/projects.json (use Gemini CLI at least once)",
      };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const tmpRoot = join(homedir(), ".gemini", "tmp");
    const excludes = ctx.geminiSession?.excludePatterns ?? [];
    const isExcluded = compileExcludePatterns(excludes);
    const storeBody = ctx.geminiSession?.storeBody ?? true;
    const lookbackDays = ctx.geminiSession?.lookbackDays ?? 7;
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    // F-1 Phase D: incremental cursor. Gemini's session JSON is rewritten
    // wholesale on every conversation update, so file mtime is a reliable
    // change witness for both first-user-message extraction and the
    // sessions row (messages.length, lastUpdated). First sync (cursor=null)
    // still does the full sweep; an unparseable cursor degrades safely.
    const cursorMs = parseCursorMs(ctx.lastSyncCursor);

    const hashToCwd = await loadHashToCwdMap();
    if (hashToCwd.size === 0) {
      ctx.log?.(`  ⊘ no entries in ~/.gemini/projects.json`);
      return [];
    }

    const dirs = await readdir(tmpRoot).catch(() => []);
    const candidates: Array<{ path: string; mtimeMs: number }> = [];
    for (const dir of dirs) {
      const chatsDir = join(tmpRoot, dir, "chats");
      if (!existsSync(chatsDir)) continue;
      const files = await readdir(chatsDir).catch(() => []);
      for (const f of files) {
        if (!f.startsWith("session-") || !f.endsWith(".json")) continue;
        const full = join(chatsDir, f);
        if (isExcluded(full)) {
          ctx.log?.(`  ⊘ excluded: ${full}`);
          continue;
        }
        const s = await stat(full).catch(() => null);
        if (!s || s.mtimeMs < cutoff) continue;
        // Cursor-based skip happens here (pre-collection) to avoid even the
        // readFile cost on unchanged sessions.
        if (cursorMs !== null && s.mtimeMs <= cursorMs) continue;
        candidates.push({ path: full, mtimeMs: s.mtimeMs });
      }
    }

    const tasks: TaskInput[] = [];
    for (const c of candidates) {
      const parsed = await parseGeminiSession(c.path);
      if (!parsed.projectHash || !parsed.sessionId) continue;

      const cwd = hashToCwd.get(parsed.projectHash) ?? null;
      const repo = cwd ? resolveRepoForCwd(cwd, ctx.roots) : null;

      // Task ingest requires a tracked repo; session-table ingest doesn't.
      // Same policy as codex-session: log Gemini sessions even when the
      // working directory is out-of-tree.
      if (cwd && repo) {
        const title = truncate(parsed.firstUserMessage ?? "(no prompt)", 120);
        tasks.push({
          source_type: "gemini_session_todo",
          source_id: parsed.sessionId,
          repo,
          title,
          body: storeBody ? `From Gemini session \`${parsed.sessionId}\` (cwd: ${cwd}).` : "",
          status: "in_progress",
          assignee: "gemini",
          priority: 55,
          prompt: null,
          files: [],
          context_hash: null,
          session_id: parsed.sessionId,
          due_at: null,
          wait_on: "self",
        });
      }

      // F-1 Phase B: upsert sessions row. Gemini provides `lastUpdated` in
      // the session JSON; use that as last_active when present (more
      // precise than file mtime), else fall back to mtime.
      if (ctx.db && !ctx.dryRun) {
        try {
          const mtimeIso = new Date(c.mtimeMs).toISOString();
          const lastActiveIso = parsed.lastUpdated ?? mtimeIso;
          ctx.db.upsertSession(
            toSessionRow({
              id: parsed.sessionId,
              type: "gemini",
              repo,
              cwd,
              startedAt: lastActiveIso,
              lastActive: lastActiveIso,
              messageCount: parsed.messageCount,
              sourcePath: c.path,
            }),
          );
        } catch (err) {
          console.warn(
            `[gemini-session] session upsert failed: ${parsed.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return tasks;
  },
};

async function loadHashToCwdMap(): Promise<Map<string, string>> {
  const projectsJsonPath = join(homedir(), ".gemini", "projects.json");
  const map = new Map<string, string>();
  let text: string;
  try {
    text = await readFile(projectsJsonPath, "utf8");
  } catch {
    return map;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return map;
  }
  if (!parsed || typeof parsed !== "object") return map;
  const projects = (parsed as Record<string, unknown>).projects;
  if (!projects || typeof projects !== "object") return map;
  for (const cwd of Object.keys(projects)) {
    const hash = createHash("sha256").update(cwd).digest("hex");
    map.set(hash, cwd);
  }
  return map;
}

async function parseGeminiSession(path: string): Promise<GeminiParsed> {
  const empty: GeminiParsed = {
    projectHash: null,
    sessionId: null,
    firstUserMessage: null,
    lastUpdated: null,
    messageCount: 0,
  };
  const text = await readFile(path, "utf8").catch(() => "");
  if (!text) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object") return empty;
  const obj = parsed as Record<string, unknown>;
  const projectHash = typeof obj.projectHash === "string" ? obj.projectHash : null;
  const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : null;
  const lastUpdated = typeof obj.lastUpdated === "string" ? obj.lastUpdated : null;

  let firstUserMessage: string | null = null;
  let messageCount = 0;
  const messages = obj.messages;
  if (Array.isArray(messages)) {
    messageCount = messages.length;
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const msg = m as Record<string, unknown>;
      if (msg.type !== "user") continue;
      const content = extractText(msg.content);
      if (content && !firstUserMessage) {
        firstUserMessage = firstNonEmptyLine(content);
        // Don't break — messageCount already known from length above, but
        // staying defensive in case the loop is reused for other extractions.
      }
    }
  }

  return { projectHash, sessionId, firstUserMessage, lastUpdated, messageCount };
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

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (c && typeof c === "object" && typeof (c as Record<string, unknown>).text === "string") {
        parts.push((c as Record<string, unknown>).text as string);
      }
    }
    return parts.join("\n");
  }
  return "";
}


