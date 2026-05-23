// Per-repo `.agents/*.md` journal aggregator.
//
// Surfaces the "agent journal" signal the agents_note adapter misses by
// design: that adapter ingests GitHub-style task checkboxes, but most
// `.agents/*.md` files in real use are dated prose journals
// (`## YYYY-MM-DD — title`) — not task lists. With no checkboxes, the
// adapter produces zero tasks, and `/repos` looks like the journals don't
// exist even though dozens of files do.
//
// This module gives the /repos screen its missing signal: per-repo file
// count, the agent names actually present (filename stems), and the count
// of dated journal entries within a lookback window. The /repos card
// renders this as a compact chip so a user scanning the grid can see
// "this repo has been worked on by builder+nexus+spark this week" at a
// glance — independent of whether they've written any tasks.

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { loadConfig, resolveScanRoots } from "../config.js";

export interface RepoAgentJournalSummary {
  /** Repo slug (basename of the directory). */
  repo: string;
  /** Number of `.agents/*.md` files (top-level only, not recursive). */
  file_count: number;
  /**
   * Filename stems (`builder.md` → `builder`), sorted by recent activity
   * desc. Capped at 8 so the UI chip stays readable; the full list is
   * implicit in file_count.
   */
  agents: string[];
  /**
   * Count of `## YYYY-MM-DD` section headers across all journal files
   * whose date falls within the lookback window. This is the activity
   * pulse — zero means "files exist but nothing dated recently".
   */
  recent_entries: number;
  /**
   * ISO date string of the most recent dated entry observed (any file,
   * any window). Falls back to the most recent file mtime when no dated
   * sections were found. Null when no journal files exist for this repo.
   */
  last_entry_at: string | null;
}

interface ComputeOptions {
  lookbackDays?: number;
  scanRoots: string[];
  trackedRepos: string[];
  exclude: string[];
}

const DEFAULT_LOOKBACK_DAYS = 14;
const CACHE_TTL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Matches `## YYYY-MM-DD` at the start of a line, with optional trailing
// content (em dash + title, hyphen + title, etc.). We capture the date
// alone — anything after it is journal noise we don't need.
const DATE_HEADER_RE = /^##\s+(\d{4}-\d{2}-\d{2})\b/gm;

interface CacheEntry {
  computedAt: number;
  cacheKey: string;
  summaries: RepoAgentJournalSummary[];
}

let cache: CacheEntry | null = null;

export function resetRepoAgentJournalsCacheForTests(): void {
  cache = null;
}

export async function computeRepoAgentJournals(
  opts: ComputeOptions,
): Promise<RepoAgentJournalSummary[]> {
  const lookback = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const cacheKey = `${lookback}|${opts.scanRoots.join(",")}|${opts.trackedRepos.join(",")}`;
  const now = Date.now();
  if (cache && cache.cacheKey === cacheKey && now - cache.computedAt < CACHE_TTL_MS) {
    return cache.summaries;
  }

  const cutoff = new Date(now - lookback * DAY_MS).toISOString().slice(0, 10);
  const out = new Map<string, RepoAgentJournalSummary>();
  const seenRepoPaths = new Set<string>();

  // Walk every <root>/<repo>/.agents/ — mirrors the agents_note adapter's
  // scan layer so detection coverage stays identical.
  for (const root of opts.scanRoots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || opts.exclude.includes(entry.name)) continue;
      const repoPath = join(root, entry.name);
      seenRepoPaths.add(repoPath);
      const summary = await scanRepo(entry.name, repoPath, cutoff);
      if (summary) out.set(entry.name, summary);
    }
  }

  // Second pass: tracked_repos that live outside scan.roots.
  for (const absPath of opts.trackedRepos) {
    if (seenRepoPaths.has(absPath)) continue;
    const name = basename(absPath);
    const summary = await scanRepo(name, absPath, cutoff);
    if (summary) out.set(name, summary);
  }

  // Sort: most recent entries first, then alphabetical.
  const summaries = [...out.values()].sort((a, b) => {
    if (b.recent_entries !== a.recent_entries) {
      return b.recent_entries - a.recent_entries;
    }
    return a.repo.localeCompare(b.repo);
  });

  cache = { computedAt: now, cacheKey, summaries };
  return summaries;
}

async function scanRepo(
  repo: string,
  repoPath: string,
  cutoffDate: string,
): Promise<RepoAgentJournalSummary | null> {
  const agentsDir = join(repoPath, ".agents");
  const dirStat = await stat(agentsDir).catch(() => null);
  if (!dirStat?.isDirectory()) return null;

  const files = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);
  const mdFiles = files.filter((f) => f.isFile() && f.name.endsWith(".md"));
  if (mdFiles.length === 0) return null;

  let recentEntries = 0;
  let lastEntryAt: string | null = null;
  // Track per-agent (filename stem) recent activity so the top-N surface
  // reflects who is writing now, not the alphabetical order on disk.
  const agentActivity = new Map<string, { recent: number; lastDate: string | null }>();

  for (const file of mdFiles) {
    const stem = file.name.replace(/\.md$/i, "");
    const filePath = join(agentsDir, file.name);

    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch {
      continue;
    }

    let fileRecentEntries = 0;
    let fileLastDate: string | null = null;
    for (const m of text.matchAll(DATE_HEADER_RE)) {
      const date = m[1];
      if (!date) continue;
      if (!fileLastDate || date > fileLastDate) fileLastDate = date;
      if (date >= cutoffDate) fileRecentEntries += 1;
    }

    // Fall back to file mtime when the journal has no dated sections —
    // e.g. PROJECT.md or fresh files. mtime gives the user "this file was
    // edited recently" as the next-best activity signal.
    if (!fileLastDate) {
      try {
        const s = await stat(filePath);
        fileLastDate = s.mtime.toISOString().slice(0, 10);
      } catch {
        // ignore — keep fileLastDate null
      }
    }

    recentEntries += fileRecentEntries;
    if (fileLastDate && (!lastEntryAt || fileLastDate > lastEntryAt)) {
      lastEntryAt = fileLastDate;
    }
    agentActivity.set(stem, {
      recent: fileRecentEntries,
      lastDate: fileLastDate,
    });
  }

  // Sort agents by recent activity desc, then by lastDate desc, then by
  // name. Cap surfaced names at 8 — beyond that the chip becomes unreadable
  // and file_count carries the long-tail signal.
  const agents = [...agentActivity.entries()]
    .sort((a, b) => {
      if (b[1].recent !== a[1].recent) return b[1].recent - a[1].recent;
      const ad = a[1].lastDate ?? "";
      const bd = b[1].lastDate ?? "";
      if (bd !== ad) return bd.localeCompare(ad);
      return a[0].localeCompare(b[0]);
    })
    .slice(0, 8)
    .map(([name]) => name);

  return {
    repo,
    file_count: mdFiles.length,
    agents,
    recent_entries: recentEntries,
    last_entry_at: lastEntryAt,
  };
}

/**
 * Convenience: build ComputeOptions from the loaded config. Keeps the API
 * layer thin and tests can pass options directly.
 */
export function buildJournalOptionsFromConfig(
  lookbackDays?: number,
): ComputeOptions {
  const cfg = loadConfig();
  return {
    lookbackDays,
    scanRoots: resolveScanRoots(cfg),
    trackedRepos: cfg.scan.tracked_repos,
    exclude: cfg.scan.exclude,
  };
}
