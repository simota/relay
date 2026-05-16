import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRepoForCwd } from "../lib/repo-from-cwd.js";
import type {
  SessionDetail,
  SessionMessage,
  SessionSummary,
  SessionToolCall,
} from "./types.js";

const TMP_ROOT = join(homedir(), ".gemini", "tmp");
const PROJECTS_JSON = join(homedir(), ".gemini", "projects.json");

export async function getGeminiSession(id: string, roots: string[]): Promise<SessionDetail | null> {
  if (!existsSync(TMP_ROOT)) return null;
  const hashToCwd = await loadHashToCwdMap();
  const dirs = await readdir(TMP_ROOT).catch(() => []);
  for (const dir of dirs) {
    const chatsDir = join(TMP_ROOT, dir, "chats");
    if (!existsSync(chatsDir)) continue;
    const files = await readdir(chatsDir).catch(() => []);
    for (const f of files) {
      if (!f.includes(id) || !f.endsWith(".json")) continue;
      const full = join(chatsDir, f);
      return readGeminiDetail(full, hashToCwd, roots);
    }
  }
  return null;
}

export async function getGeminiPath(id: string): Promise<string | null> {
  if (!existsSync(TMP_ROOT)) return null;
  const dirs = await readdir(TMP_ROOT).catch(() => []);
  for (const dir of dirs) {
    const chatsDir = join(TMP_ROOT, dir, "chats");
    if (!existsSync(chatsDir)) continue;
    const files = await readdir(chatsDir).catch(() => []);
    for (const f of files) {
      if (f.includes(id) && f.endsWith(".json")) return join(chatsDir, f);
    }
  }
  return null;
}

async function loadHashToCwdMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!existsSync(PROJECTS_JSON)) return map;
  let text: string;
  try {
    text = await readFile(PROJECTS_JSON, "utf8");
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
    map.set(createHash("sha256").update(cwd).digest("hex"), cwd);
  }
  return map;
}

interface GeminiRaw {
  sessionId?: string;
  projectHash?: string;
  startTime?: string;
  lastUpdated?: string;
  messages?: Array<Record<string, unknown>>;
}

async function readGeminiSummary(
  path: string,
  hashToCwd: Map<string, string>,
  roots: string[],
): Promise<SessionSummary | null> {
  const raw = await readRaw(path);
  if (!raw?.sessionId) return null;
  const cwd = raw.projectHash ? hashToCwd.get(raw.projectHash) ?? null : null;
  const repo = cwd ? resolveRepoForCwd(cwd, roots) : null;
  const firstUser = firstUserMessage(raw.messages ?? []);
  const messageCount = (raw.messages ?? []).filter(
    (m) => typeof m === "object" && m && (m as Record<string, unknown>).type === "user",
  ).length;

  return {
    type: "gemini",
    id: raw.sessionId,
    repo,
    cwd,
    title: firstUser ? truncate(firstUser, 160) : "(no prompt)",
    started_at: raw.startTime ?? raw.lastUpdated ?? new Date().toISOString(),
    last_active: raw.lastUpdated ?? raw.startTime ?? new Date().toISOString(),
    message_count: messageCount,
    todos_count: 0,
  };
}

async function readGeminiDetail(
  path: string,
  hashToCwd: Map<string, string>,
  roots: string[],
): Promise<SessionDetail | null> {
  const summary = await readGeminiSummary(path, hashToCwd, roots);
  if (!summary) return null;
  const raw = await readRaw(path);
  if (!raw) return null;

  const messages: SessionMessage[] = [];
  const toolCalls: SessionToolCall[] = [];
  for (const m of raw.messages ?? []) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;
    const ts = typeof msg.timestamp === "string" ? msg.timestamp : "";
    const role = roleOf(msg.type);
    const text = extractText(msg.content);
    if (role && text) messages.push({ timestamp: ts, role, text: truncate(text, 4_000) });
    if (msg.type === "tool" && typeof msg.toolName === "string") {
      const content = extractText(msg.content);
      toolCalls.push({
        timestamp: ts,
        name: msg.toolName,
        args_summary: truncate(content, 200),
        args_json: content ? truncate(content, 4_000) : null,
      });
    }
  }

  return {
    ...summary,
    messages,
    todos: [],
    tool_calls: toolCalls,
  };
}

async function readRaw(path: string): Promise<GeminiRaw | null> {
  const text = await readFile(path, "utf8").catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text) as GeminiRaw;
  } catch {
    return null;
  }
}

function firstUserMessage(messages: Array<Record<string, unknown>>): string | null {
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    if ((m as Record<string, unknown>).type !== "user") continue;
    const text = extractText((m as Record<string, unknown>).content);
    if (text) return firstNonEmptyLine(text);
  }
  return null;
}

function roleOf(type: unknown): SessionMessage["role"] | null {
  if (type === "user") return "user";
  if (type === "gemini" || type === "assistant" || type === "model") return "assistant";
  if (type === "system") return "system";
  if (type === "tool") return "tool";
  return null;
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


function firstNonEmptyLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
