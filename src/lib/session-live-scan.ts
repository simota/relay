// Lightweight live scan for Claude session JSONLs.
//
// Walks ~/.claude/projects/ once and returns the freshly detected status
// for every JSONL whose mtime is within `sinceMs`. Distinct from the
// claude-session adapter:
//   - no task ingest (TaskCreate/TaskUpdate/TodoWrite parsing)
//   - no incremental cursor (caller controls freshness via sinceMs)
//   - no exclude-pattern compilation
//
// Intended for the notification hook's tight polling loop, where the
// goal is to detect `waiting_for_user` transitions within ~10 seconds
// without paying the full sync cost. Falls back to the same detector
// (`detectClaudeSessionStatus`) the adapter uses, so server-side
// classification stays consistent across both paths.

import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRepoForCwd } from "./repo-from-cwd.js";
import { detectClaudeSessionStatus } from "./session-status.js";
import type { SessionStatus } from "../types.js";

export interface LiveScanResult {
  type: "claude";
  id: string;
  parent_session_id: string | null;
  status: SessionStatus;
  source_path: string;
  last_active: string;
  message_count: number;
  cwd: string | null;
  repo: string | null;
}

interface ScanOptions {
  sinceMs: number;
  roots: string[];
  now?: number;
  includeSubagents?: boolean;
}

const UUID_DIR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function scanClaudeSessionsLive(opts: ScanOptions): Promise<LiveScanResult[]> {
  const projectsRoot = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsRoot)) return [];

  const now = opts.now ?? Date.now();
  const cutoffMs = now - opts.sinceMs;
  const includeSubagents = opts.includeSubagents !== false;
  const results: LiveScanResult[] = [];

  const projects = await readdir(projectsRoot).catch(() => []);
  for (const project of projects) {
    const projectDir = join(projectsRoot, project);
    const entries = await readdir(projectDir).catch(() => []);

    // Parent sessions: <project>/<uuid>.jsonl
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const fullPath = join(projectDir, entry);
      const r = await scanFile(fullPath, null, opts.roots, cutoffMs, now);
      if (r) {
        results.push({ ...r, id: entry.replace(/\.jsonl$/, "") });
      }
    }

    if (!includeSubagents) continue;

    // Subagent sessions: <project>/<parent-uuid>/subagents/agent-*.jsonl
    for (const dirEntry of entries) {
      if (!UUID_DIR.test(dirEntry)) continue;
      const subDir = join(projectDir, dirEntry, "subagents");
      const agentFiles = await readdir(subDir).catch(() => []);
      for (const f of agentFiles) {
        if (!f.startsWith("agent-") || !f.endsWith(".jsonl")) continue;
        const fullPath = join(subDir, f);
        const r = await scanFile(fullPath, dirEntry, opts.roots, cutoffMs, now);
        if (r) {
          results.push({ ...r, id: f.replace(/\.jsonl$/, "") });
        }
      }
    }
  }

  return results;
}

async function scanFile(
  fullPath: string,
  parentId: string | null,
  roots: string[],
  cutoffMs: number,
  now: number,
): Promise<Omit<LiveScanResult, "id"> | null> {
  const s = await stat(fullPath).catch(() => null);
  if (!s) return null;
  if (s.mtimeMs < cutoffMs) return null;

  const text = await readFile(fullPath, "utf8").catch(() => null);
  if (text === null) return null;

  const status = detectClaudeSessionStatus(text, { now });

  // Extract cwd from the first event that carries one + count non-empty
  // lines for message_count. Single forward walk so we stay under one
  // string allocation per file.
  let cwd: string | null = null;
  let messageCount = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    if (line.trim()) messageCount += 1;
    if (cwd === null) {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === "object" && typeof (obj as { cwd?: unknown }).cwd === "string") {
          cwd = (obj as { cwd: string }).cwd;
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  const repo = cwd ? resolveRepoForCwd(cwd, roots) : null;

  return {
    type: "claude",
    parent_session_id: parentId,
    status,
    source_path: fullPath,
    last_active: new Date(s.mtimeMs).toISOString(),
    message_count: messageCount,
    cwd,
    repo,
  };
}
