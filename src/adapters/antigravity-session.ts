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
import { detectAntigravitySessionStatus } from "../lib/session-status.js";
import type { Adapter, AdapterContext, SessionStatus, TaskInput } from "../types.js";

/**
 * Scans ~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/
 * logs/transcript.jsonl and emits one task per Antigravity CLI conversation.
 *
 * Antigravity CLI (the `agy` binary, Gemini CLI's 2026 successor) keeps the
 * canonical conversation as a binary protobuf at
 * `~/.gemini/antigravity-cli/conversations/<id>.pb`, but mirrors the same
 * stream into the JSONL transcript that this adapter parses. The transcript
 * is the only human-readable representation, so we ignore the .pb entirely.
 *
 * Workspace (= cwd) resolution differs from gemini-session: Antigravity
 * writes the absolute workspace path into `history.jsonl` (one event per
 * user input, keyed by `conversationId`), so we walk that file once and
 * build conversationId → workspace map without ever hashing a path.
 *
 * Multiple conversations from the same repo are all ingested as individual
 * tasks; `priority_decay_days` attenuates older sessions so they do not
 * dominate `relay today`.
 */

interface AntigravityParsed {
  conversationId: string;
  firstUserMessage: string | null;
  /** Last `created_at` seen in transcript.jsonl (or null if no entries). */
  lastTranscriptAt: string | null;
  /** Total entries in transcript.jsonl — used as message_count. */
  messageCount: number;
  /**
   * Truncated preview of the latest user/model message text. Null when the
   * transcript has no extractable message body yet.
   */
  lastMessageText: string | null;
  /**
   * Lifecycle status derived from the transcript tail. Antigravity ships a
   * per-entry `status` field so the heuristic is simpler than Claude/Codex
   * (see `detectAntigravitySessionStatus`).
   */
  status: SessionStatus;
}

interface TranscriptEntry {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
}

