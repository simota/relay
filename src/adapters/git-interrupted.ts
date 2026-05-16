import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

/**
 * Interrupted git states we surface as inbox items. Each entry maps the
 * stable "kind" we encode into source_id to the on-disk artefact we stat.
 *
 *   kind          | sentinel under `<repo>/.git/`
 *   --------------+------------------------------------
 *   rebase-merge  | rebase-merge/      (directory)
 *   rebase-apply  | rebase-apply/      (directory)
 *   merge         | MERGE_HEAD         (file)
 *   cherry-pick   | CHERRY_PICK_HEAD   (file)
 *   revert        | REVERT_HEAD        (file)
 *   bisect        | BISECT_LOG         (file)
 *
 * `git status` itself checks the same set of paths to decide whether the
 * working tree is "in the middle of" something — this adapter is a
 * cross-repo scan of that same signal.
 */
type Kind =
  | "rebase-merge"
  | "rebase-apply"
  | "merge"
  | "cherry-pick"
  | "revert"
  | "bisect";

const KINDS: ReadonlyArray<{ kind: Kind; sentinel: string }> = [
  { kind: "rebase-merge", sentinel: "rebase-merge" },
  { kind: "rebase-apply", sentinel: "rebase-apply" },
  { kind: "merge", sentinel: "MERGE_HEAD" },
  { kind: "cherry-pick", sentinel: "CHERRY_PICK_HEAD" },
  { kind: "revert", sentinel: "REVERT_HEAD" },
  { kind: "bisect", sentinel: "BISECT_LOG" },
];

// Priority decays linearly with age. Fresh interruption (today) lands at 75
// (between gh_notification mention=55 and gh_run_failure default-branch=80),
// then loses 5 points per day until it bottoms out at 50 — still above the
// generic code_todo baseline so a stale stash-like state stays visible.
const PRIORITY_BASE = 75;
const PRIORITY_PER_DAY = 5;
const PRIORITY_FLOOR = 50;

// First few lines of `rebase-merge/todo` / `MERGE_MSG` / `CHERRY_PICK_HEAD`
// are enough context for the user to remember what they were doing. The
// full file can be megabytes for a bisect log; truncating at 5 lines keeps
// the SQLite row cheap and the web detail panel readable.
const BODY_PREVIEW_LINES = 5;

export const gitInterruptedAdapter: Adapter = {
  name: "git_interrupted",

  precheck(ctx: AdapterContext): { skip: true; reason: string } | null {
    // Walk every root once looking for any `.git` directory. We don't
    // recurse deeply — repos live as direct children of a root in the
    // standard relay layout (`scan.roots = ["~/repos/github.com"]` etc.).
    // If zero candidates show up, fetch() would be a no-op anyway; report
    // SKIPPED so `relay doctor` makes the misconfig visible instead of a
    // silent green.
    for (const root of ctx.roots) {
      if (!existsSync(root)) continue;
      let entries: string[] = [];
      try {
        entries = readdirSyncSafe(root);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.startsWith(".")) continue;
        if (existsSync(join(root, entry, ".git"))) {
          return null;
        }
      }
    }
    return { skip: true, reason: "no .git directories found under scan.roots" };
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const { open } = await scanAll(ctx);
    return open;
  },

  /**
   * For every repo we walked, emit a `ResolvedSource` for each of the six
   * kinds whose sentinel is currently *absent*. The DB-side
   * `closeTasksBySourceIds` is a no-op for source_ids that never existed,
   * so emitting all 6 negatives per repo is cheap and self-cleaning: any
   * task previously inserted for a kind that has since been completed
   * (`git rebase --continue` / `--abort`) gets auto-closed (undo-ably).
   */
  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    const { resolved } = await scanAll(ctx);
    return resolved;
  },
};

interface ScanResult {
  open: TaskInput[];
  resolved: ResolvedSource[];
}

async function scanAll(ctx: AdapterContext): Promise<ScanResult> {
  const open: TaskInput[] = [];
  const resolved: ResolvedSource[] = [];
  const now = Date.now();

  const seen = new Set<string>();
  for (const repoDir of await enumerateGitRepos(ctx)) {
    if (seen.has(repoDir)) continue;
    seen.add(repoDir);
    const repo = basename(repoDir);
    const gitDir = join(repoDir, ".git");

    // Stat every kind's sentinel concurrently. node:fs/promises.stat does
    // not throw on a fresh ENOENT — we map it to `null` and treat it as
    // "kind currently absent, eligible for fetchResolved".
    const stats = await Promise.all(
      KINDS.map(async ({ kind, sentinel }) => ({
        kind,
        sentinel,
        st: await stat(join(gitDir, sentinel)).catch(() => null),
      })),
    );

    for (const { kind, sentinel, st } of stats) {
      const sourceId = sourceIdFor(repo, kind);
      if (!st) {
        resolved.push({ source_type: "git_interrupted", source_id: sourceId });
        continue;
      }
      const ageMs = Math.max(0, now - st.mtimeMs);
      const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      const body = await renderBody(gitDir, kind, sentinel);
      open.push({
        source_type: "git_interrupted",
        source_id: sourceId,
        repo,
        title: `Interrupted ${kind} in ${repo} (${days}d ago)`,
        body,
        status: "open",
        assignee: "self",
        priority: computePriority(days),
        prompt: null,
        files: [join(gitDir, sentinel)],
        context_hash: null,
        session_id: null,
        due_at: null,
        wait_on: "self",
      });
    }
  }

  return { open, resolved };
}

