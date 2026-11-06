// Run change capture (schema v13).
//
// An unattended queue run is only useful if you can tell afterwards what it
// did. Before each `relay run` / `relay queue run` launch relay records the
// repo's HEAD and dirty-file state; afterwards it diffs the work tree
// against the pre-run HEAD and keeps the files whose diff changed during the
// run (pre-existing uncommitted edits the agent did not touch are left out)
// plus the number of commits the agent made. Stored on runs.head_before /
// head_after / changes and shown by `relay runs`, `relay show` and the Web
// task detail.

import { spawnSync } from "node:child_process";

/** Max files kept per run; the rest are counted in `more`. */
export const MAX_CHANGED_FILES = 50;

export interface RunChangedFile {
  path: string;
  /** Lines added / removed vs the pre-run HEAD; null for binary/untracked. */
  added: number | null;
  removed: number | null;
}

export interface RunChanges {
  head_before: string | null;
  head_after: string | null;
  commits: number;
  files: RunChangedFile[];
  more: number;
}

export interface RunBaseline {
  repoRoot: string;
  head: string;
  /** path → "added\tremoved" of the work tree vs HEAD before the run. */
  dirty: Map<string, string>;
  untracked: Set<string>;
}

function git(cwd: string, args: string[]): string | null {
  const res = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout;
}

function parseNumstat(out: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!out) return map;
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [added, removed, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path || added === undefined || removed === undefined) continue;
    map.set(path, `${added}\t${removed}`);
  }
  return map;
}

function listUntracked(cwd: string): Set<string> {
  const out = git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  return new Set((out ?? "").split("\n").filter(Boolean));
}

/** Snapshot taken right before launch; null outside a git work tree. */
export function captureBaseline(repoRoot: string): RunBaseline | null {
  const head = git(repoRoot, ["rev-parse", "HEAD"])?.trim();
  if (!head) return null;
  return {
    repoRoot,
    head,
    dirty: parseNumstat(git(repoRoot, ["diff", "--numstat", "--no-renames", "HEAD"])),
    untracked: listUntracked(repoRoot),
  };
}

function lineCount(stat: string): { added: number | null; removed: number | null } {
  const [a, r] = stat.split("\t");
  const added = a === "-" || a === undefined ? null : Number(a);
  const removed = r === "-" || r === undefined ? null : Number(r);
  return {
    added: added !== null && Number.isFinite(added) ? added : null,
    removed: removed !== null && Number.isFinite(removed) ? removed : null,
  };
}

/** What changed since `baseline`; never throws. */
export function computeChanges(baseline: RunBaseline): RunChanges | null {
  const { repoRoot } = baseline;
  try {
    const headAfter = git(repoRoot, ["rev-parse", "HEAD"])?.trim() ?? null;
    let commits = 0;
    if (headAfter && headAfter !== baseline.head) {
      const count = git(repoRoot, ["rev-list", "--count", `${baseline.head}..${headAfter}`]);
      commits = count ? Number(count.trim()) || 0 : 0;
    }
    // Work tree (incl. new commits) vs the pre-run HEAD, so committed and
    // uncommitted edits land in one list on the same base as `dirty`.
    const after = parseNumstat(git(repoRoot, ["diff", "--numstat", "--no-renames", baseline.head]));
    const files: RunChangedFile[] = [];
    for (const [path, stat] of after) {
      if (baseline.dirty.get(path) === stat) continue; // dirty before, untouched
      files.push({ path, ...lineCount(stat) });
    }
    // Files the pre-run dirty state had but the work tree no longer differs
    // on (the agent reverted or committed them away to the old content).
    for (const path of baseline.dirty.keys()) {
      if (!after.has(path)) files.push({ path, added: 0, removed: 0 });
    }
    for (const path of listUntracked(repoRoot)) {
      if (!baseline.untracked.has(path)) files.push({ path, added: null, removed: null });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return {
      head_before: baseline.head,
      head_after: headAfter,
      commits,
      files: files.slice(0, MAX_CHANGED_FILES),
      more: Math.max(0, files.length - MAX_CHANGED_FILES),
    };
  } catch {
    return null;
  }
}

/** Decode runs.changes defensively (NULL / malformed → null). */
export function parseRunChanges(
  raw: unknown,
  headBefore: unknown = null,
  headAfter: unknown = null,
): RunChanges | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RunChanges> | null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.files)) return null;
    return {
      head_before: typeof headBefore === "string" ? headBefore : null,
      head_after: typeof headAfter === "string" ? headAfter : null,
      commits: typeof parsed.commits === "number" ? parsed.commits : 0,
      files: parsed.files.filter(
        (f): f is RunChangedFile => !!f && typeof f === "object" && typeof (f as RunChangedFile).path === "string",
      ),
      more: typeof parsed.more === "number" ? parsed.more : 0,
    };
  } catch {
    return null;
  }
}

/** "3 files (+12 −4), 1 commit" — or "no changes". */
export function formatChangeSummary(changes: RunChanges): string {
  const total = changes.files.length + changes.more;
  if (total === 0 && changes.commits === 0) return "no changes";
  let added = 0;
  let removed = 0;
  for (const f of changes.files) {
    added += f.added ?? 0;
    removed += f.removed ?? 0;
  }
  const parts = [`${total} file${total === 1 ? "" : "s"}${total > 0 ? ` (+${added} −${removed})` : ""}`];
  if (changes.commits > 0) parts.push(`${changes.commits} commit${changes.commits === 1 ? "" : "s"}`);
  return parts.join(", ");
}
