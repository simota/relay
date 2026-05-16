import { existsSync } from "node:fs";
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
 * Scans ~/.codex/sessions/<year>/<month>/<day>/rollout-*.jsonl and emits one
 * task per session (all sessions within the lookback window).
 *
 * Unlike Claude Code, Codex has no TodoWrite-style structured plan, so a
 * Codex session itself is the unit: the first `user_message` becomes the
 * title and the originating `cwd` (from `session_meta`) drives repo
 * inference. Only sessions modified within `lookback_days` are considered.
 *
 * Multiple sessions from the same repo are all ingested as individual tasks.
 * The `priority_decay_days` mechanism attenuates older sessions so they do
 * not dominate `relay today`.
 */

interface CodexParsed {
  cwd: string | null;
  firstUserMessage: string | null;
  sessionId: string | null;
  /**
   * `session_meta.timestamp` when present (Codex writes ISO 8601 here).
   * Falls back to null; callers use file mtime as last_active so a missing
   * timestamp only affects `started_at` granularity (and even then,
   * UPSERT preserves the first-seen value).
   */
  startedAt: string | null;
  /** Total JSONL line count. Approximates message count. */
  messageCount: number;
}

export const codexSessionAdapter: Adapter = {
  name: "codex_session_todo",
  flagKeys: ["codex_session"] as const,

  precheck() {
    const sessionsRoot = join(homedir(), ".codex", "sessions");
    if (!existsSync(sessionsRoot)) {
      return { skip: true, reason: `${sessionsRoot} not found (Codex CLI not installed?)` };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const sessionsRoot = join(homedir(), ".codex", "sessions");
    const excludes = ctx.codexSession?.excludePatterns ?? [];
    const isExcluded = compileExcludePatterns(excludes);
    const storeBody = ctx.codexSession?.storeBody ?? true;
    const lookbackDays = ctx.codexSession?.lookbackDays ?? 7;
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    // F-1 Phase D: skip JSONLs whose mtime predates the last successful sync.
    // Codex tasks are derived from `session_meta` + first `user_message`,
    // both of which are append-once at session start — so an unchanged mtime
    // guarantees both the task content and the sessions row are identical
    // to what we already stored. Garbled cursor → null → full sweep.
    const cursorMs = parseCursorMs(ctx.lastSyncCursor);

    const candidates = await collectRecentJsonl(sessionsRoot, cutoff, isExcluded, ctx);
    if (candidates.length === 0) return [];

    const tasks: TaskInput[] = [];
    for (const c of candidates) {
      if (cursorMs !== null && c.mtimeMs <= cursorMs) continue;
      const parsed = await parseCodexSession(c.path);
      if (!parsed.sessionId) continue;

      const repo = parsed.cwd ? resolveRepoForCwd(parsed.cwd, ctx.roots) : null;

      // Task ingest still requires cwd + a repo match — out-of-tree sessions
      // don't generate tasks. Sessions table accepts them anyway so /insights
      // can show "Codex was used here even though we don't track that repo".
      if (parsed.cwd && repo) {
        const title = truncate(parsed.firstUserMessage ?? "(no prompt)", 120);
        tasks.push({
          source_type: "codex_session_todo",
          source_id: parsed.sessionId,
          repo,
          title,
          body: storeBody
            ? `From Codex session \`${parsed.sessionId}\` (cwd: ${parsed.cwd}).`
            : "",
          status: "in_progress",
          assignee: "codex",
          priority: 55,
          prompt: null,
          files: [],
          context_hash: null,
          session_id: parsed.sessionId,
          due_at: null,
          wait_on: "self",
        });
      }

      // F-1 Phase B: upsert sessions row. Uses session_meta.timestamp for
      // started_at when present (UPSERT preserves first-seen anyway), file
      // mtime for last_active. Codex has no parent/child concept.
      if (ctx.db && !ctx.dryRun) {
        try {
          const lastActiveIso = new Date(c.mtimeMs).toISOString();
          const startedAtIso = parsed.startedAt ?? lastActiveIso;
          ctx.db.upsertSession(
            toSessionRow({
              id: parsed.sessionId,
              type: "codex",
              repo,
              cwd: parsed.cwd,
              startedAt: startedAtIso,
              lastActive: lastActiveIso,
              messageCount: parsed.messageCount,
              sourcePath: c.path,
            }),
          );
        } catch (err) {
          console.warn(
            `[codex-session] session upsert failed: ${parsed.sessionId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return tasks;
  },
};

interface JsonlCandidate {
  path: string;
  mtimeMs: number;
}

async function collectRecentJsonl(
  root: string,
  cutoffMs: number,
  isExcluded: (path: string) => boolean,
  ctx: AdapterContext,
): Promise<JsonlCandidate[]> {
  const out: JsonlCandidate[] = [];
  const dayMs = 24 * 60 * 60 * 1000;
  // Tree depth is fixed at year/month/day, so we walk explicitly rather
  // than via a generic recurse — keeps stat counts bounded on huge histories.
  // Year/month/day directory names are themselves the date, so we can
  // skip whole sub-trees without stat-ing every jsonl: any day whose
  // end-of-day boundary (`dirDate + 24h`) is still before `cutoffMs`
  // cannot contain a file the caller wants. We stay conservative — the
  // current day matching cutoff's date is always descended into so
  // boundary jsonl files are never lost.
  const years = await readdir(root).catch(() => []);
  for (const y of years) {
    if (!/^\d{4}$/.test(y)) continue;
    const yearNum = Number(y);
    // A year-end boundary that is still before the cutoff means no day
    // inside this year can be within the window.
    if (Date.UTC(yearNum + 1, 0, 1) <= cutoffMs) continue;
    const yearDir = join(root, y);
    const months = await readdir(yearDir).catch(() => []);
    for (const m of months) {
      if (!/^\d{2}$/.test(m)) continue;
      const monthNum = Number(m);
      if (monthNum < 1 || monthNum > 12) continue;
      // Same trick at month granularity: skip if the month-end boundary
      // is still before cutoff.
      if (Date.UTC(yearNum, monthNum, 1) <= cutoffMs) continue;
      const monthDir = join(yearDir, m);
      const days = await readdir(monthDir).catch(() => []);
      for (const d of days) {
        if (!/^\d{2}$/.test(d)) continue;
        const dayNum = Number(d);
        if (dayNum < 1 || dayNum > 31) continue;
        // `Date.UTC(y, m-1, d)` = 00:00 UTC on that day; adding 24h
        // gives the next day's 00:00 UTC. If that boundary is still at
        // or before cutoff, every jsonl in this dir has an effective
        // upper bound older than cutoff and is safely skippable.
        const dayStartMs = Date.UTC(yearNum, monthNum - 1, dayNum);
        if (dayStartMs + dayMs <= cutoffMs) continue;
        const dayDir = join(monthDir, d);
        const files = await readdir(dayDir).catch(() => []);
        for (const f of files) {
          if (!f.endsWith(".jsonl")) continue;
          const full = join(dayDir, f);
          if (isExcluded(full)) {
            ctx.log?.(`  ⊘ excluded: ${full}`);
            continue;
          }
          const s = await stat(full).catch(() => null);
          if (!s || s.mtimeMs < cutoffMs) continue;
          out.push({ path: full, mtimeMs: s.mtimeMs });
        }
      }
    }
  }
  return out;
}

async function parseCodexSession(path: string): Promise<CodexParsed> {
  const text = await readFile(path, "utf8").catch(() => "");
  if (!text) {
    return {
      cwd: null,
      firstUserMessage: null,
      sessionId: null,
      startedAt: null,
      messageCount: 0,
    };
  }

  const lines = text.split("\n");
  let cwd: string | null = null;
  let sessionId: string | null = null;
  let firstUserMessage: string | null = null;
  let startedAt: string | null = null;
  let messageCount = 0;

  for (const line of lines) {
    if (!line) continue;
    messageCount += 1;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (!evt || typeof evt !== "object") continue;
    const obj = evt as Record<string, unknown>;
    const payload = (obj.payload ?? {}) as Record<string, unknown>;

    if (obj.type === "session_meta") {
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (typeof payload.id === "string") sessionId = payload.id;
      // Codex stamps `timestamp` (ISO 8601) on the session_meta line.
      if (typeof payload.timestamp === "string") startedAt = payload.timestamp;
      continue;
    }

    if (obj.type === "event_msg" && payload.type === "user_message") {
      if (!firstUserMessage && typeof payload.message === "string") {
        firstUserMessage = firstNonEmptyLine(payload.message);
        // First user_message wins; remaining lines still counted for
        // messageCount but otherwise mid-conversation noise. We can't break
        // here anymore because messageCount needs the full sweep.
      }
    }
  }

  return { cwd, firstUserMessage, sessionId, startedAt, messageCount };
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
