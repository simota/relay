import { spawn, spawnSync } from "node:child_process";
import type { Adapter, AdapterContext, ResolvedSource, TaskInput } from "../types.js";

// GitHub notifications has many `reason` values (subscribed, comment, author,
// team_mention, ...). We only ingest the five the user explicitly asked for
// — review-request / mention / assign / ci_activity / state_change. Everything
// else is dropped so the inbox stays focused on actionable items.
const ACTIONABLE_REASONS = new Set([
  "review_requested",
  "mention",
  "assign",
  "ci_activity",
  "state_change",
]);

// Priority by reason. CI failure first (red-build > everything), then review
// request, then mention, then the misc actionable bucket.
const PRIORITY_BY_REASON: Record<string, number> = {
  ci_activity: 70,
  review_requested: 60,
  mention: 55,
  assign: 50,
  state_change: 50,
};

// `gh api notifications` can return tens of thousands of threads on a heavily
// subscribed account; we bound the sweep to a 30-day window to keep `relay
// sync` snappy. Threads older than this typically aren't actionable anyway —
// if they were, they'd have triggered a follow-up notification within 30 days.
const NOTIFICATION_LOOKBACK_DAYS = 30;

// fetchResolved horizon: a thread is treated as resolved once it's been read
// AND hasn't moved in a week. The 7-day grace prevents auto-closing tasks that
// the user happened to open in the GitHub UI but hasn't actually addressed.
const RESOLVED_AFTER_DAYS = 7;

// `subject.url` for issues/PRs/commits looks like
//   https://api.github.com/repos/<owner>/<repo>/<kind>/<number>
// We pull just `<repo>` to stay consistent with the existing `github_issue` /
// `github_pr` adapter, which also stores bare repo names.
const REPO_FROM_SUBJECT_URL = /\/repos\/[^/]+\/([^/]+)/;

export const ghNotificationAdapter: Adapter = {
  name: "gh_notification",

  precheck(): { skip: true; reason: string } | null {
    // `gh auth status` exits 0 when the active account has a valid token.
    // Reuse the existing gh login rather than asking the user to configure a
    // second secret. We accept the same "user is logged in" signal that
    // `gh search` would, so a working `relay sync github` implies this
    // adapter can also run.
    const res = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
    if (res.error || res.status !== 0) {
      return { skip: true, reason: "gh CLI not authenticated" };
    }
    return null;
  },

  async fetch(ctx: AdapterContext): Promise<TaskInput[]> {
    const rows = await fetchNotifications(ctx);
    const tasks: TaskInput[] = [];
    for (const row of rows) {
      const task = rowToTask(row);
      if (task) tasks.push(task);
    }
    return tasks;
  },

  // Resolved sweep: a thread is auto-closed once GitHub marks it read AND it
  // has gone quiet for 7 days. Closing earlier risks re-surfacing the same
  // task if the user only briefly clicked into the thread. We restrict to
  // actionable reasons so the resolved set mirrors what `fetch` could have
  // produced — non-actionable threads never become tasks, so emitting them
  // here would just be noise for `closeTasksBySourceIds`.
  async fetchResolved(ctx: AdapterContext): Promise<ResolvedSource[]> {
    const rows = await fetchNotifications(ctx);
    const cutoff = Date.now() - RESOLVED_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const resolved: ResolvedSource[] = [];
    for (const row of rows) {
      if (!ACTIONABLE_REASONS.has(row.reason)) continue;
      if (row.unread === false && Date.parse(row.updated_at ?? "") <= cutoff) {
        resolved.push({
          source_type: "gh_notification",
          source_id: sourceIdFor(row.id),
        });
      }
    }
    return resolved;
  },
};

interface NotificationRow {
  id: string;
  reason: string;
  unread: boolean;
  updated_at: string;
  subject?: {
    title?: string;
    url?: string;
    type?: string;
  };
  repository?: {
    name?: string;
    full_name?: string;
  };
}

function sourceIdFor(id: string): string {
  return `gh:notification:${id}`;
}

function rowToTask(row: NotificationRow): TaskInput | null {
  // Drop notifications whose `reason` isn't in the actionable set. This is
  // the main signal-to-noise filter — `subscribed` / `comment` / `author`
  // chatter never reaches the inbox.
  if (!ACTIONABLE_REASONS.has(row.reason)) return null;

  // Prefer repository.name (the API always returns it), fall back to parsing
  // subject.url for safety. Both reduce to the bare repo name, matching the
  // existing github_issue / github_pr adapter convention.
  const repo = row.repository?.name ?? extractRepoFromSubjectUrl(row.subject?.url);
  if (!repo) return null;

  const subjectTitle = row.subject?.title ?? "(no title)";
  const subjectUrl = row.subject?.url ?? "";

  return {
    source_type: "gh_notification",
    source_id: sourceIdFor(row.id),
    repo,
    title: `[${row.reason}] ${subjectTitle}`,
    // Intentionally minimal: just the API URL so the task is traceable. The
    // notification body itself (comment text, CI failure details) is left
    // unfetched — opt-in body retrieval is tracked as a future enhancement.
    body: subjectUrl,
    status: "open",
    assignee: "self",
    priority: PRIORITY_BY_REASON[row.reason] ?? 50,
    prompt: null,
    files: [],
    context_hash: null,
    session_id: null,
    due_at: null,
    // Notifications always represent something the user has to look at; if
    // they didn't, GitHub wouldn't have generated the thread.
    wait_on: "self",
  };
}

function extractRepoFromSubjectUrl(url: string | undefined): string | null {
  if (!url) return null;
  const m = REPO_FROM_SUBJECT_URL.exec(url);
  return m && m[1] ? m[1] : null;
}

// `fetchNotifications` is called twice per sync — once from `fetch()` and once
// from `fetchResolved()` — and the GitHub API response is identical between
// the two calls. Memoize for 60s so the second call reuses the first within a
// sync, but expires well before the next daemon sync (`daemon.interval_sec`
// defaults to 300s).
const NOTIFICATIONS_CACHE_TTL_MS = 60_000;
let notificationsCache: { at: number; promise: Promise<NotificationRow[]> } | null = null;

async function fetchNotifications(ctx: AdapterContext): Promise<NotificationRow[]> {
  const now = Date.now();
  if (notificationsCache && now - notificationsCache.at < NOTIFICATIONS_CACHE_TTL_MS) {
    return notificationsCache.promise;
  }

  // `since` bounds the sweep so heavily subscribed accounts don't pay for a
  // full inbox dump every sync. The actionable-reason filter is applied
  // client-side because the API doesn't accept a reason filter.
  const since = new Date(
    now - NOTIFICATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const args = [
    "api",
    "--paginate",
    `notifications?per_page=100&all=true&since=${encodeURIComponent(since)}`,
  ];
  const promise = ghApiJson(args).catch((e: unknown) => {
    // Reset cache on failure so the next call retries against a fresh API.
    if (notificationsCache?.promise === promise) notificationsCache = null;
    const msg = e instanceof Error ? e.message : String(e);
    ctx.log?.(`gh_notification: fetch failed (${msg})`);
    throw e;
  });

  notificationsCache = { at: now, promise };
  return promise;
}

// Run `gh api ...` and parse stdout as JSON. `gh api --paginate` concatenates
// pages into a single JSON array on stdout, so a single JSON.parse works.
function ghApiJson(args: string[]): Promise<NotificationRow[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`gh exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) {
          reject(new Error("gh api notifications: expected array response"));
          return;
        }
        resolve(parsed as NotificationRow[]);
      } catch (e) {
        reject(e);
      }
    });
  });
}
