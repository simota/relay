import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

// Matches GitHub-style task list checkboxes. Capture group 1 is the inner
// char: " " = open, "x"/"X" = done. We tolerate `- [ ]`, `- [x]`, `- [X]`,
// and `- [ x ]` (rare hand-edit) to match GitHub's renderer behavior.
const CHECKBOX_PATTERN = /^\s*-\s*\[\s*([ xX])\s*\]\s+(.+)$/;

interface ScanResult {
  open: TaskInput[];
  resolved: ResolvedSource[];
  /**
   * How many `<root>/<repo>/.agents/` directories were actually found
   * during the walk. `fetch()` uses this to log a warning when zero —
   * a strong hint that `scan.roots` is misconfigured.
   */
  agentsDirCount: number;
}

export const agentsNoteAdapter: Adapter = {
  name: "agents_note",

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const { open, agentsDirCount } = await scanAll(ctx);
    // Observability: no precheck (the scan itself is the side-effect-free
    // probe), but if nothing under `scan.roots` carries a `.agents/`
    // directory the adapter has no work to ingest — surface that so users
    // notice misconfigured roots instead of silently shipping zero tasks.
    if (agentsDirCount === 0) {
      ctx.log?.(
        "  ⊘ agents_note: no .agents/ directories found under scan.roots — no work to ingest",
      );
    }
    return open;
  },

  // When a `.agents/*.md` checkbox flips to `- [x]`, return its source_id
  // so sync's `autoCloseResolvedRemoteTasks` can close (undo-ably) the
  // matching DB task. The source_id formula matches `fetch()` so the same
  // line produces the same id whether it's currently `- [ ]` or `- [x]`.
  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    const { resolved } = await scanAll(ctx);
    return resolved;
  },
};

// Walk every `<root>/<repo>/.agents/*.md`, parse checkbox lines once, and
// split them into open TaskInputs (for `fetch`) and resolved source refs
// (for `fetchResolved`). Single pass keeps fs I/O cheap and guarantees the
// two views stay consistent.
async function scanAll(ctx: AdapterContext): Promise<ScanResult> {
  const open: TaskInput[] = [];
  const resolved: ResolvedSource[] = [];
  let agentsDirCount = 0;

  // Track absolute repo paths already scanned via ctx.roots so that
  // ctx.trackedRepos entries that fall under a scan root aren't processed
  // twice. A duplicate source_id would be silently deduplicated by the DB
  // UNIQUE constraint, but skipping early is cheaper and avoids log noise.
  const scannedRepoPaths = new Set<string>();

  for (const root of ctx.roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory() || ctx.exclude.includes(entry.name)) continue;

      const repo = entry.name;
      const repoPath = join(root, repo);
      scannedRepoPaths.add(repoPath);

      const agentsDir = join(repoPath, ".agents");
      // `readdir` on a missing dir throws ENOENT; we swallow into [] so the
      // walk continues. Tracking the dir count separately means we don't
      // conflate "no .agents/ anywhere" with "every .agents/ is empty".
      const dirStat = await stat(agentsDir).catch(() => null);
      if (!dirStat?.isDirectory()) continue;
      agentsDirCount += 1;

      const files = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".md")) continue;

        const filePath = join(agentsDir, file.name);
        const text = await readFile(filePath, "utf8").catch(() => null);
        if (text === null) continue;

        parseAgentsFile({ repo, fileName: file.name, filePath, text }, open, resolved);
      }
    }
  }

  // Additional scan layer: ctx.trackedRepos holds absolute paths that the
  // user explicitly registered via `scan.tracked_repos`. These may live
  // outside every scan root, so the loop above would never reach them.
  // For each tracked path not yet covered, scan <absPath>/.agents/*.md.
  //
  // repo name = path.basename(absPath) — mirrors how existing source_ids are
  // built (`<repo>:<fileName>:<lineHash>`). If two different tracked paths
  // share the same basename, their source_ids could collide; in practice,
  // users don't register two repos with the same directory name pointing to
  // different locations, so we accept this as a known limitation and document
  // it here rather than adding a basename-collision warning path.
  if (ctx.trackedRepos) {
    for (const absPath of ctx.trackedRepos) {
      if (scannedRepoPaths.has(absPath)) continue; // already covered above

      const repo = basename(absPath);
      const agentsDir = join(absPath, ".agents");
      const dirStat = await stat(agentsDir).catch(() => null);
      if (!dirStat?.isDirectory()) continue;
      agentsDirCount += 1;

      const files = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".md")) continue;

        const filePath = join(agentsDir, file.name);
        const text = await readFile(filePath, "utf8").catch(() => null);
        if (text === null) continue;

        parseAgentsFile({ repo, fileName: file.name, filePath, text }, open, resolved);
      }
    }
  }

  return { open, resolved, agentsDirCount };
}

interface ParseTarget {
  repo: string;
  fileName: string;
  filePath: string;
  text: string;
}

function parseAgentsFile(
  target: ParseTarget,
  open: TaskInput[],
  resolved: ResolvedSource[],
): void {
  const { repo, fileName, filePath, text } = target;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = CHECKBOX_PATTERN.exec(lines[i]!);
    if (!match) continue;

    const checked = match[1] !== " ";
    const title = match[2]!.trim();
    if (!title) continue;

    const source_id = `${repo}:${fileName}:${lineHash(title)}`;

    if (checked) {
      resolved.push({ source_type: "agents_note", source_id });
      continue;
    }

    open.push({
      source_type: "agents_note",
      source_id,
      repo,
      title,
      body: `\`${fileName}:${i + 1}\``,
      status: "open",
      assignee: "self",
      priority: 50,
      prompt: null,
      files: [filePath],
      wait_on: "self",
      context_hash: null,
      session_id: null,
      due_at: null,
    });
  }
}

function lineHash(title: string): string {
  return createHash("sha256").update(title).digest("hex").slice(0, 8);
}
