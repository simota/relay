import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

const PRIORITY_BASE = 68;
const PRIORITY_PER_DAY = 2;
const PRIORITY_FLOOR = 45;
const STATUS_TIMEOUT_MS = 800;

export const gitDirtyWorktreeAdapter: Adapter = {
  name: "git_dirty_worktree",

  precheck(ctx: AdapterContext): { skip: true; reason: string } | null {
    const res = spawnSync("git", ["--version"], { encoding: "utf8" });
    if (res.error || res.status !== 0) return { skip: true, reason: "git CLI not found in PATH" };

    for (const root of ctx.roots) {
      if (!existsSync(root)) continue;
      let entries: string[] = [];
      try {
        entries = readdirSync(root);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        if (existsSync(join(root, entry, ".git"))) return null;
      }
    }
    if (ctx.trackedRepos) {
      for (const trackedPath of ctx.trackedRepos) {
        if (existsSync(join(trackedPath, ".git"))) return null;
      }
    }
    return { skip: true, reason: "no .git directories found under scan.roots" };
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const { tasks } = await scanCurrent(ctx);
    return tasks;
  },

  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    const { cleanSourceIds } = await scanCurrent(ctx);
    return cleanSourceIds.map((source_id) => ({ source_type: "git_dirty_worktree", source_id }));
  },
};

async function scanCurrent(ctx: AdapterContext): Promise<{ tasks: TaskInput[]; cleanSourceIds: string[] }> {
  const tasks: TaskInput[] = [];
  const cleanSourceIds: string[] = [];
  const repos = await enumerateGitRepos(ctx);
  const now = Date.now();

  for (const repoDir of repos) {
    const repo = basename(repoDir);
    const sourceId = `${repo}:dirty-worktree`;
    const files = await dirtyFiles(repoDir);
    if (files.length === 0) {
      cleanSourceIds.push(sourceId);
      continue;
    }

    const ageDays = await oldestDirtyAgeDays(repoDir, files, now);
    const shown = files.slice(0, 12);
    const more = files.length > shown.length ? `\n... +${files.length - shown.length} more` : "";
    tasks.push({
      source_type: "git_dirty_worktree",
      source_id: sourceId,
      repo,
      title: `Uncommitted changes in ${repo} (${files.length} file${files.length === 1 ? "" : "s"})`,
      body: [
        `dirty files: ${files.length}`,
        `oldest touched: ${ageDays}d`,
        "",
        ...shown.map((file) => `- ${file}`),
        more,
      ].filter(Boolean).join("\n"),
      status: "open",
      assignee: "self",
      priority: computePriority(ageDays, files),
      prompt: null,
      files,
      context_hash: null,
      session_id: null,
      due_at: null,
      wait_on: "self",
    });
  }

  return { tasks, cleanSourceIds };
}

async function dirtyFiles(repoDir: string): Promise<string[]> {
  const stdout = await git(repoDir, ["status", "--porcelain=v1"]);
  const files = new Set<string>();
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    const raw = line.slice(3).trim();
    if (!raw) continue;
    const path = raw.includes(" -> ") ? raw.split(" -> ").at(-1)! : raw;
    files.add(path.replace(/^"|"$/g, ""));
  }
  return [...files].sort();
}

async function oldestDirtyAgeDays(repoDir: string, files: string[], now: number): Promise<number> {
  let oldest = now;
  for (const file of files) {
    const st = await stat(join(repoDir, file)).catch(() => null);
    if (!st) continue;
    oldest = Math.min(oldest, st.mtimeMs);
  }
  return Math.max(0, Math.floor((now - oldest) / 86_400_000));
}

function computePriority(ageDays: number, files: string[]): number {
  const hashPenalty = createHash("sha1").update(files.join("\n")).digest()[0]! % 3;
  const raw = PRIORITY_BASE - ageDays * PRIORITY_PER_DAY + Math.min(10, files.length) - hashPenalty;
  return Math.max(PRIORITY_FLOOR, Math.min(85, raw));
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd });
    let stdout = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), STATUS_TIMEOUT_MS);
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    proc.on("close", () => {
      clearTimeout(timer);
      resolve(stdout);
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

async function enumerateGitRepos(ctx: AdapterContext): Promise<string[]> {
  const repos = new Set<string>();
  for (const root of ctx.roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const repoDir = join(root, entry.name);
      if (existsSync(join(repoDir, ".git"))) repos.add(repoDir);
    }
  }
  if (ctx.trackedRepos) {
    for (const trackedPath of ctx.trackedRepos) {
      if (existsSync(join(trackedPath, ".git"))) repos.add(trackedPath);
    }
  }
  return [...repos];
}
