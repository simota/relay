"use client";

// Global "waiting for user" notifier.
//
// Polls /api/sessions across all CLI types and fires a browser Notification
// the moment a session transitions INTO `waiting_for_user`. Mounted once in
// AppShell so the alert fires regardless of which relay page the user has
// open. Designed to complement (not replace) the list-page blink indicator —
// the dot tells you "look at me" only when you're already looking; this
// hook covers the case where the relay tab is unfocused or backgrounded.
//
// Intentionally NOT using the Web Push API for v1: relay is local-first on
// 127.0.0.1, so VAPID / push subscription / service-worker infrastructure
// would be overkill for the (browser-tab-open) primary use case. A future
// upgrade can swap this hook's body for a Push API subscription without
// changing call sites.

import { useEffect, useRef } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { api, type SessionSummary } from "@/lib/api";

// 10 s lines up with the detector's 5 s idle threshold: a session enters
// waiting_for_user no sooner than 5 s after its last tool_use, so polling
// every 10 s catches the transition within one cycle while keeping the
// scan cost low.
const DEFAULT_POLL_MS = 10_000;

// Scan window for /api/sessions/scan-live. Anything older than this is not
// considered for transition detection — it would just be re-firing for
// stuck waiting sessions on every poll, which the seed-set already guards
// against but is wasteful work. 5 minutes is generous enough to cover
// sessions that briefly stalled.
const DEFAULT_SCAN_MIN = 5;

interface Options {
  pollMs?: number;
  enabled?: boolean;
  /**
   * Fired for every detected transition into `waiting_for_user`, regardless
   * of OS-level notification permission. AppShell uses this to drive an
   * in-app banner so the user sees the cue even when:
   *   - the relay tab is focused (browsers may suppress OS notifications)
   *   - Notification permission is `default` / `denied`
   *   - the browser does not support the Notification API at all
   * The OS-level Notification (when allowed) and this callback are
   * complementary — both fire so whichever surface the user is watching
   * shows the alert.
   */
  onWaitingTransition?: (session: SessionSummary) => void;
}

/**
 * Mount once at the app shell. Returns nothing — side-effect-only hook.
 *
 * Transition semantics:
 *   - First poll after mount seeds the "already known waiting" set without
 *     firing notifications. This avoids a notification storm every time the
 *     tab is reloaded with long-standing waiting sessions.
 *   - Subsequent polls compare the new waiting set against the seeded one.
 *     Any session newly in the waiting set fires exactly one Notification.
 *   - Sessions that leave the waiting set are dropped from the seen set, so
 *     a future re-entry will fire a fresh notification.
 *
 * Permission semantics:
 *   - When `Notification.permission !== 'granted'`, the hook still polls
 *     and tracks transitions (so flipping permission on later does not
 *     emit a backlog burst) but does not fire anything.
 */
