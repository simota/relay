// Activity Calendar — bucketizes recent AI agent activity by local date
// so the /agenda surface can show "what happened" alongside "what's due".
//
// Two sources merge in here:
//   - Promise Ledger: sessions whose last assistant turn made claims that
//     no tool_call satisfied, AND no user follow-up came after. Bucketed
//     by the session's last_active date. These are "stale unfinished AI
//     work" — actionable: resume the session or abandon it.
//   - Agent journal: dated `## YYYY-MM-DD` headers inside `.agents/*.md`
//     journals. Informational: what agents wrote about that day.
//
// Both items normalize to ActivityItem so the API and UI handle one union
// type. The aggregator is bounded (MAX_SESSIONS_SCANNED, lookback days)
// and cached in-process so /agenda visits stay snappy.

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { RelayDB } from "../db/client.js";
import { getSession } from "../sessions/index.js";
import type { SessionType } from "../sessions/types.js";

export interface ActivityItemPromiseLedger {
  kind: "promise_ledger";
  /** Local date YYYY-MM-DD derived from session.last_active. */
  date: string;
  /** ISO timestamp of last_active (for tooltips, sort within a day). */
  ts: string;
  session: { type: SessionType; id: string };
  repo: string | null;
  /** Truncated session title. */
  title: string;
  /** Number of unmet claims in this session. */
  unmet_count: number;
}

export interface ActivityItemAgentJournal {
  kind: "agent_journal";
  /** Local date YYYY-MM-DD parsed from the `## YYYY-MM-DD` header. */
  date: string;
  /** Synthetic timestamp at midnight of `date` so sort within-day is stable. */
  ts: string;
  repo: string;
  /** Filename stem — e.g. "builder", "nexus". */
  agent: string;
  /** Header title text (after the date), trimmed and capped at 160. */
  title: string;
}

export type ActivityItem = ActivityItemPromiseLedger | ActivityItemAgentJournal;

export interface ActivityDay {
  /** Local YYYY-MM-DD. */
  date: string;
  /** Weekday short (Mon, Tue, …). */
  weekday: string;
  items: ActivityItem[];
}

interface CollectOptions {
  /** Inclusive lower bound (local date YYYY-MM-DD) for items to keep. */
  fromDate: string;
  /** Inclusive upper bound (local date YYYY-MM-DD). */
  toDate: string;
  /** Repo scan walker inputs (mirrors agents_note adapter). */
  scanRoots: string[];
  trackedRepos: string[];
  exclude: string[];
}

const MAX_SESSIONS_SCANNED = 100;
const CACHE_TTL_MS = 60_000;
// Header regex shared with repo-agent-journals; duplicated rather than
// imported to keep the two modules independently mockable in tests.
const DATE_HEADER_RE = /^##\s+(\d{4}-\d{2}-\d{2})\b\s*(.*)$/gm;

interface CacheEntry {
  computedAt: number;
  cacheKey: string;
  items: ActivityItem[];
}

let cache: CacheEntry | null = null;

export function resetActivityCalendarCacheForTests(): void {
  cache = null;
}

/**
 * Collect all activity items whose `date` falls in [fromDate, toDate].
 * Returns a flat list — caller groups by date for rendering.
 */
export async function collectActivityInWindow(
  db: RelayDB,
  opts: CollectOptions,
): Promise<ActivityItem[]> {
  const cacheKey = `${opts.fromDate}|${opts.toDate}|${opts.scanRoots.join(",")}|${opts.trackedRepos.join(",")}`;
  const now = Date.now();
  if (cache && cache.cacheKey === cacheKey && now - cache.computedAt < CACHE_TTL_MS) {
    return cache.items;
  }

  const items: ActivityItem[] = [];
  // Run both sources in parallel — they don't share state.
  const [ledger, journals] = await Promise.all([
    collectPromiseLedgerActivity(db, opts),
    collectAgentJournalActivity(opts),
  ]);
  items.push(...ledger, ...journals);

  cache = { computedAt: now, cacheKey, items };
  return items;
}