export const antigravitySessionAdapter: Adapter = {
  name: "antigravity_session_todo",
  flagKeys: ["antigravity_session"] as const,

  precheck() {
    const brainRoot = join(homedir(), ".gemini", "antigravity-cli", "brain");
    if (!existsSync(brainRoot)) {
      return {
        skip: true,
        reason: `${brainRoot} not found (Antigravity CLI not installed?)`,
      };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const brainRoot = join(homedir(), ".gemini", "antigravity-cli", "brain");
    const historyPath = join(homedir(), ".gemini", "antigravity-cli", "history.jsonl");
    const excludes = ctx.antigravitySession?.excludePatterns ?? [];
    const isExcluded = compileExcludePatterns(excludes);
    const storeBody = ctx.antigravitySession?.storeBody ?? true;
    const lookbackDays = ctx.antigravitySession?.lookbackDays ?? 7;
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const cursorMs = parseCursorMs(ctx.lastSyncCursor);

    const idToWorkspace = await loadConversationWorkspaceMap(historyPath);

    const dirs = await readdir(brainRoot).catch(() => []);
    const candidates: Array<{
      conversationId: string;
      transcriptPath: string;
      mtimeMs: number;
    }> = [];
    for (const dir of dirs) {
      const transcriptPath = join(
        brainRoot,
        dir,
        ".system_generated",
        "logs",
        "transcript.jsonl",
      );
      if (!existsSync(transcriptPath)) continue;
      if (isExcluded(transcriptPath)) {
        ctx.log?.(`  ⊘ excluded: ${transcriptPath}`);
        continue;
      }
      const s = await stat(transcriptPath).catch(() => null);
      if (!s || s.mtimeMs < cutoff) continue;
      if (cursorMs !== null && s.mtimeMs <= cursorMs) continue;
      candidates.push({
        conversationId: dir,
        transcriptPath,
        mtimeMs: s.mtimeMs,
      });
    }

    const tasks: TaskInput[] = [];
    for (const c of candidates) {
      const parsed = await parseAntigravityTranscript(c.transcriptPath, c.conversationId);
      if (!parsed.conversationId) continue;

      const cwd = idToWorkspace.get(parsed.conversationId) ?? null;
      const repo = cwd ? resolveRepoForCwd(cwd, ctx.roots) : null;

      if (cwd && repo) {
        const title = truncate(parsed.firstUserMessage ?? "(no prompt)", 120);
        tasks.push({
          source_type: "antigravity_session_todo",
          source_id: parsed.conversationId,
          repo,
          title,
          body: storeBody
            ? `From Antigravity session \`${parsed.conversationId}\` (cwd: ${cwd}).`
            : "",
          status: "in_progress",
          assignee: "antigravity",
          priority: 55,
          prompt: null,
          files: [],
          context_hash: null,
          session_id: parsed.conversationId,
          due_at: null,
          wait_on: "self",
        });
      }

      if (ctx.db && !ctx.dryRun) {
        try {
          const mtimeIso = new Date(c.mtimeMs).toISOString();
          const lastActiveIso = parsed.lastTranscriptAt ?? mtimeIso;
          // Persist the first-user-message as the session title so the list
          // view shows the prompt even when cwd resolution failed (subagents,
          // cwd-less conversations). Null when no prompt was extractable —
          // API falls back to cwd basename → `(no prompt)`.
          const titleForRow = parsed.firstUserMessage
            ? truncate(parsed.firstUserMessage, 240)
            : null;
          ctx.db.upsertSession(
            toSessionRow({
              id: parsed.conversationId,
              type: "antigravity",
              repo,
              cwd,
              startedAt: lastActiveIso,
              lastActive: lastActiveIso,
              messageCount: parsed.messageCount,
              sourcePath: c.transcriptPath,
              lastMessageText: parsed.lastMessageText,
              title: titleForRow,
              status: parsed.status,
            }),
          );
        } catch (err) {
          console.warn(
            `[antigravity-session] session upsert failed: ${parsed.conversationId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }

    return tasks;
  },
};

/**
 * Build a `conversationId → workspace path` map by merging two Antigravity
 * sources:
 *
 *   1. Primary: `~/.gemini/antigravity-cli/history.jsonl`. One line per
 *      prompt; the first prompt of a conversation is flushed *before* the
 *      CLI assigns a conversationId, so single-prompt conversations never
 *      get an id-carrying row here. Multi-prompt conversations do.
 *   2. Fallback: `~/.gemini/antigravity-cli/cache/last_conversations.json`,
 *      a `{workspace: conversationId}` object holding the *latest*
 *      conversation per workspace. Covers the single-prompt case the
 *      primary source misses, but does not back-fill older conversations
 *      that shared a workspace (only one id per workspace key).
 *
 * Primary wins on conflict so deliberate workspace overrides in
 * history.jsonl are preserved.
 */
async function loadConversationWorkspaceMap(path: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const text = await readFile(path, "utf8").catch(() => "");
  if (text) {
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: unknown;
      try {
        entry = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const id = typeof obj.conversationId === "string" ? obj.conversationId : null;
      const workspace = typeof obj.workspace === "string" ? obj.workspace : null;
      if (!id || !workspace) continue;
      if (!map.has(id)) map.set(id, workspace);
    }
  }

  const cachePath = join(
    homedir(),
    ".gemini",
    "antigravity-cli",
    "cache",
    "last_conversations.json",
  );
  const cacheText = await readFile(cachePath, "utf8").catch(() => "");
  if (cacheText) {
    try {
      const parsed = JSON.parse(cacheText) as Record<string, unknown>;
      for (const [workspace, id] of Object.entries(parsed)) {
        if (typeof id !== "string" || typeof workspace !== "string") continue;
        if (!map.has(id)) map.set(id, workspace);
      }
    } catch {
      // Corrupt cache — primary source still works, so swallow.
    }
  }

  return map;
}

async function parseAntigravityTranscript(
  path: string,
  conversationId: string,
): Promise<AntigravityParsed> {
  const empty: AntigravityParsed = {
    conversationId,
    firstUserMessage: null,
    lastTranscriptAt: null,
    messageCount: 0,
    lastMessageText: null,
    status: "idle",
  };
  const text = await readFile(path, "utf8").catch(() => "");
  if (!text) return empty;

  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return empty;

  let firstUserMessage: string | null = null;
  let lastTranscriptAt: string | null = null;
  let lastMessageText: string | null = null;

  for (const line of lines) {
    let entry: TranscriptEntry | null = null;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }
    if (!entry) continue;
    if (typeof entry.created_at === "string") {
      lastTranscriptAt = entry.created_at;
    }
    if (!firstUserMessage && entry.type === "USER_INPUT" && typeof entry.content === "string") {
      firstUserMessage = firstNonEmptyLine(extractUserRequest(entry.content));
    }
  }

  // Walk backwards once to grab the most recent visible message preview.
  // Skip CONVERSATION_HISTORY / PLANNER_RESPONSE noise when a richer
  // assistant-style content is available.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    let entry: TranscriptEntry | null = null;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }
    if (!entry || typeof entry.content !== "string") continue;
    const previewSource =
      entry.type === "USER_INPUT" ? extractUserRequest(entry.content) : entry.content;
    const preview = firstNonEmptyLine(previewSource);
    if (preview) {
      lastMessageText = truncate(preview, 240);
      break;
    }
  }

  // Status detection reuses the same text we just walked — one readFile,
  // one status pass. Symmetric with the Claude / Codex adapters.
  const status = detectAntigravitySessionStatus(text);

  return {
    conversationId,
    firstUserMessage,
    lastTranscriptAt,
    messageCount: lines.length,
    lastMessageText,
    status,
  };
}

/**
 * USER_INPUT transcript content wraps the actual request inside
 * `<USER_REQUEST>...</USER_REQUEST>` tags, surrounded by ADDITIONAL_METADATA
 * and USER_SETTINGS_CHANGE blocks. Strip the envelope so the task title
 * shows the user's actual prompt instead of an XML wrapper.
 */
function extractUserRequest(content: string): string {
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  if (match && typeof match[1] === "string") return match[1];
  return content;
}

function parseCursorMs(cursor: string | undefined): number | null {
  if (!cursor) return null;
  const ms = Date.parse(cursor);
  return Number.isFinite(ms) ? ms : null;
}
