import { existsSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { basename, join } from "node:path";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

/**
 * Sweep `git stash list` across every repo under `scan.roots` (and any
 * `tracked_repos` pinned outside those roots) to surface dormant WIP.
 *
 * Companion to `git_interrupted` (PR #96): that adapter catches mid-rebase
 * / mid-merge state via `.git/` sentinels; this one catches the "I'll
 * just stash this and come back later" trap that — across 40 repos —
 * silently accumulates into weeks of forgotten context.
 *
 * Implementation is `git stash list` only (`git stash show --stat` opt-in
 * via `[git_stash].store_body = true`). Auth is local; no network call.
 *
 * fetchResolved (pop/drop = done) is implemented by diffing the live stash
 * oid set against the DB-known open source_ids for `git_stash`, via the
 * optional `ctx.knownOpenSourceIds` callback. A popped/dropped stash leaves
 * no on-disk trace, so this DB-side hint is the only way to find the
 * "previously seen but gone now" set without per-adapter state files.
 */

// Priority decays linearly with age. Fresh stash (today) lands at 70 —
// below `git_interrupted` fresh (75) since a stash is voluntary and
// half-finished work is a less acute interruption than a frozen rebase.
// 1 point lost per day, floor 40 so 30+ day stashes still sort above the
// generic code_todo baseline.
const PRIORITY_BASE = 70;
const PRIORITY_PER_DAY = 1;
const PRIORITY_FLOOR = 40;

// Stash subject is the message after the `WIP on <branch>: <sha> <msg>`
// or `On <branch>: <msg>` prefix git inserts automatically. We prepend
// `Stashed WIP in <repo>: ` so the title is self-describing in `relay
// today` even when the user scans across repos.
const TITLE_MAX_CHARS = 100;

// Per-call `git stash show --stat <oid>` time-bound. A pathological
// stash (huge binary diff) shouldn't be allowed to stall the whole sync.
const STASH_SHOW_TIMEOUT_MS = 300;

// Cumulative budget for all `git stash show` calls in one sync. Even if
// every stash hits its individual timeout, we stop calling once the total
// reaches this — protects 40-repo sweeps with dozens of stashes from
// becoming a 30+ second tail on `relay sync`.
const STASH_SHOW_TOTAL_BUDGET_MS = 30 * 1000;

// `git stash list --format='%gd|%ai|%H|%s'`:
//   %gd → reflog selector (e.g. `stash@{0}`) — volatile, used only for body
//   %ai → ISO 8601 author date (`2026-05-13 14:22:31 +0900`)
//   %H  → full commit oid — stable per-content identity
//   %s  → subject (stash message, single line in stash payloads)
// The pipe-separator collision case (subject contains `|`) is handled by
// `splitFirstN(line, "|", 3)`: the first 3 separators are field boundaries,
// anything after stays in the subject field verbatim.
const STASH_FORMAT = "%gd|%ai|%H|%s";

type StashEntry = {
  reflogSelector: string; // e.g. `stash@{0}` — volatile, only used in body
  authorDate: string;     // ISO 8601 from %ai
  oid: string;            // full sha — stable identity
  subject: string;        // raw stash message
};

export const gitStashAdapter: Adapter = {
  name: "git_stash",

  precheck(ctx: AdapterContext): { skip: true; reason: string } | null {
    // `git --version` is the cheapest "is git on PATH?" probe. Failure
    // modes: ENOENT (no git binary), permission denied, or git printing
    // an error while exit 0 — we accept any exit-0 as PASS.
    const res = spawnSync("git", ["--version"], { encoding: "utf8" });
    if (res.error || res.status !== 0) {
      return { skip: true, reason: "git CLI not found in PATH" };
    }
    // Same shallow-roots ground-truth check as `git_interrupted`. If no
    // root contains even one `.git` repo, fetch() would be a no-op and
    // SKIPPED in `relay doctor` is more honest than a silent green.
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
    // Also accept any tracked_repos pin that resolves to a git repo —
    // we don't want a misconfigured root to mask an explicit opt-in.
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

  /**
   * Diff the *currently visible* stash oid set against the DB's *open
   * git_stash source_ids*. Anything the DB knows about but the live
   * sweep no longer sees has been popped or dropped — emit it as
   * resolved so `autoCloseResolvedRemoteTasks` closes the task
   * (undo-able via `relay undo`).
   *
   * If `ctx.knownOpenSourceIds` isn't wired (e.g. unit-test harness),
   * we degrade to a no-op: `fetch()` will still ingest current stashes
   * idempotently, the user just has to close popped tasks manually.
   */
  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    if (!ctx.knownOpenSourceIds) return [];

    const { liveSourceIds } = await scanCurrent(ctx);
    const known = ctx.knownOpenSourceIds("git_stash");
    if (known.length === 0) return [];

    const live = new Set(liveSourceIds);
    const resolved: ResolvedSource[] = [];
    for (const sourceId of known) {
      if (live.has(sourceId)) continue;
      resolved.push({ source_type: "git_stash", source_id: sourceId });
    }
    return resolved;
  },
};

interface ScanResult {
  tasks: TaskInput[];
  /** Source IDs visible *right now* — used by `fetchResolved` for the diff. */
  liveSourceIds: string[];
}

async function scanCurrent(ctx: AdapterContext): Promise<ScanResult> {
  const repos = await enumerateGitRepos(ctx);
  if (repos.length === 0) return { tasks: [], liveSourceIds: [] };

  const storeBody = ctx.gitStash?.storeBody ?? false;
  const now = Date.now();

  // Per-repo sweeps run in parallel. `git stash list` is a local reflog
  // read so it doesn't hit the network; 40 concurrent calls saturate the
  // disk briefly but finish well under the per-repo 50 ms budget called
  // out in the task brief.
  const perRepo = await Promise.all(
    repos.map(async (repoDir) => {
      const repo = basename(repoDir);
      const entries = await listStashes(repoDir);
      return { repo, repoDir, entries };
    }),
  );

  const tasks: TaskInput[] = [];
  const liveSourceIds: string[] = [];

  // Cumulative body-fetch budget. Each `git stash show` is bounded by
  // STASH_SHOW_TIMEOUT_MS; this overall cap protects against pathological
  // repos with dozens of large stashes.
  const budget = { remainingMs: STASH_SHOW_TOTAL_BUDGET_MS };

  for (const { repo, repoDir, entries } of perRepo) {
    if (entries.length === 0) continue; // stash 0 件 repo は task 0 件 — 静的 skip

    for (const entry of entries) {
      const sourceId = sourceIdFor(repo, entry.oid);
      liveSourceIds.push(sourceId);

      const ageDays = computeAgeDays(now, entry.authorDate);
      const title = truncate(
        `Stashed WIP in ${repo}: ${entry.subject}`,
        TITLE_MAX_CHARS,
      );
      const body = await renderBody(
        repoDir,
        entry,
        repo,
        ageDays,
        storeBody,
        budget,
      );

      tasks.push({
        source_type: "git_stash",
        source_id: sourceId,
        repo,
        title,
        body,
        status: "open",
        assignee: "self",
        priority: computePriority(ageDays),
        prompt: null,
        files: [],
        context_hash: null,
        session_id: null,
        due_at: null,
        wait_on: "self",
      });
    }
  }

  return { tasks, liveSourceIds };
}

function sourceIdFor(repo: string, oid: string): string {
  // 8-char short oid is collision-safe within a single repo's stash list
  // (typically <50 entries even for power users) and gives us a stable
  // identifier through `git stash push`/`pop` cycles that move
  // `stash@{0}` around without changing the underlying content.
  const shortOid = oid.slice(0, 8);
  return `${repo}:stash:${shortOid}`;
}

function computePriority(days: number): number {
  const raw = PRIORITY_BASE - days * PRIORITY_PER_DAY;
  if (raw < PRIORITY_FLOOR) return PRIORITY_FLOOR;
  if (raw > 100) return 100;
  return raw;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function computeAgeDays(now: number, isoDate: string): number {
  const parsed = Date.parse(isoDate);
  if (Number.isNaN(parsed)) return 0;
  const ms = Math.max(0, now - parsed);
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Render the task body. Always anchored with the stash reflog selector
 * and short oid so `relay show` is informative even when storeBody is
 * off. With opt-in enabled, append a `--stat` summary (touched files +
 * line counts) — never the full `-p` patch, which would balloon the
 * SQLite row and risk leaking uncommitted secrets.
 */
async function renderBody(
  repoDir: string,
  entry: StashEntry,
  repo: string,
  ageDays: number,
  storeBody: boolean,
  budget: { remainingMs: number },
): Promise<string> {
  const lines: string[] = [];
  lines.push(`stash: ${entry.reflogSelector} (oid ${entry.oid.slice(0, 12)})`);
  lines.push(`age: ${ageDays}d (since ${entry.authorDate})`);
  lines.push(`repo: ${repo}`);

  if (storeBody && budget.remainingMs > 0) {
    const stat = await stashShowStat(repoDir, entry.oid, budget);
    if (stat) {
      lines.push("");
      lines.push("```");
      lines.push(stat);
      lines.push("```");
    }
  }

  return lines.join("\n");
}

/**
 * Best-effort `git stash show --stat <oid>` capture. Returns null on
 * timeout, non-zero exit, or empty output. We use `oid` (not the
 * `stash@{0}` reflog selector) because the selector shifts when stashes
 * are pushed/popped; the oid is content-addressed and stable.
 */
async function stashShowStat(
  repoDir: string,
  oid: string,
  budget: { remainingMs: number },
): Promise<string | null> {
  const start = Date.now();
  const out = await runGit(
    repoDir,
    ["stash", "show", "--stat", oid],
    Math.min(STASH_SHOW_TIMEOUT_MS, budget.remainingMs),
  );
  budget.remainingMs -= Date.now() - start;
  if (!out || out.trim() === "") return null;
  return out.trimEnd();
}

/**
 * `git stash list --format=<STASH_FORMAT>` per repo. Empty list → empty
 * array; non-zero exit (corrupt repo, permission error) → empty array
 * silently. A single broken repo must not abort the whole 40-repo sweep.
 */
async function listStashes(repoDir: string): Promise<StashEntry[]> {
  const out = await runGit(repoDir, [
    "stash",
    "list",
    `--format=${STASH_FORMAT}`,
  ]);
  if (out === null) return [];
  const lines = out.split("\n");
  const entries: StashEntry[] = [];
  for (const line of lines) {
    if (line === "") continue;
    const parsed = parseStashLine(line);
    if (parsed) entries.push(parsed);
  }
  return entries;
}

/**
 * Split on `|` but stop after 3 separators so a stash subject containing
 * pipes (rare but legal — stash messages are arbitrary user text) round-
 * trips intact. The 4th field captures everything after the 3rd `|`,
 * pipes included.
 */
function parseStashLine(line: string): StashEntry | null {
  const parts = splitFirstN(line, "|", 3);
  if (parts.length < 4) return null;
  const [selector, date, oid, subject] = parts;
  if (!selector || !date || !oid || subject === undefined) return null;
  // Sanity: %H must be a 40-char hex sha. Anything else points at a
  // misformatted `--format` (impossible from our own code, but cheap to
  // double-check before we treat it as a stable identifier).
  if (!/^[0-9a-f]{40}$/.test(oid)) return null;
  return {
    reflogSelector: selector,
    authorDate: date,
    oid,
    subject: subject.length === 0 ? "(no message)" : subject,
  };
}

/**
 * Split `s` on `sep` into at most `n + 1` parts. The last element
 * captures the rest of the string verbatim — separators inside survive.
 * Behaves like Python's `str.split(sep, n)`.
 */
function splitFirstN(s: string, sep: string, n: number): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < n; i++) {
    const idx = s.indexOf(sep, from);
    if (idx === -1) {
      out.push(s.slice(from));
      return out;
    }
    out.push(s.slice(from, idx));
    from = idx + sep.length;
  }
  out.push(s.slice(from));
  return out;
}

/**
 * Spawn `git <args>` in `repoDir`. Returns stdout on exit 0, or `null`
 * on any failure (non-zero exit, missing binary, timeout). Stays silent
 * on stderr by design: a single missing-repo / corrupt-reflog warning
 * shouldn't abort a 40-repo sweep.
 *
 * `timeoutMs` clamps wall-clock — `subprocess.kill()` isn't instantaneous
 * on macOS so we belt-and-braces with a setTimeout race.
 */
function runGit(
  repoDir: string,
  args: string[],
  timeoutMs?: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, {
      cwd: repoDir,
      // Disable any interactive prompts (credential helper, ssh
      // passphrase). `git stash list` doesn't need them but a corrupted
      // repo can occasionally ask, and we'd rather skip than hang.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore — child may already be dead
        }
        finish(null);
      }, timeoutMs);
    }
    proc.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    proc.on("error", () => {
      if (timer) clearTimeout(timer);
      finish(null);
    });
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        finish(null);
        return;
      }
      finish(stdout);
    });
  });
}

/**
 * Same shallow-walk pattern as `git_interrupted`: one level under each
 * `scan.roots` entry plus any absolute paths in `tracked_repos`. The
 * Set dedupe means a tracked repo that also lives under a root
 * contributes exactly one entry.
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