async function collectPromiseLedgerActivity(
  db: RelayDB,
  opts: CollectOptions,
): Promise<ActivityItemPromiseLedger[]> {
  // We need to read sessions whose last_active falls in the window. The DB
  // call wants an ISO bound, so synthesize one at local-midnight of fromDate.
  const sinceIso = new Date(`${opts.fromDate}T00:00:00`).toISOString();
  const untilIso = new Date(`${opts.toDate}T23:59:59.999`).toISOString();

  // Resolve scan roots into the form fs readers need — getSession accepts
  // an array of scan.roots strings (raw, not expanded).
  const roots = opts.scanRoots;

  const rows = db.getSessions({
    sinceLastActive: sinceIso,
    limit: MAX_SESSIONS_SCANNED,
    includeSubagents: false,
  });

  const out: ActivityItemPromiseLedger[] = [];
  for (const row of rows) {
    if (!row.repo) continue;
    if (row.last_active > untilIso) continue;
    if (row.type === "cursor") continue;

    let detail;
    try {
      detail = await getSession(row.type, row.id, roots, {
        promiseLedger: true,
      });
    } catch {
      continue;
    }
    if (!detail || !detail.promise_ledger) continue;
    if (detail.promise_ledger.unmet === 0) continue;
    // Mirror the "abandoned mid-task" rule used elsewhere: only count
    // sessions whose last message is from the assistant (no user follow-up).
    const lastMsg = detail.messages[detail.messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") continue;

    const date = ymdLocalFromIso(row.last_active);
    if (date < opts.fromDate || date > opts.toDate) continue;

    out.push({
      kind: "promise_ledger",
      date,
      ts: row.last_active,
      session: { type: row.type, id: row.id },
      repo: row.repo,
      title: row.title ?? detail.title ?? "(no prompt)",
      unmet_count: detail.promise_ledger.unmet,
    });
  }
  return out;
}

async function collectAgentJournalActivity(
  opts: CollectOptions,
): Promise<ActivityItemAgentJournal[]> {
  const out: ActivityItemAgentJournal[] = [];
  const seenRepoPaths = new Set<string>();

  for (const root of opts.scanRoots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || opts.exclude.includes(entry.name)) continue;
      const repoPath = join(root, entry.name);
      seenRepoPaths.add(repoPath);
      await scanRepoJournals(entry.name, repoPath, opts.fromDate, opts.toDate, out);
    }
  }

  for (const absPath of opts.trackedRepos) {
    if (seenRepoPaths.has(absPath)) continue;
    await scanRepoJournals(basename(absPath), absPath, opts.fromDate, opts.toDate, out);
  }

  return out;
}

async function scanRepoJournals(
  repo: string,
  repoPath: string,
  fromDate: string,
  toDate: string,
  out: ActivityItemAgentJournal[],
): Promise<void> {
  const agentsDir = join(repoPath, ".agents");
  const dirStat = await stat(agentsDir).catch(() => null);
  if (!dirStat?.isDirectory()) return;

  const files = await readdir(agentsDir, { withFileTypes: true }).catch(() => []);
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".md")) continue;
    const stem = file.name.replace(/\.md$/i, "");
    const filePath = join(agentsDir, file.name);

    let text: string;
    try {
      text = await readFile(filePath, "utf8");
    } catch {
      continue;
    }

    for (const m of text.matchAll(DATE_HEADER_RE)) {
      const date = m[1];
      const rawTitle = (m[2] ?? "").trim();
      if (!date) continue;
      if (date < fromDate || date > toDate) continue;
      // Strip the conventional "— " / "- " prefix many agents put between
      // the date and the title so the rendered row is cleaner.
      const title = rawTitle.replace(/^[—\-:·]\s*/, "").trim();
      out.push({
        kind: "agent_journal",
        date,
        // Synthetic midnight so the row sorts before timed promise_ledger
        // entries on the same day (journals are written for the whole day).
        ts: `${date}T00:00:00.000Z`,
        repo,
        agent: stem,
        title: title ? truncate(title, 160) : `(${stem} journal entry)`,
      });
    }
  }
}

/**
 * Bucket a flat ActivityItem[] into N days (newest first). Caller supplies
 * the calendar day metadata so server-side weekday formatting can match
 * the existing agenda surface conventions.
 */
export function bucketByDate(
  items: readonly ActivityItem[],
  days: readonly { date: string; weekday: string }[],
): ActivityDay[] {
  const buckets = new Map<string, ActivityItem[]>();
  for (const d of days) buckets.set(d.date, []);
  for (const it of items) {
    const b = buckets.get(it.date);
    if (b) b.push(it);
  }
  // Within a day: newest ts first; promise_ledger before agent_journal at
  // identical ts (since journals use synthetic midnight).
  for (const arr of buckets.values()) {
    arr.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
  }
  return days.map((d) => ({
    date: d.date,
    weekday: d.weekday,
    items: buckets.get(d.date) ?? [],
  }));
}

// Helpers ------------------------------------------------------------------

function ymdLocalFromIso(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
