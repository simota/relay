"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { api, type SessionSummary, type SessionType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NotificationPermissionButton } from "@/components/notification-permission-button";
import { PageState } from "@/components/page-state";
import { SessionTitle } from "@/components/session-title";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";

const TYPE_FILTERS: ReadonlyArray<{ value: SessionType | "all"; label: string }> = [
  { value: "all", label: "all" },
  { value: "claude", label: "claude" },
  { value: "codex", label: "codex" },
  { value: "antigravity", label: "antigravity" },
];

const LOOKBACK_OPTIONS = [
  { value: 7, label: "7d" },
  { value: 30, label: "30d" },
  { value: 90, label: "90d" },
];

const MAX_TILES = 6;

// A session whose last_active is within this window is shown as "active"
// — the CLI is still writing to the file, so the user can plausibly resume.
const ACTIVE_THRESHOLD_MS = 2 * 60_000;

function isActiveSession(iso: string, nowMs: number): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return nowMs - t < ACTIVE_THRESHOLD_MS;
}

function buildTilesUrl(sessions: SessionSummary[]): string {
  const parts = sessions
    .slice(0, MAX_TILES)
    .map((s) => `s=${s.type}:${encodeURIComponent(s.id)}`)
    .join("&");
  return `/sessions/detail?${parts}`;
}

