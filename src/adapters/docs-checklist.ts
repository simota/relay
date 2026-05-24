import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

const CHECKBOX_PATTERN = /^\s*-\s*\[\s*([ xX])\s*\]\s+(.+)$/;
const MAX_OPEN_PER_FILE = 100;
const ROOT_DOCS = [
  "README.md",
  "INSTALL.md",
  "CHEATSHEET.md",
  "SPEC.md",
  "ARCHITECTURE.md",
  "WEB_DESIGN.md",
  "HOTKEYS.md",
  "SESSIONS.md",
  "TODO.md",
  "ROADMAP.md",
] as const;
const DOCS_DIR_DOCS = ["TODO.md", "ROADMAP.md", "CHECKLIST.md", "TASKS.md"] as const;

export const docsChecklistAdapter: Adapter = {
  name: "docs_checklist",

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const { open } = await scanAll(ctx);
    return open;
  },

  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    const { resolved } = await scanAll(ctx);
    return resolved;
  },
};

async function scanAll(ctx: AdapterContext): Promise<{ open: TaskInput[]; resolved: ResolvedSource[] }> {
  const open: TaskInput[] = [];
  const resolved: ResolvedSource[] = [];
  const repos = await enumerateRepos(ctx);

  for (const repoDir of repos) {
    const repo = basename(repoDir);
    const files = await docsFiles(repoDir);
    for (const filePath of files) {
      const text = await readFile(filePath, "utf8").catch(() => null);
      if (text === null) continue;
      parseDocFile({ repo, repoDir, filePath, text }, open, resolved);
    }
  }

  return { open, resolved };
}

function parseDocFile(
  target: { repo: string; repoDir: string; filePath: string; text: string },
  open: TaskInput[],
  resolved: ResolvedSource[],
): void {
  const rel = relative(target.repoDir, target.filePath);
  const lines = target.text.split("\n");
  let openCount = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const match = CHECKBOX_PATTERN.exec(lines[i]!);
    if (!match) continue;
    const checked = match[1] !== " ";
    const title = match[2]!.trim();
    if (!title) continue;

    const source_id = `${target.repo}:${rel}:${lineHash(title)}`;
    if (checked) {
      resolved.push({ source_type: "docs_checklist", source_id });
      continue;
    }
    if (openCount >= MAX_OPEN_PER_FILE) continue;
    openCount += 1;

    open.push({
      source_type: "docs_checklist",
      source_id,
      repo: target.repo,
      title,
      body: `\`${rel}:${i + 1}\``,
      status: "open",
      assignee: "self",
      priority: rel.startsWith("docs/") ? 46 : 50,
      prompt: null,
      files: [target.filePath],
      context_hash: null,
      session_id: null,
      due_at: null,
      wait_on: "self",
    });
  }
}

async function docsFiles(repoDir: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of ROOT_DOCS) {
    const path = join(repoDir, name);
    const st = await stat(path).catch(() => null);
    if (st?.isFile()) files.push(path);
  }

  const docsDir = join(repoDir, "docs");
  const docsStat = await stat(docsDir).catch(() => null);
  if (docsStat?.isDirectory()) {
    for (const name of DOCS_DIR_DOCS) {
      const path = join(docsDir, name);
      const st = await stat(path).catch(() => null);
      if (st?.isFile()) files.push(path);
    }
  }

  return Array.from(new Set(files));
}

async function enumerateRepos(ctx: AdapterContext): Promise<string[]> {
  const repos = new Set<string>();
  for (const root of ctx.roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || ctx.exclude.includes(entry.name)) continue;
      const repoDir = join(root, entry.name);
      if (existsSync(repoDir)) repos.add(repoDir);
    }
  }
  if (ctx.trackedRepos) {
    for (const trackedPath of ctx.trackedRepos) {
      if (existsSync(trackedPath)) repos.add(trackedPath);
    }
  }
  return [...repos];
}

function lineHash(title: string): string {
  return createHash("sha256").update(title).digest("hex").slice(0, 8);
}