export function useSessionWaitingNotifications(opts: Options = {}): void {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const enabled = opts.enabled !== false;
  const router = useRouter();
  const onWaitingTransition = opts.onWaitingTransition;

  // Stable ref so SWR's render-driven re-execution does not lose state
  // between polls. Set<"type:id"> of sessions whose `waiting_for_user`
  // state we have already observed (and either notified about or seeded
  // on mount). Removing a key from this set re-arms the notification for
  // that session's next transition.
  const seenWaitingRef = useRef<Set<string> | null>(null);

  // SSR / non-browser environments do not have the Notification global at
  // all. We still want the hook to be safe to call from a client component
  // — the guard inside the effect ensures we never touch `Notification`
  // outside the browser.
  const browserSupportsNotifications =
    typeof window !== "undefined" && "Notification" in window;

  // Poll regardless of OS notification support: the in-app banner callback
  // works even when the browser cannot show a Notification. We just want
  // to be in a real browser (not SSR) so the SWR fetch can run.
  const inBrowser = typeof window !== "undefined";

  const { data } = useSWR<SessionSummary[]>(
    enabled && inBrowser ? "/api/sessions/scan-live" : null,
    // /scan-live re-detects status live from the filesystem for Claude
    // sessions modified in the window (default 5 min). The plain list
    // endpoint serves DB-cached status that only updates on full sync,
    // so it would miss every transition that happened between syncs —
    // exactly the case this hook needs to catch. Codex/Gemini have no
    // detector yet and intentionally fall outside this scan.
    () => api.sessionsScanLive({ sinceMin: DEFAULT_SCAN_MIN }),
    {
      refreshInterval: pollMs,
      // Suspend polling while the tab is in the background-and-throttled
      // bucket is fine — modern browsers throttle setInterval to ~60s when
      // hidden, which is actually a feature here (less work when nobody is
      // watching), and the Notification fires on the next foreground poll
      // for any still-waiting session.
      revalidateOnFocus: true,
      // No need to revalidate on reconnect — the next interval tick will
      // catch up, and an immediate refire on every disconnect blip would
      // spam transitions if the server flapped.
      revalidateOnReconnect: false,
    },
  );

  useEffect(() => {
    if (!inBrowser) return;
    if (!data) return;

    const currentWaiting = new Set<string>();
    const lookup = new Map<string, SessionSummary>();
    for (const s of data) {
      if (s.status !== "waiting_for_user") continue;
      const key = `${s.type}:${s.id}`;
      currentWaiting.add(key);
      lookup.set(key, s);
    }

    // First-poll seeding: take a snapshot but do not fire. Notifications
    // start firing from the SECOND poll forward, when we have a true
    // before/after to diff.
    if (seenWaitingRef.current === null) {
      seenWaitingRef.current = currentWaiting;
      return;
    }

    const seen = seenWaitingRef.current;

    // Newly waiting → both surfaces fire (the in-app banner ALWAYS, and
    // the OS notification when permission allows). The two are
    // complementary: tab-focused users may not see the OS toast, and
    // users without permission see only the banner.
    for (const key of currentWaiting) {
      if (seen.has(key)) continue;
      const session = lookup.get(key);
      if (!session) continue;
      // In-app first — no permission gate, no browser-support gate.
      if (onWaitingTransition) onWaitingTransition(session);
      // OS notification — best effort. Permission check is deferred to
      // fire time so flipping the OS-level toggle takes effect on the
      // next transition without remounting.
      if (browserSupportsNotifications && Notification.permission === "granted") {
        fireWaitingNotification(session, router);
      }
    }

    // Replace seen set — sessions that left waiting are pruned, so a
    // future re-entry fires fresh.
    seenWaitingRef.current = currentWaiting;
  }, [data, router, browserSupportsNotifications, inBrowser, onWaitingTransition]);
}

function fireWaitingNotification(
  session: SessionSummary,
  router: ReturnType<typeof useRouter>,
): void {
  const repoLabel = session.repo ?? "—";
  const titleSnippet = truncate(session.title, 80);

  try {
    const n = new Notification("relay — waiting for user", {
      body: `${repoLabel} · ${titleSnippet}`,
      // `tag` collapses repeat notifications for the same session into a
      // single OS-level entry. If the user dismisses and the session goes
      // back to waiting later (re-arm via seen-set pruning above), a fresh
      // notification replaces the dismissed one rather than stacking.
      tag: `relay-waiting-${session.type}:${session.id}`,
      // Keep the notification on screen instead of auto-dismissing; the
      // whole point is to surface a request the user actively needs to
      // answer. Browsers honor this on Linux/Windows; macOS ignores it
      // (system-wide), which is acceptable.
      requireInteraction: true,
      icon: "/favicon.ico",
      data: { type: session.type, id: session.id },
    });

    n.onclick = (event) => {
      event.preventDefault();
      // Focus the relay tab if it is in the background. `window.focus()`
      // works for same-origin top-level windows; macOS/Chrome may still
      // require a user gesture for the OS-level app-switch, which clicking
      // the notification itself counts as.
      window.focus();
      router.push(
        `/sessions/detail?s=${session.type}:${encodeURIComponent(session.id)}`,
      );
      n.close();
    };
  } catch {
    // Notification constructor can throw if the page lost permission
    // mid-flight or the browser's notification quota is exhausted. Silent
    // catch — the blink UI still surfaces the waiting state on the list
    // page, so no escalation needed.
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
