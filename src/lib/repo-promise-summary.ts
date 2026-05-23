// Per-repo Promise Ledger aggregation — finds repos where an AI session
// was left mid-task with unfulfilled claims, and surfaces them on the
// /repos screen as "Unfinished Business".
//
// The "abandoned mid-task" signal is the killer: a session whose last
// assistant turn carried a claim that no tool_call satisfied AND no user
// message followed (so the user never came back to course-correct). That
// is the specific pain — not "any unmet claim ever" — and it is what
// converts /repos from an inventory grid into a daily resumption ritual.
//
// Implementation notes:
//
//   - Sessions are pulled from the DB index (fast); per-session Promise
//     Ledger is computed by re-reading the JSONL via the existing fs
//     readers (slow). The cost is bounded by `MAX_SESSIONS_SCANNED` and
//     `lookbackDays`, then cached in-process for `CACHE_TTL_MS`.
//   - Caller gates on `cfg.features.promise_ledger`; this module always
//     computes when invoked. The API layer is where the flag check lives,
//     so the aggregator stays pure.
//   - One summary per repo (the most-recent unfinished session). A repo
//     with N unfinished sessions still shows one card in the lane; the
//     `total_unfinished_sessions` field surfaces the multiplicity.

import { RelayDB } from "../db/client.js";
import { getSession } from "../sessions/index.js";
import type { SessionType } from "../sessions/types.js";
import { extractPromiseLedger } from "./promise-ledger.js";

export interface RepoPromiseSummary {
  /** Repo slug (e.g. "luna-sns"). Excludes sessions with null repo. */
  repo: string;
  /** The most-recent unfinished session for this repo. */
  last_session: {
    type: SessionType;
    id: string;
    /** Truncated title from the session — surfaced on the card. */
    title: string;
    /** ISO timestamp of the session's last activity. */
    last_active: string;
    /** Number of unmet claims in this session alone. */
    unmet_count: number;
    /** Number of vague (unverifiable) claims. Surfaced as a softer signal. */
    unverifiable_count: number;
  };
  /** Sum of unmet claims across all unfinished sessions in this repo. */
  total_unmet: number;
  /** Number of unfinished sessions in this repo (>= 1). */
  total_unfinished_sessions: number;
}

interface ComputeOptions {
  lookbackDays?: number;
  /** Hard cap on JSONL reads per invocation; protects against fleet-scale repos. */
  maxSessionsScanned?: number;
  roots: string[];
}

const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_MAX_SESSIONS = 100;
const CACHE_TTL_MS = 60_000;
// One day in ms — for the lookback cutoff math.
const DAY_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  computedAt: number;
  cacheKey: string;
  summaries: RepoPromiseSummary[];
}

let cache: CacheEntry | null = null;

export function resetRepoPromiseSummaryCacheForTests(): void {
  cache = null;
}

export async function computeRepoPromiseSummaries(
  db: RelayDB,
  opts: ComputeOptions,
): Promise<RepoPromiseSummary[]> {
  const lookback = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const maxSessions = opts.maxSessionsScanned ?? DEFAULT_MAX_SESSIONS;
  const cacheKey = `${lookback}|${maxSessions}|${opts.roots.join(",")}`;
  const now = Date.now();
  if (cache && cache.cacheKey === cacheKey && now - cache.computedAt < CACHE_TTL_MS) {
    return cache.summaries;
  }

  const sinceIso = new Date(now - lookback * DAY_MS).toISOString();
  // Top-N most-recent sessions in the window with a non-null repo. We
  // ignore subagent sessions (parent_session_id IS NULL) because their
  // "abandoned mid-task" signal lives on the parent; counting a subagent
  // separately would double-attribute the same unfinished work.
  const rows = db.getSessions({
    sinceLastActive: sinceIso,
    limit: maxSessions,
    includeSubagents: false,
  });

  // Aggregate one summary per repo: keep only the most-recent unfinished
  // session per repo (sessions are returned last_active DESC, so the first
  // match per repo wins by definition).
  const byRepo = new Map<string, RepoPromiseSummary>();

  for (const row of rows) {
    if (!row.repo) continue;
    // Cursor sessions have no fs reader (`getSession` returns null for
    // them); skip without paying the IO.
    if (row.type === "cursor") continue;

    let detail;
    try {
      detail = await getSession(row.type, row.id, opts.roots, {
        promiseLedger: true,
      });
    } catch {
      continue;
    }
    if (!detail || !detail.promise_ledger) continue;

    // "Abandoned mid-task" = the last message is from the assistant AND
    // the session has at least one unmet claim. A user follow-up after
    // the assistant's claim means the user already responded — not the
    // pain we surface.
    const lastMsg = detail.messages[detail.messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") continue;
    const ledger = detail.promise_ledger;
    if (ledger.unmet === 0) continue;

    const existing = byRepo.get(row.repo);
    if (existing) {
      existing.total_unmet += ledger.unmet;
      existing.total_unfinished_sessions += 1;
    } else {
      byRepo.set(row.repo, {
        repo: row.repo,
        last_session: {
          type: row.type,
          id: row.id,
          title: row.title ?? detail.title ?? "(no prompt)",
          last_active: row.last_active,
          unmet_count: ledger.unmet,
          unverifiable_count: ledger.unverifiable,
        },
        total_unmet: ledger.unmet,
        total_unfinished_sessions: 1,
      });
    }
  }

  // Sort: most unmet first, ties broken by most-recent.
  const summaries = [...byRepo.values()].sort((a, b) => {
    if (b.total_unmet !== a.total_unmet) return b.total_unmet - a.total_unmet;
    return b.last_session.last_active.localeCompare(a.last_session.last_active);
  });

  cache = { computedAt: now, cacheKey, summaries };
  return summaries;
}