export default function SessionsPage() {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<SessionType | "all">("all");
  const [lookback, setLookback] = useState<number>(30);
  const [filter, setFilter] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSubagents, setShowSubagents] = useState(false);

  // Re-render every 10s so the active badge / count stays in sync without
  // waiting for the next SWR refresh.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const key = `/api/sessions?type=${typeFilter}&lookback=${lookback}&subagents=${showSubagents}`;
  const { data: sessions = [], isLoading } = useSWR<SessionSummary[]>(
    key,
    () =>
      api.sessions({
        type: typeFilter === "all" ? undefined : typeFilter,
        lookbackDays: lookback,
        limit: 200,
        includeSubagents: showSubagents,
      }),
    // Refresh more often so newly opened sessions surface quickly.
    { refreshInterval: 15_000 },
  );

  const activeCount = useMemo(
    () => sessions.filter((s) => isActiveSession(s.last_active, nowMs)).length,
    [sessions, nowMs],
  );

  const waitingCount = useMemo(
    () => sessions.filter((s) => s.status === "waiting_for_user").length,
    [sessions],
  );
  const [waitingOnly, setWaitingOnly] = useState(false);

  // Streaming-now detection (Option A): track each session's last_active
  // and message_count across polls; a row that advanced its last_active
  // since the previous render is "actively producing" right now. This is
  // strictly client-side (no backend change) and provides a sharper signal
  // than the 5-second server-side `active` window for the moment of a fresh
  // write. Persists for one poll cycle (~15s) then auto-clears unless the
  // session keeps advancing.
  const prevPollRef = useRef<Map<string, { last_active: string; message_count: number }>>(
    new Map(),
  );
  const streamingDeltas = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of sessions) {
      const key = `${s.type}:${s.id}`;
      const prev = prevPollRef.current.get(key);
      if (prev && prev.last_active !== s.last_active) {
        const delta = s.message_count - prev.message_count;
        // `delta > 0` is the meaningful case. A negative delta only
        // happens when the parser revises message_count downward (rare,
        // e.g. file truncated); ignore those — no UI signal warranted.
        if (delta > 0) out.set(key, delta);
      }
    }
    return out;
  }, [sessions]);
  useEffect(() => {
    // Defer the ref update so the next poll's useMemo reads the previous
    // values. Done in useEffect (not inside the useMemo) so StrictMode's
    // double-invoke in dev does not eat the delta.
    for (const s of sessions) {
      const key = `${s.type}:${s.id}`;
      prevPollRef.current.set(key, {
        last_active: s.last_active,
        message_count: s.message_count,
      });
    }
  }, [sessions]);

  const filtered = useMemo(() => {
    let rows = sessions;
    if (activeOnly) rows = rows.filter((s) => isActiveSession(s.last_active, nowMs));
    if (waitingOnly) rows = rows.filter((s) => s.status === "waiting_for_user");
    if (filter.trim()) {
      const q = filter.toLowerCase();
      rows = rows.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.repo?.toLowerCase().includes(q) ?? false) ||
          (s.cwd?.toLowerCase().includes(q) ?? false),
      );
    }

    if (showSubagents) {
      // Interleave subagents directly below their parent rows.
      // Parents (no parent_session_id) are sorted by last_active desc (already done by API).
      // For each parent, insert its subagents immediately after.
      const parents = rows.filter((s) => !s.parent_session_id);
      const subagentsByParent = new Map<string, SessionSummary[]>();
      for (const s of rows) {
        if (s.parent_session_id) {
          const arr = subagentsByParent.get(s.parent_session_id) ?? [];
          arr.push(s);
          subagentsByParent.set(s.parent_session_id, arr);
        }
      }
      const reordered: SessionSummary[] = [];
      const placed = new Set<string>();
      for (const parent of parents) {
        reordered.push(parent);
        placed.add(`${parent.type}:${parent.id}`);
        const children = subagentsByParent.get(parent.id) ?? [];
        for (const child of children) {
          reordered.push(child);
          placed.add(`${child.type}:${child.id}`);
        }
      }
      // Append orphan subagents (parent not in current filtered list) at the end.
      for (const s of rows) {
        if (!placed.has(`${s.type}:${s.id}`)) reordered.push(s);
      }
      return reordered;
    }

    return rows;
  }, [sessions, filter, activeOnly, waitingOnly, nowMs, showSubagents]);

  // Build a lookup map from key → SessionSummary for the "Open as tiles" button.
  const sessionByKey = useMemo(() => {
    const m = new Map<string, SessionSummary>();
    for (const s of sessions) m.set(`${s.type}:${s.id}`, s);
    return m;
  }, [sessions]);

  const selectedSessions = useMemo<SessionSummary[]>(() => {
    const result: SessionSummary[] = [];
    for (const key of selected) {
      const s = sessionByKey.get(key);
      if (s) result.push(s);
    }
    return result;
  }, [selected, sessionByKey]);

  const selectionCount = selectedSessions.length;
  const selectionOverLimit = selectionCount > MAX_TILES;

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const openAsTiles = () => {
    if (selectionCount === 0 || selectionOverLimit) return;
    router.push(buildTilesUrl(selectedSessions));
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-6 space-y-5 max-w-[1400px]">
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">{c("sessions.title")}</h1>
            <p className="text-[12px] text-[var(--color-fg-muted)] mt-0.5 flex items-center gap-2">
              <span>
                {formatNumber(sessions.length)} sessions · lookback {lookback}d
              </span>
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveOnly((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-[var(--radius-sm)] border text-[11px] transition-colors",
                    activeOnly
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                  )}
                  aria-pressed={activeOnly}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                  {formatNumber(activeCount)} active
                </button>
              )}
              {waitingCount > 0 && (
                <button
                  type="button"
                  onClick={() => setWaitingOnly((v) => !v)}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-[var(--radius-sm)] border text-[11px] transition-colors",
                    waitingOnly
                      ? "border-[var(--color-warm)] text-[var(--color-warm)]"
                      : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                  )}
                  aria-pressed={waitingOnly}
                  title="Sessions waiting on a user decision (permission prompt, AskUserQuestion, unanswered tool_use)"
                >
                  <span className="relay-attention w-1.5 h-1.5 rounded-full" />
                  {formatNumber(waitingCount)} waiting
                </button>
              )}
              <NotificationPermissionButton />
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Open as tiles button — visible when ≥1 session checked */}
            {selectionCount > 0 && (
              <button
                type="button"
                onClick={openAsTiles}
                disabled={selectionOverLimit}
                title={
                  selectionOverLimit
                    ? `Max ${MAX_TILES} tiles — deselect some sessions`
                    : `Open ${selectionCount} session${selectionCount !== 1 ? "s" : ""} as tiles`
                }
                className={cn(
                  "h-7 px-3 text-[12px] font-mono rounded-[var(--radius)] border transition-colors",
                  selectionOverLimit
                    ? "border-[var(--color-border)] text-[var(--color-fg-dim)] cursor-not-allowed opacity-50"
                    : "border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10",
                )}
              >
                Open {selectionCount} as tiles
              </button>
            )}
            <div className="flex rounded-[var(--radius)] border border-[var(--color-border)] p-0.5">
              {TYPE_FILTERS.map((t) => (
                <Button
                  key={t.value}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setTypeFilter(t.value)}
                  aria-pressed={typeFilter === t.value}
                  className={cn(
                    "h-6 px-2 rounded-[var(--radius-sm)] font-mono text-[11px]",
                    typeFilter === t.value && "bg-[var(--color-bg-elev)] text-[var(--color-fg)]",
                  )}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            <div className="flex rounded-[var(--radius)] border border-[var(--color-border)] p-0.5">
              {LOOKBACK_OPTIONS.map((opt) => (
                <Button
                  key={opt.value}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setLookback(opt.value)}
                  aria-pressed={lookback === opt.value}
                  className={cn(
                    "h-6 px-2 rounded-[var(--radius-sm)] font-mono text-[11px]",
                    lookback === opt.value && "bg-[var(--color-bg-elev)] text-[var(--color-fg)]",
                  )}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--color-fg-muted)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showSubagents}
                onChange={(e) => setShowSubagents(e.target.checked)}
                className="w-3.5 h-3.5 accent-[var(--color-accent)]"
              />
              subagents
            </label>
            <Input
              placeholder={c("sessions.filter")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-[240px] font-mono"
            />
          </div>
        </div>

        {isLoading && (
          <div className="text-[13px] text-[var(--color-fg-dim)] text-center py-12">
            {c("common.loading")}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <PageState
            variant="empty"
            title={
              sessions.length === 0
                ? c("page.sessions.emptyTitle")
                : c("sessions.noMatch", { filter })
            }
            hint={
              sessions.length === 0
                ? c("page.sessions.emptyHint")
                : c("page.tasks.emptyHint")
            }
          />
        )}

        {filtered.length > 0 && (
          <div className="rounded-[var(--radius)] border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-[var(--color-bg-elev)] text-[var(--color-fg-muted)]">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium w-[36px]" aria-label="select" />
                  <th className="px-3 py-2 font-medium w-[22px]" aria-label="live indicator" />
                  <th className="px-3 py-2 font-medium w-[70px]">type</th>
                  <th className="px-3 py-2 font-medium w-[150px]">repo</th>
                  <th className="px-3 py-2 font-medium">title</th>
                  <th className="px-3 py-2 font-medium tabular text-right w-[70px]">msgs</th>
                  <th className="px-3 py-2 font-medium tabular text-right w-[70px]">todos</th>
                  <th className="px-3 py-2 font-medium tabular text-right w-[100px]">
                    last active
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const key = `${s.type}:${s.id}`;
                  return (
                    <SessionRow
                      key={key}
                      session={s}
                      nowMs={nowMs}
                      checked={selected.has(key)}
                      onToggle={() => toggleSelect(key)}
                      isSubagent={!!s.parent_session_id}
                      streamingDelta={streamingDeltas.get(key)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionRow({
  session: s,
  nowMs,
  checked,
  onToggle,
  isSubagent,
  streamingDelta,
}: {
  session: SessionSummary;
  nowMs: number;
  checked: boolean;
  onToggle: () => void;
  isSubagent: boolean;
  streamingDelta?: number;
}) {
  const active = isActiveSession(s.last_active, nowMs);
  const waiting = s.status === "waiting_for_user";
  // Server detector classifies the conversation as cleanly finished
  // (assistant's last turn had stop_reason: end_turn, no events after).
  // Distinct from `idle` which means "no signal".
  const ended = s.status === "ended";
  // Server-side "active" is tighter (5s window) than the client-side
  // 2-minute heuristic — strong signal that the CLI is producing now.
  const serverActive = s.status === "active";
  // Streaming = mtime/message_count advanced between polls. Subset of
  // active but actually observed during this poll cycle.
  const streaming = (streamingDelta ?? 0) > 0;
  return (
    <tr
      className={cn(
        "border-t border-[var(--color-border)] hover:bg-[var(--color-bg-elev)] transition-colors",
        active && "bg-[var(--color-bg-elev)]/40",
        // Waiting wins over active for row tint — the user needs to spot
        // these even when scanning a long list.
        waiting && "bg-[color-mix(in_oklch,var(--color-warm)_8%,transparent)]",
        checked && "bg-[var(--color-accent)]/5",
        isSubagent && "opacity-90",
      )}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={`Select ${s.title}`}
          className="w-3.5 h-3.5 accent-[var(--color-accent)] cursor-pointer"
        />
      </td>
      <td className="px-3 py-2">
        {waiting ? (
          // Waiting takes priority over everything — both can be true
          // (the file is fresh AND a tool_use is pending), but the user
          // needs to act on this one, so we surface the warmer signal.
          <span
            className="relay-attention inline-block w-2 h-2 rounded-full"
            title="waiting for user input (permission prompt or unanswered tool_use)"
            aria-label="waiting for user input"
          />
        ) : streaming ? (
          // Brightest signal: the file actually advanced during the
          // current poll window. Uses the strong-pulse keyframe so it
          // visibly out-pulses the static "active" dot.
          <span
            className="relay-pulse-strong inline-block w-2 h-2 rounded-full bg-[var(--color-accent)]"
            title={`streaming now (+${streamingDelta} since last poll)`}
            aria-label="streaming now"
          />
        ) : serverActive ? (
          <span
            className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse"
            title="active (writes within 5 s)"
            aria-label="active"
          />
        ) : active ? (
          <span
            className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)]/70"
            title="recently active (writes within 2 min)"
            aria-label="recently active"
          />
        ) : ended ? (
          // Distinct from blank: tells the user the conversation finished
          // cleanly (assistant end_turn) rather than just having no signal.
          <span
            className="inline-block w-2 text-[10px] leading-none text-[var(--color-fg-dim)] text-center"
            title="ended (assistant turn finished cleanly)"
            aria-label="ended"
          >
            ✓
          </span>
        ) : (
          <span className="inline-block w-2 h-2" aria-hidden />
        )}
      </td>
      <td className="px-3 py-2">
        <TypeBadge type={s.type} />
      </td>
      <td className="px-3 py-2 font-mono text-[var(--color-fg)]">
        {s.repo ?? <span className="text-[var(--color-fg-dim)]">—</span>}
      </td>
      <td className="px-3 py-2">
        <div className="flex items-baseline">
          {isSubagent && (
            <span className="mr-1.5 text-[var(--color-fg-dim)] font-mono text-[10px]">└─</span>
          )}
          <Link
            href={`/sessions/detail?s=${s.type}:${encodeURIComponent(s.id)}`}
            className="text-[var(--color-fg)] hover:text-[var(--color-accent)] hover:underline"
          >
            {s.title}
          </Link>
          {!isSubagent && (s.subagent_count ?? 0) > 0 && (
            <span className="ml-2 text-[10px] font-mono text-[var(--color-fg-dim)] opacity-70">
              +{s.subagent_count} sub
            </span>
          )}
        </div>
        {s.last_message && (
          <div
            className="mt-0.5 text-[11px] text-[var(--color-fg-dim)] truncate max-w-[640px]"
            title={s.last_message}
          >
            <SessionTitle raw={s.last_message} />
          </div>
        )}
      </td>
      <td className="px-3 py-2 tabular text-right text-[var(--color-fg-muted)]">
        {formatNumber(s.message_count)}
        {streaming && (
          // Transient delta badge — only renders while streamingDelta > 0
          // (one poll cycle, ~15 s). Gives a precise readout next to the
          // pulsing dot so the user can tell "1 new line" from "100 new
          // lines" at a glance without opening the detail tile.
          <span
            className="ml-1 text-[10px] font-mono text-[var(--color-accent)]"
            title={`+${streamingDelta} since last poll`}
          >
            +{streamingDelta}
          </span>
        )}
      </td>
      <td className="px-3 py-2 tabular text-right text-[var(--color-fg-muted)]">
        {s.todos_count > 0 ? (
          formatNumber(s.todos_count)
        ) : (
          <span className="text-[var(--color-fg-dim)]">—</span>
        )}
      </td>
      <td className="px-3 py-2 tabular text-right text-[var(--color-fg-dim)] text-[11px]">
        {formatAge(s.last_active)}
      </td>
    </tr>
  );
}

function TypeBadge({ type }: { type: SessionType }) {
  const color = {
    claude: "var(--color-accent)",
    codex: "var(--color-cool)",
    antigravity: "var(--color-warn, var(--color-fg))",
  }[type];
  return (
    <span
      className="font-mono text-[10.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-[var(--radius-sm)] border"
      style={{ color, borderColor: "var(--color-border)" }}
    >
      {type}
    </span>
  );
}

function formatAge(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "?";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
