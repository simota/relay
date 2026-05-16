import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolveRepoForCwd } from "../lib/repo-from-cwd.js";
import type { Adapter, AdapterContext, TaskInput } from "../types.js";

const TODO_PATTERN =
  String.raw`(TODO|FIXME|HACK|XXX)(\([^)]*\))?:?\s+(.+)$`;

interface RgMatch {
  type: "match";
  data: {
    path: { text: string };
    line_number: number;
    lines: { text: string };
    submatches: Array<{ start: number; end: number; match: { text: string } }>;
  };
}

export const codeTodoAdapter: Adapter = {
  name: "code_todo",

  precheck(): { skip: true; reason: string } | null {
    // `rg` is the only way this adapter scans for TODOs — without it the
    // sweep would fail every run and the SKIPPED state is more honest than
    // a recurring `rg: not found` error in the health view.
    const res = spawnSync("rg", ["--version"], { encoding: "utf8" });
    if (res.error || res.status !== 0) {
      return {
        skip: true,
        reason: "ripgrep not installed (install ripgrep to enable code TODO scanning)",
      };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    // Each `runRipgrep` spawns a separate `rg` subprocess; the per-root
    // calls share no in-process state, so running them in parallel keeps
    // wall-clock time close to the slowest root instead of summing them.
    // Critical once `tracked_repos` extends `ctx.roots` beyond the base
    // `scan.roots` (see `src/commands/sync.ts:97-100`).
    const perRoot = await Promise.all(
      ctx.roots.map(async (root) => {
        const matches = await runRipgrep(root, ctx.exclude);
        return { root, matches };
      }),
    );

    const tasks: TaskInput[] = [];
    for (const { root, matches } of perRoot) {
      for (const m of matches) {
        const parsed = parseTodoLine(m.data.lines.text);
        if (!parsed) continue;

        const filePath = m.data.path.text;
        const repo = resolveRepoForCwd(filePath, ctx.roots) ?? inferRepoName(filePath, root);
        if (!repo) continue;

        const sourceId = makeSourceId(repo, filePath, m.data.line_number, parsed.title);

        tasks.push({
          source_type: "code_todo",
          source_id: sourceId,
          repo,
          title: parsed.title,
          body: `\`${filePath}:${m.data.line_number}\`\n\nTag: ${parsed.tag}${parsed.scope ? ` ${parsed.scope}` : ""}`,
          status: "open",
          assignee: parsed.tag === "FIXME" ? "claude-code" : "self",
          priority: parsed.tag === "FIXME" ? 70 : 50,
          prompt: null,
          files: [filePath],
          context_hash: null,
          session_id: null,
          due_at: null,
          wait_on: "self",
        });
      }
    }

    return tasks;
  },
};

function runRipgrep(root: string, exclude: string[]): Promise<RgMatch[]> {
  return new Promise((resolve, reject) => {
    const args = [
      "--json",
      "--no-messages",
      ...exclude.flatMap((e) => ["--glob", `!${e}`]),
      "-e",
      TODO_PATTERN,
      root,
    ];
    const proc = spawn("rg", args);
    let buf = "";
    const matches: RgMatch[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "match") matches.push(obj as RgMatch);
        } catch {
          // ignore malformed lines
        }
      }
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      // rg exits 1 when no matches — treat as success
      if (code === 0 || code === 1) resolve(matches);
      else reject(new Error(`rg exited with ${code}`));
    });
  });
}

function parseTodoLine(
  line: string,
): { tag: string; scope?: string; title: string } | null {
  const re = new RegExp(TODO_PATTERN);
  const m = re.exec(line.trimEnd());
  if (!m) return null;
  return {
    tag: m[1]!,
    scope: m[2],
    title: m[3]!.trim(),
  };
}

/**
 * Fallback used only when `resolveRepoForCwd` can't find a `.git` directory
 * by walking up from the file path. Treats the first path segment beneath
 * `root` as the repo name. Misfires on `<org>/<repo>` layouts and on files
 * outside `root` — both are now handled by the `.git` walk-up — but this is
 * still useful for TODOs that genuinely live under a non-git tree (loose
 * dotfiles, scratch dirs) so we don't silently drop them.
 */
function inferRepoName(filePath: string, root: string): string | null {
  const rel = filePath.startsWith(root) ? filePath.slice(root.length + 1) : filePath;
  const first = rel.split("/")[0];
  return first ?? null;
}

function makeSourceId(repo: string, file: string, line: number, title: string): string {
  const titleHash = createHash("sha256").update(title).digest("hex").slice(0, 8);
  return `${repo}:${file}:${line}:${titleHash}`;
}
