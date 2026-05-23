import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRepoForCwd } from "../lib/repo-from-cwd.js";
import {
  distinctSkillNames,
  extractClaudeSkillChains,
  extractClaudeSkills,
} from "../lib/session-skills.js";
import { detectClaudeSessionStatus } from "../lib/session-status.js";
import type {
  SessionDetail,
  SessionMessage,
  SessionSummary,
  SessionTodo,
  SessionToolCall,
} from "./types.js";

const PROJECTS_ROOT = join(homedir(), ".claude", "projects");

/** UUID v4 形式 (8-4-4-4-12 hex) のディレクトリ名かを判定する */
function isUuid(name: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name);
}

/**
 * Determines if an id refers to a subagent session.
 * Subagent ids start with "agent-" (e.g. "agent-a920f50" or "agent-acompact-...").
 * Parent session ids are UUID v4 format and do NOT start with "agent-".
 */
function isAgentId(id: string): boolean {
  return id.startsWith("agent-");
}

export async function getClaudeSession(id: string, roots: string[]): Promise<SessionDetail | null> {
  if (!existsSync(PROJECTS_ROOT)) return null;

  // Subagent ID: look in <project>/<parent>/subagents/<id>.jsonl
  if (isAgentId(id)) {
    return getClaudeSubagentSession(id, roots);
  }

  // Parent session: <project>/<id>.jsonl
  const projects = await readdir(PROJECTS_ROOT).catch(() => []);
  for (const project of projects) {
    const full = join(PROJECTS_ROOT, project, `${id}.jsonl`);
    if (!existsSync(full)) continue;
    return readClaudeDetail(full, project, roots);
  }
  return null;
}

async function getClaudeSubagentSession(agentId: string, roots: string[]): Promise<SessionDetail | null> {
  const projects = await readdir(PROJECTS_ROOT).catch(() => []);
  for (const project of projects) {
    const projectDir = join(PROJECTS_ROOT, project);
    const entries = await readdir(projectDir).catch(() => []);
    const subdirs = entries.filter((e) => isUuid(e));
    for (const parentId of subdirs) {
      const full = join(projectDir, parentId, "subagents", `${agentId}.jsonl`);
      if (!existsSync(full)) continue;
      return readClaudeSubagentDetail(full, agentId, parentId, project, roots);
    }
  }
  return null;
}

export async function getClaudePath(id: string): Promise<string | null> {
  if (!existsSync(PROJECTS_ROOT)) return null;

  // Subagent path
  if (isAgentId(id)) {
    const projects = await readdir(PROJECTS_ROOT).catch(() => []);
    for (const project of projects) {
      const projectDir = join(PROJECTS_ROOT, project);
      const entries = await readdir(projectDir).catch(() => []);
      const subdirs = entries.filter((e) => isUuid(e));
      for (const parentId of subdirs) {
        const full = join(projectDir, parentId, "subagents", `${id}.jsonl`);
        if (existsSync(full)) return full;
      }
    }
    return null;
  }

  // Parent session path
  const projects = await readdir(PROJECTS_ROOT).catch(() => []);
  for (const project of projects) {
    const full = join(PROJECTS_ROOT, project, `${id}.jsonl`);
    if (existsSync(full)) return full;
  }
  return null;
}

async function readClaudeSubagentDetail(
  path: string,
  agentId: string,
  parentId: string,
  projectDir: string,
  roots: string[],
): Promise<SessionDetail | null> {
  const detail = await readClaudeDetail(path, projectDir, roots);
  if (!detail) return null;
  return {
    ...detail,
    id: agentId,
    parent_session_id: parentId,
    agent_id: agentId,
  };
}

async function readClaudeSummary(
  path: string,
  projectDir: string,
  roots: string[],
): Promise<SessionSummary | null> {
  const text = await readFile(path, "utf8").catch(() => "");
  if (!text) return null;
  const lines = text.split("\n");

  const baseName = path.split("/").pop() ?? "";
  const sessionId = baseName.replace(/\.jsonl$/, "");

  let cwd: string | null = null;
  let firstUser: { ts: string; text: string } | null = null;
  let lastTs: string | null = null;
  let messageCount = 0;
  const todoIds = new Set<string>();

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

    if (!cwd && typeof obj.cwd === "string" && obj.cwd) cwd = obj.cwd;
    if (typeof obj.timestamp === "string") lastTs = obj.timestamp;

    const role = extractRole(obj);
    if (role === "user" || role === "assistant") messageCount++;
    if (!firstUser && role === "user") {
      const userText = extractText(obj);
      if (userText) firstUser = { ts: (obj.timestamp as string) ?? "", text: userText };
    }

    for (const block of getToolUseBlocks(obj)) {
      if (block.name === "TaskCreate") {
        const subject = typeof block.input.subject === "string" ? block.input.subject : "";
        if (subject) todoIds.add(`tc:${todoIds.size}`);
      } else if (block.name === "TodoWrite") {
        const todos = block.input.todos;
        if (Array.isArray(todos)) {
          todoIds.clear();
          for (const todo of todos as Array<Record<string, unknown>>) {
            const id = typeof todo.id === "string" ? todo.id : String(todo.id ?? "");
            if (id) todoIds.add(id);
          }
        }
      }
    }
  }

  const repo = cwd ? resolveRepoForCwd(cwd, roots) : legacyProjectToRepo(projectDir);

  // Live detection: the SSE stream re-runs this on every file change so the
  // UI flips to "waiting_for_user" in real time, well before the next sync
  // tick would update the DB-backed list view's status field.
  const status = detectClaudeSessionStatus(text);
  const skills = extractClaudeSkills(text);
  const skills_used = distinctSkillNames(skills);

  return {
    type: "claude",
    id: sessionId,
    repo,
    cwd,
    title: firstUser?.text ? truncate(firstNonEmptyLine(firstUser.text), 160) : "(no prompt)",
    started_at: firstUser?.ts || lastTs || new Date().toISOString(),
    last_active: lastTs || firstUser?.ts || new Date().toISOString(),
    message_count: messageCount,
    todos_count: todoIds.size,
    status,
    ...(skills_used.length > 0 ? { skills_used } : {}),
  };
}

