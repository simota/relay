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

const BRAIN_ROOT = join(homedir(), ".gemini", "antigravity-cli", "brain");
const HISTORY_PATH = join(homedir(), ".gemini", "antigravity-cli", "history.jsonl");

/**
 * Resolve a single Antigravity CLI session by conversation id. The
 * canonical store is the binary protobuf at
 * `conversations/<id>.pb`, but we only consume the JSONL transcript
 * (`brain/<id>/.system_generated/logs/transcript.jsonl`) since it is the
 * human-readable mirror.
 */
export async function getAntigravitySession(
  id: string,
  roots: string[],
): Promise<SessionDetail | null> {
  const transcriptPath = transcriptPathFor(id);
  if (!existsSync(transcriptPath)) return null;
  const workspaceMap = await loadConversationWorkspaceMap();
  return readAntigravityDetail(transcriptPath, id, workspaceMap, roots);
}

export async function getAntigravityPath(id: string): Promise<string | null> {
  const transcriptPath = transcriptPathFor(id);
  if (existsSync(transcriptPath)) return transcriptPath;
  // Fallback: id may have been truncated; scan brain/ for a directory
  // whose name contains the supplied id.
  const dirs = await readdir(BRAIN_ROOT).catch(() => []);
  for (const dir of dirs) {
    if (!dir.includes(id)) continue;
    const p = join(BRAIN_ROOT, dir, ".system_generated", "logs", "transcript.jsonl");
    if (existsSync(p)) return p;
  }
  return null;
}

function transcriptPathFor(id: string): string {
  return join(BRAIN_ROOT, id, ".system_generated", "logs", "transcript.jsonl");
}

async function loadConversationWorkspaceMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const text = await readFile(HISTORY_PATH, "utf8").catch(() => "");
  if (!text) return map;
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
  return map;
}

interface TranscriptEntry {
  step_index?: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
  tool_calls?: Array<{
    name?: string;
    args?: Record<string, unknown>;
    toolAction?: string;
    toolSummary?: string;
  }>;
}

async function readAntigravityDetail(
  path: string,
  id: string,
  workspaceMap: Map<string, string>,
  roots: string[],
): Promise<SessionDetail | null> {
  const text = await readFile(path, "utf8").catch(() => "");
  if (!text) return null;

  const entries: TranscriptEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as TranscriptEntry);
    } catch {
      // skip malformed lines
    }
  }
  if (entries.length === 0) return null;

  const cwd = workspaceMap.get(id) ?? deriveCwdFromTranscript(entries);
  const repo = cwd ? resolveRepoForCwd(cwd, roots) : null;

  let firstUser: string | null = null;
  let startedAt: string | null = null;
  let lastActive: string | null = null;
  const messages: SessionMessage[] = [];
  const toolCalls: SessionToolCall[] = [];

  for (const entry of entries) {
    if (typeof entry.created_at === "string") {
      if (!startedAt) startedAt = entry.created_at;
      lastActive = entry.created_at;
    }
    const role = roleOf(entry);
    const text = renderContent(entry);
    if (role && text) {
      messages.push({
        timestamp: entry.created_at ?? "",
        role,
        text: truncate(text, 4_000),
      });
    }
    if (!firstUser && entry.type === "USER_INPUT" && typeof entry.content === "string") {
      firstUser = firstNonEmptyLine(extractUserRequest(entry.content));
    }
    if (Array.isArray(entry.tool_calls)) {
      for (const call of entry.tool_calls) {
        if (!call || typeof call.name !== "string") continue;
        const argsJson = call.args ? JSON.stringify(call.args) : null;
        const summary =
          (typeof call.toolSummary === "string" && call.toolSummary) ||
          (typeof call.toolAction === "string" && call.toolAction) ||
          (argsJson ? truncate(argsJson, 200) : "");
        toolCalls.push({
          timestamp: entry.created_at ?? "",
          name: call.name,
          args_summary: truncate(summary, 200),
          args_json: argsJson ? truncate(argsJson, 4_000) : null,
        });
      }
    }
  }

  const userMessageCount = entries.filter((e) => e.type === "USER_INPUT").length;
  const title = firstUser ? truncate(firstUser, 160) : "(no prompt)";
  const now = new Date().toISOString();

  const summary: SessionSummary = {
    type: "antigravity",
    id,
    repo,
    cwd,
    title,
    started_at: startedAt ?? lastActive ?? now,
    last_active: lastActive ?? startedAt ?? now,
    message_count: userMessageCount,
    todos_count: 0,
  };

  return {
    ...summary,
    messages,
    todos: [],
    tool_calls: toolCalls,
  };
}

function deriveCwdFromTranscript(entries: TranscriptEntry[]): string | null {
  // Fallback when history.jsonl lacks the conversation. The first
  // USER_INPUT entry sometimes contains a `<workspace>` marker in
  // ADDITIONAL_METADATA, but Antigravity is inconsistent about emitting it,
  // so this best-effort check just returns null when it is missing.
  for (const entry of entries) {
    if (entry.type !== "USER_INPUT" || typeof entry.content !== "string") continue;
    const match = entry.content.match(/workspace["']?\s*[:=]\s*["']([^"']+)["']/i);
    if (match && typeof match[1] === "string") return match[1];
  }
  return null;
}

function roleOf(entry: TranscriptEntry): SessionMessage["role"] | null {
  if (entry.type === "USER_INPUT") return "user";
  if (entry.type === "PLANNER_RESPONSE" || entry.source === "MODEL") return "assistant";
  if (entry.type === "CONVERSATION_HISTORY") return null;
  if (entry.source === "SYSTEM") return "system";
  if (entry.source === "TOOL") return "tool";
  return null;
}

function renderContent(entry: TranscriptEntry): string {
  if (typeof entry.content !== "string") return "";
  if (entry.type === "USER_INPUT") return extractUserRequest(entry.content);
  return entry.content;
}

function extractUserRequest(content: string): string {
  const match = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
  if (match && typeof match[1] === "string") return match[1];
  return content;
}

function firstNonEmptyLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