function sourceIdFor(repo: string, kind: Kind): string {
  return `${repo}:git-state:${kind}`;
}

function computePriority(days: number): number {
  const raw = PRIORITY_BASE - days * PRIORITY_PER_DAY;
  if (raw < PRIORITY_FLOOR) return PRIORITY_FLOOR;
  if (raw > 100) return 100;
  return raw;
}

/**
 * Best-effort context body. Each kind has its own most-informative artefact:
 *  - rebase-merge / rebase-apply → the `todo` file (pending steps).
 *  - merge → `MERGE_MSG` (commit message git would use on `--continue`).
 *  - cherry-pick / revert → the SHA in `CHERRY_PICK_HEAD` / `REVERT_HEAD`.
 *  - bisect → last few lines of `BISECT_LOG` (commands run so far).
 *
 * Failures (file gone between stat and read, permission denied, binary
 * content) fall back to the sentinel path so the task is still useful.
 */
async function renderBody(gitDir: string, kind: Kind, sentinel: string): Promise<string> {
  const sentinelPath = join(gitDir, sentinel);
  const lines: string[] = [];

  if (kind === "rebase-merge" || kind === "rebase-apply") {
    const todoText = await readFile(join(sentinelPath, "todo"), "utf8").catch(() => null);
    if (todoText) {
      const preview = previewLines(todoText, BODY_PREVIEW_LINES);
      lines.push("rebase todo:");
      lines.push("```");
      lines.push(preview);
      lines.push("```");
    }
  } else if (kind === "merge") {
    const msg = await readFile(join(gitDir, "MERGE_MSG"), "utf8").catch(() => null);
    if (msg) {
      lines.push("merge message:");
      lines.push(previewLines(msg, BODY_PREVIEW_LINES));
    }
  } else if (kind === "cherry-pick" || kind === "revert") {
    const head = await readFile(sentinelPath, "utf8").catch(() => null);
    if (head) {
      const sha = head.trim().slice(0, 12);
      lines.push(`${kind} HEAD: ${sha}`);
    }
  } else if (kind === "bisect") {
    const log = await readFile(sentinelPath, "utf8").catch(() => null);
    if (log) {
      lines.push("bisect log (tail):");
      lines.push(tailLines(log, BODY_PREVIEW_LINES));
    }
  }

  // Always anchor the body with a relative-ish path so `relay show` is
  // useful even when the kind-specific extract is empty (e.g. mid-rebase
  // with no remaining todo).
  lines.push(`\`.git/${sentinel}\``);
  return lines.join("\n");
}

function previewLines(text: string, n: number): string {
  const lines = text.split("\n").slice(0, n);
  return lines.join("\n").trimEnd();
}

function tailLines(text: string, n: number): string {
  const lines = text.split("\n");
  const start = Math.max(0, lines.length - n);
  return lines.slice(start).join("\n").trimEnd();
}

/**
 * Yield every directory under `ctx.roots` whose immediate child contains a
 * `.git` entry. We deliberately only descend one level: the relay layout
 * is `<root>/<repo>` (occasionally `<root>/<org>/<repo>` via tracked_repos),
 * so a shallow scan covers the common case without re-walking deep trees
 * the way `agents_note` and `code_todo` do.
 *
 * `tracked_repos` (absolute paths) are also honoured so users who pin a
 * repo outside `scan.roots` still get its interrupted state surfaced.
 */
async function enumerateGitRepos(ctx: AdapterContext): Promise<string[]> {
  const repos = new Set<string>();

  for (const root of ctx.roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      const repoDir = join(root, entry.name);
      if (existsSync(join(repoDir, ".git"))) {
        repos.add(repoDir);
      }
    }
  }

  if (ctx.trackedRepos) {
    for (const trackedPath of ctx.trackedRepos) {
      if (existsSync(join(trackedPath, ".git"))) {
        repos.add(trackedPath);
      }
    }
  }

  return [...repos];
}

// Sync helper used by precheck — avoids paying for async readdir before
// fetch even runs. `existsSync` already short-circuits when the root is
// missing, so the only failure modes here are permission errors we want
// to skip silently.
function readdirSyncSafe(root: string): string[] {
  return readdirSync(root);
}