async function readClaudeDetail(
  path: string,
  projectDir: string,
  roots: string[],
): Promise<SessionDetail | null> {
  const summary = await readClaudeSummary(path, projectDir, roots);
  if (!summary) return null;

  const text = await readFile(path, "utf8").catch(() => "");
  const lines = text.split("\n");
  const messages: SessionMessage[] = [];
  const todoMap = new Map<string, SessionTodo>();
  const toolCalls: SessionToolCall[] = [];
  let taskCreateCount = 0;

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

    const role = extractRole(obj);
    if (role) {
      const t = extractText(obj);
      if (t) messages.push({ timestamp: ts, role, text: truncate(t, 4_000) });
    }

    for (const block of getToolUseBlocks(obj)) {
      toolCalls.push({
        timestamp: ts,
        name: block.name,
        args_summary: truncate(summariseInput(block.input), 200),
        args_json: truncate(JSON.stringify(block.input), 4_000),
      });
      if (block.name === "TaskCreate") {
        taskCreateCount += 1;
        const id = String(taskCreateCount);
        const subject = typeof block.input.subject === "string" ? block.input.subject : "";
        if (subject) todoMap.set(id, { id, title: subject, status: "pending" });
      } else if (block.name === "TaskUpdate") {
        const taskId = block.input.taskId;
        const status = block.input.status;
        if (typeof taskId === "string" && typeof status === "string") {
          const existing = todoMap.get(taskId);
          if (existing) existing.status = status;
        }
      } else if (block.name === "TodoWrite") {
        const todos = block.input.todos;
        if (Array.isArray(todos)) {
          todoMap.clear();
          taskCreateCount = 0;
          for (const todo of todos as Array<Record<string, unknown>>) {
            const id = typeof todo.id === "string" ? todo.id : String(todo.id ?? "");
            const content = typeof todo.content === "string" ? todo.content : "";
            const status = typeof todo.status === "string" ? todo.status : "pending";
            if (id && content) todoMap.set(id, { id, title: content, status });
          }
        }
      }
    }
  }

  const skills = extractClaudeSkills(text);
  const skill_chains = extractClaudeSkillChains(text);
  return {
    ...summary,
    messages,
    todos: [...todoMap.values()],
    tool_calls: toolCalls,
    skills,
    skill_chains,
  };
}

function extractRole(obj: Record<string, unknown>): SessionMessage["role"] | null {
  // Claude session events nest the actual user/assistant message inside `message`.
  const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
  const role = (wrapper as Record<string, unknown>).role;
  if (role === "user" || role === "assistant" || role === "system") return role;
  return null;
}

function extractText(obj: Record<string, unknown>): string {
  const wrapper = (obj.message as Record<string, unknown> | undefined) ?? obj;
  const content = (wrapper as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (c && typeof c === "object") {
        const block = c as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
      }
    }
    return parts.join("\n");
  }
  return "";
}

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

function getToolUseBlocks(evt: Record<string, unknown>): ToolUse[] {
  const wrapper = (evt.message as Record<string, unknown> | undefined) ?? evt;
  const blocks = (wrapper as Record<string, unknown>).content;
  if (!Array.isArray(blocks)) return [];
  const out: ToolUse[] = [];
  for (const b of blocks) {
    if (b && typeof b === "object" && (b as Record<string, unknown>).type === "tool_use") {
      const block = b as Record<string, unknown>;
      const input =
        block.input && typeof block.input === "object"
          ? (block.input as Record<string, unknown>)
          : {};
      if (typeof block.name === "string") out.push({ name: block.name, input });
    }
  }
  return out;
}

function summariseInput(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  const first = keys[0]!;
  const val = input[first];
  if (typeof val === "string") return `${first}=${val}`;
  return keys.join(",");
}

function legacyProjectToRepo(projectDir: string): string | null {
  const segments = projectDir.split("-").filter(Boolean);
  const ghIdx = segments.findIndex((s) => s === "github");
  if (ghIdx < 0 || segments.length <= ghIdx + 2) return null;
  return segments[ghIdx + 2] ?? null;
}

function firstNonEmptyLine(s: string): string {
  return s.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
