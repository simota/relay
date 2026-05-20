import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRepoForCwd } from "../lib/repo-from-cwd.js";
import { detectCodexSessionStatus } from "../lib/session-status.js";
import type {
  SessionDetail,
  SessionMessage,
  SessionSummary,
  SessionToolCall,
} from "./types.js";

const SESSIONS_ROOT = join(homedir(), ".codex", "sessions");

export async function getCodexSession(id: string, roots: string[]): Promise<SessionDetail | null> {
  // We don't know the y/m/d path from the id alone — walk the tree.
  const candidates = await collectRecentJsonl(SESSIONS_ROOT, 0);
  for (const c of candidates) {
    if (!c.path.includes(`-${id}.jsonl`)) continue;
    return readCodexDetail(c.path, roots, c.mtimeMs);
  }
  return null;
}

export async function getCodexPath(id: string): Promise<string | null> {
  const candidates = await collectRecentJsonl(SESSIONS_ROOT, 0);
  for (const c of candidates) {
    if (c.path.includes(`-${id}.jsonl`)) return c.path;
  }
  return null;
}

interface JsonlCandidate {
  path: string;
  mtimeMs: number;
}

async function collectRecentJsonl(root: string, cutoffMs: number): Promise<JsonlCandidate[]> {
  const out: JsonlCandidate[] = [];
  const years = await readdir(root).catch(() => []);
  for (const y of years) {
    if (!/^\d{4}$/.test(y)) continue;
    const months = await readdir(join(root, y)).catch(() => []);
    for (const m of months) {
      if (!/^\d{2}$/.test(m)) continue;
      const days = await readdir(join(root, y, m)).catch(() => []);
      for (const d of days) {
        if (!/^\d{2}$/.test(d)) continue;
        const files = await readdir(join(root, y, m, d)).catch(() => []);
        for (const f of files) {
          if (!f.endsWith(".jsonl")) continue;
          const full = join(root, y, m, d, f);
          const s = await stat(full).catch(() => null);
          if (!s || s.mtimeMs < cutoffMs) continue;
          out.push({ path: full, mtimeMs: s.mtimeMs });
        }
      }
    }
  }
  return out;
}

async function readCodexSummary(
  path: string,
  roots: string[],
  mtimeMs: number,
): Promise<SessionSummary | null> {
  const text = await readFile(path, "utf8").catch(() => "");
  if (!text) return null;
  const lines = text.split("\n");

  let cwd: string | null = null;
  let sessionId: string | null = null;
  let startedAt: string | null = null;
  let firstUser: string | null = null;
  let messageCount = 0;

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
    const payload = (obj.payload ?? {}) as Record<string, unknown>;

    if (obj.type === "session_meta") {
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (typeof payload.id === "string") sessionId = payload.id;
      if (typeof payload.timestamp === "string") startedAt = payload.timestamp;
      continue;
    }

    if (obj.type === "event_msg") {
      const pType = payload.type;
      if (pType === "user_message" || pType === "agent_message") messageCount++;
      if (pType === "user_message" && !firstUser && typeof payload.message === "string") {
        firstUser = firstNonEmptyLine(payload.message);
      }
    }
  }

  if (!sessionId) return null;

  const lastIso = new Date(mtimeMs).toISOString();
  // Live status detection — re-runs on each SSE detail tick so the UI flips
  // to active/waiting_for_user/ended without waiting for the next sync.
  const status = detectCodexSessionStatus(text);
  return {
    type: "codex",
    id: sessionId,
    repo: cwd ? resolveRepoForCwd(cwd, roots) : null,
    cwd,
    title: firstUser ? truncate(firstUser, 160) : "(no prompt)",
    started_at: startedAt ?? lastIso,
    last_active: lastIso,
    message_count: messageCount,
    todos_count: 0,
    status,
  };
}

async function readCodexDetail(
  path: string,
  roots: string[],
  mtimeMs: number,
): Promise<SessionDetail | null> {
  const summary = await readCodexSummary(path, roots, mtimeMs);
  if (!summary) return null;

  const text = await readFile(path, "utf8").catch(() => "");
  const lines = text.split("\n");
  const messages: SessionMessage[] = [];
  const toolCalls: SessionToolCall[] = [];

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
    const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
    const payload = (obj.payload ?? {}) as Record<string, unknown>;

    if (obj.type === "event_msg") {
      if (payload.type === "user_message" && typeof payload.message === "string") {
        messages.push({ timestamp: ts, role: "user", text: truncate(payload.message, 4_000) });
      } else if (payload.type === "agent_message" && typeof payload.message === "string") {
        messages.push({ timestamp: ts, role: "assistant", text: truncate(payload.message, 4_000) });
      }
    } else if (obj.type === "response_item" && payload.type === "function_call") {
      const name = typeof payload.name === "string" ? payload.name : "";
      const args = typeof payload.arguments === "string" ? payload.arguments : "";
      if (name) {
        toolCalls.push({
          timestamp: ts,
          name,
          args_summary: truncate(args, 200),
          args_json: args ? truncate(args, 4_000) : null,
        });
      }
    }
  }

  return {
    ...summary,
    messages,
    todos: [],
    tool_calls: toolCalls,
  };
}


function firstNonEmptyLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
