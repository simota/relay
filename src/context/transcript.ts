import { readFileSync } from "node:fs";

export interface TranscriptSummary {
  inProgressTodos: string[];
  pendingTodos: string[];
  recentFiles: string[];        // last N file paths touched via Edit/Write/MultiEdit
  lastUserMessage: string | null;
}

const RECENT_FILE_LIMIT = 8;

/**
 * Parse a Claude Code session jsonl and extract the most recent state:
 *  - Latest TodoWrite (split by status)
 *  - Recently touched files (Edit / Write / MultiEdit tool_use blocks)
 *  - Last user message (for "what was I asking")
 *
 * Tolerant of partial / version-skewed jsonl shapes.
 */
export function summarizeTranscript(path: string): TranscriptSummary {
  const summary: TranscriptSummary = {
    inProgressTodos: [],
    pendingTodos: [],
    recentFiles: [],
    lastUserMessage: null,
  };

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return summary;
  }

  const recentFiles: string[] = [];
  let latestTodos: TodoItem[] | null = null;

  for (const line of text.split("\n")) {
    if (!line) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (!evt || typeof evt !== "object") continue;

    const blocks = extractContentBlocks(evt);
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;

      if (b.type === "tool_use") {
        const name = b.name as string | undefined;
        const input = b.input as Record<string, unknown> | undefined;
        if (!input) continue;

        if (name === "TodoWrite" && Array.isArray(input.todos)) {
          latestTodos = input.todos as TodoItem[];
        }

        if ((name === "Edit" || name === "Write" || name === "MultiEdit") && typeof input.file_path === "string") {
          recentFiles.push(input.file_path);
        }
      }
    }

    const userText = extractUserText(evt);
    if (userText) summary.lastUserMessage = userText;
  }

  if (latestTodos) {
    summary.inProgressTodos = latestTodos
      .filter((t) => t.status === "in_progress")
      .map((t) => t.content);
    summary.pendingTodos = latestTodos
      .filter((t) => t.status === "pending")
      .map((t) => t.content);
  }

  // dedupe while preserving most-recent-last → keep last N unique
  const seen = new Set<string>();
  const reversed: string[] = [];
  for (let i = recentFiles.length - 1; i >= 0 && reversed.length < RECENT_FILE_LIMIT; i--) {
    const f = recentFiles[i]!;
    if (!seen.has(f)) {
      seen.add(f);
      reversed.push(f);
    }
  }
  summary.recentFiles = reversed.reverse();

  return summary;
}

interface TodoItem {
  id?: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | string;
}

function extractContentBlocks(evt: unknown): unknown[] {
  if (!evt || typeof evt !== "object") return [];
  const o = evt as Record<string, unknown>;
  const message = o.message ?? o;
  if (!message || typeof message !== "object") return [];
  const blocks = (message as Record<string, unknown>).content;
  return Array.isArray(blocks) ? blocks : [];
}

function extractUserText(evt: unknown): string | null {
  if (!evt || typeof evt !== "object") return null;
  const o = evt as Record<string, unknown>;
  if (o.type !== "user") return null;
  const message = o.message;
  if (!message || typeof message !== "object") return null;
  const blocks = (message as Record<string, unknown>).content;

  if (typeof blocks === "string") return blocks.slice(0, 200);
  if (!Array.isArray(blocks)) return null;
  for (const b of blocks) {
    if (b && typeof b === "object") {
      const bb = b as Record<string, unknown>;
      if (bb.type === "text" && typeof bb.text === "string") {
        return bb.text.slice(0, 200);
      }
    }
  }
  return null;
}

export function formatSummary(s: TranscriptSummary): string {
  const lines: string[] = [];
  if (s.lastUserMessage) {
    lines.push(`Last ask: ${s.lastUserMessage.replace(/\n+/g, " ")}`);
  }
  if (s.inProgressTodos.length > 0) {
    lines.push("In-progress:");
    for (const t of s.inProgressTodos) lines.push(`  ▶ ${t}`);
  }
  if (s.pendingTodos.length > 0) {
    lines.push("Pending:");
    for (const t of s.pendingTodos) lines.push(`  · ${t}`);
  }
  if (s.recentFiles.length > 0) {
    lines.push(`Recent files: ${s.recentFiles.join(", ")}`);
  }
  return lines.join("\n");
}
