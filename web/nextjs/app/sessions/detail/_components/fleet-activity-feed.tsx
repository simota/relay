"use client";

import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Settings,
  Sparkles,
  User,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useSessionDetails } from "../_hooks/use-session-details";
import {
  buildDetailEvents,
  buildFeedRows,
  buildHueMap,
  buildSonarEntries,
  dateBucketKey,
  dateBucketLabel,
  type FeedRow,
  type FleetEvent,
  type FleetEventKind,
  formatRelative,
  formatSilence,
  hueForSession,
  silenceMedian,
  type SonarEntry,
} from "../_lib/fleet-activity";
import { sessionKey, statusColor } from "../_lib/fleet-timeline";
import type { TileSpec } from "../_types";
import type { FleetViewData } from "./fleet-view";

const KIND_FILTERS: ReadonlyArray<FleetEventKind | "all"> = [
  "all",
  "user",
  "assistant",
  "tool",
  "waiting",
  "ended",
  "spawn",
];

// Anything newer than this gets the `relay-fresh` ribbon so the eye finds
// just-arrived events without scanning the whole list.
const FRESH_MS = 45_000;

interface Props {
  data: FleetViewData;
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
}

export function FleetActivityFeed({
  data,
  selectedKeys,
  onPickSession,
  canAdd,
}: Props) {
  const { sessions, streamStatus, error } = data;
  const [repoFilter, setRepoFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<FleetEventKind | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const details = useSessionDetails(sessions);

  // Re-tick "now" so relative times ("5m") and fresh halos stay accurate
  // without forcing a network refetch. 15s is short enough that "now" → "1m"
  // transitions are noticed, long enough to keep render churn minimal.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const events = useMemo(
    () => buildDetailEvents(sessions, details),
    [sessions, details],
  );
  const hueMap = useMemo(() => buildHueMap(sessions), [sessions]);
  const rows = useMemo(() => buildFeedRows(events), [events]);

  // Sonar — per-session silence (now - last event ts). Re-derived on each
  // `now` tick so the strip animates without a separate timer. Repo filter
  // applies so the strip mirrors what the feed is showing.
  const sonarEntries = useMemo(() => {
    const filtered = repoFilter
      ? events.filter((e) => e.repo === repoFilter)
      : events;
    return buildSonarEntries(filtered, now);
  }, [events, repoFilter, now]);
  const sonarMedian = useMemo(
    () => silenceMedian(sonarEntries),
    [sonarEntries],
  );
  // Stalled = active (non-ended) sessions whose silence exceeds median × 3,
  // with a 30s floor so an empty fleet doesn't pulse on every blink.
  const sonarThreshold = Math.max(sonarMedian * 3, 30_000);
  const sonarMaxSilence = sonarEntries.reduce(
    (m, e) => (e.silenceMs > m ? e.silenceMs : m),
    0,
  );

  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.repo) set.add(e.repo);
    return [...set].sort();
  }, [events]);

  // Per-kind counts (post repo filter) drive the chip badges so the user
  // sees how many events a filter would reveal before clicking.
  const kindCounts = useMemo(() => {
    const m = new Map<FleetEventKind | "all", number>();
    m.set("all", 0);
    for (const e of events) {
      if (repoFilter && e.repo !== repoFilter) continue;
      m.set("all", (m.get("all") ?? 0) + 1);
      m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    }
    return m;
  }, [events, repoFilter]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      const ev = rowSampleEvent(row);
      if (repoFilter && ev.repo !== repoFilter) return false;
      if (kindFilter === "all") return true;
      // Tool-group rows answer to the "tool" filter as a single entity.
      if (row.kind === "tool-group") return kindFilter === "tool";
      return ev.kind === kindFilter;
    });
  }, [rows, repoFilter, kindFilter]);

  // Drop a date-header pseudo-row each time the calendar day changes as we
  // walk newest → oldest. Cheap because rows are already sorted.
  const renderItems = useMemo(() => {
    const out: Array<
      | { type: "row"; row: FeedRow; idx: number }
      | { type: "header"; key: string; label: string }
    > = [];
    let lastKey = "";
    filteredRows.forEach((row, idx) => {
      const key = dateBucketKey(row.ts);
      if (key !== lastKey) {
        out.push({
          type: "header",
          key: `h-${key}`,
          label: dateBucketLabel(row.ts, now),
        });
        lastKey = key;
      }
      out.push({ type: "row", row, idx });
    });
    return out;
  }, [filteredRows, now]);

  const totalEvents = events.length;
  const hiddenByFilter = totalEvents - filteredRows.length;

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header — split into status row + filters row so chips don't wrap
          awkwardly under the count on narrow widths. */}
      <div className="flex-shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="px-6 py-1.5 flex items-center gap-3 text-[11px] font-mono text-[var(--color-fg-dim)]">
          <span>
            <span className="text-[var(--color-fg-muted)]">
              {filteredRows.length}
            </span>{" "}
            rows
            {hiddenByFilter > 0 && (
              <span className="ml-1 text-[var(--color-fg-dim)]">
                (· {hiddenByFilter} hidden)
              </span>
            )}
          </span>
          <StreamPill status={streamStatus} />
          <span>·</span>
          <label className="flex items-center gap-1">
            <span className="text-[var(--color-fg-dim)]">repo</span>
            <select
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              className="bg-transparent border border-[var(--color-border)] rounded-[var(--radius-sm)] px-1 h-6"
            >
              <option value="">all</option>
              {repos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-[10px] text-[var(--color-fg-dim)]">
            click row to expand · arrow to open tile
          </span>
        </div>
        <div className="px-6 pb-1.5 flex items-center gap-1 flex-wrap">
          {KIND_FILTERS.map((k) => {
            const count = kindCounts.get(k) ?? 0;
            const active = kindFilter === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKindFilter(k)}
                aria-pressed={active}
                className={cn(
                  "px-1.5 h-5 rounded-[var(--radius-sm)] border text-[10.5px] font-mono inline-flex items-center gap-1",
                  active
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                <span>{k}</span>
                <span className="text-[9.5px] opacity-70 tabular">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        {sonarEntries.length > 0 && (
          <SonarStrip
            entries={sonarEntries}
            hueMap={hueMap}
            maxSilence={sonarMaxSilence}
            threshold={sonarThreshold}
            selectedKeys={selectedKeys}
            canAdd={canAdd}
            onPickSession={onPickSession}
          />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <div className="px-6 py-3 text-[12px] text-[var(--color-danger,#dc2626)]">
            feed load failed: {error}
          </div>
        )}
        {!error && streamStatus === "connecting" && filteredRows.length === 0 && (
          <div className="px-6 py-3 text-[12px] text-[var(--color-fg-dim)]">
            loading…
          </div>
        )}
        {!error &&
          streamStatus !== "connecting" &&
          filteredRows.length === 0 && (
            <EmptyHint
              hiddenByFilter={hiddenByFilter}
              clearFilters={() => {
                setRepoFilter("");
                setKindFilter("all");
              }}
            />
          )}

        <ol className="pl-6 pr-3 py-2">
          {renderItems.map((item) => {
            if (item.type === "header") {
              return (
                <li
                  key={item.key}
                  className="sticky top-0 z-[1] -mx-6 px-6 py-1 text-[10.5px] font-mono uppercase tracking-wide text-[var(--color-fg-dim)] bg-[var(--color-bg)]/95 backdrop-blur-sm border-b border-[var(--color-border)]"
                >
                  {item.label}
                </li>
              );
            }
            const row = item.row;
            const sample = rowSampleEvent(row);
            const sKey = sessionKey({
              type: sample.sessionType,
              id: sample.sessionId,
            });
            const selected = selectedKeys.has(sKey);
            const hue = hueForSession(
              hueMap,
              sample.sessionType,
              sample.sessionId,
            );
            const isFresh = now - row.ts < FRESH_MS;
            const rowId =
              row.kind === "event"
                ? `e:${sKey}:${row.ts}:${row.event.kind}:${item.idx}`
                : `g:${sKey}:${row.ts}:${row.tools.length}`;
            const isExpanded = expanded.has(rowId);

            return (
              <li
                key={rowId}
                className={cn(
                  "group relative grid grid-cols-[3px_64px_22px_1fr_22px] gap-x-2 items-start py-1.5",
                  "border-b border-[var(--color-border)]/40",
                  isFresh && "relay-fresh rounded-[var(--radius-sm)]",
                )}
              >
                {/* Session lane (color stripe). Same hue as Cosmos. */}
                <span
                  aria-hidden
                  className="row-span-2 self-stretch rounded-full"
                  style={{
                    background: `hsl(${hue}, 65%, 55%)`,
                    opacity: selected ? 1 : 0.55,
                  }}
                />

                {/* Clock + relative time */}
                <button
                  type="button"
                  onClick={() => toggleExpand(rowId)}
                  className="text-left pt-[2px]"
                  aria-expanded={isExpanded}
                >
                  <div className="text-[10.5px] font-mono text-[var(--color-fg-muted)] tabular leading-none">
                    {formatClock(row.ts)}
                  </div>
                  <div className="text-[9.5px] font-mono text-[var(--color-fg-dim)] tabular leading-tight mt-0.5">
                    {formatRelative(row.ts, now)}
                  </div>
                </button>

                {/* Icon */}
                <button
                  type="button"
                  onClick={() => toggleExpand(rowId)}
                  className="pt-[2px] flex items-center justify-center"
                  style={{ color: statusColor(sample.status) }}
                  aria-label="toggle expand"
                >
                  {row.kind === "tool-group" ? (
                    isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" aria-hidden />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                    )
                  ) : (
                    <EventIcon kind={row.event.kind} />
                  )}
                </button>

                {/* Content */}
                <div className="min-w-0">
                  <div
                    className="flex items-center gap-2 text-[10.5px] font-mono text-[var(--color-fg-muted)] flex-wrap"
                  >
                    <span
                      className="text-[var(--color-fg-dim)]"
                      style={{ color: `hsl(${hue}, 60%, 60%)` }}
                    >
                      {sample.sessionType[0]}/
                    </span>
                    <span
                      className={cn(
                        selected
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-fg-muted)]",
                      )}
                    >
                      {sample.repo ?? "—"}
                    </span>
                    {sample.agentId && (
                      <span className="text-[var(--color-fg-dim)]">
                        · {sample.agentId}
                      </span>
                    )}
                    <span className="text-[var(--color-fg-dim)] ml-auto">
                      {row.kind === "tool-group"
                        ? `${row.tools.length} tools · ${formatBurst(
                            row.spanMs,
                          )}`
                        : row.event.kind}
                    </span>
                  </div>

                  {row.kind === "event" ? (
                    <button
                      type="button"
                      onClick={() => toggleExpand(rowId)}
                      className={cn(
                        "block w-full text-left text-[12px] text-[var(--color-fg)] mt-0.5 break-words",
                        !isExpanded && "line-clamp-2",
                      )}
                    >
                      {row.event.summary || (
                        <span className="text-[var(--color-fg-dim)] italic">
                          (empty)
                        </span>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleExpand(rowId)}
                      className="block w-full text-left text-[12px] text-[var(--color-fg)] mt-0.5"
                    >
                      <span className="text-[var(--color-fg-muted)]">
                        {summarizeBurst(row.tools)}
                      </span>
                    </button>
                  )}

                  {/* Expanded body */}
                  {isExpanded && row.kind === "tool-group" && (
                    <ul className="mt-1 pl-2 border-l border-[var(--color-border)] space-y-0.5">
                      {row.tools.map((t, i) => (
                        <li
                          key={`${rowId}-tool-${i}`}
                          className="text-[11px] font-mono text-[var(--color-fg-muted)] flex items-baseline gap-2"
                        >
                          <span className="text-[10px] text-[var(--color-fg-dim)] tabular">
                            {formatClock(t.ts)}
                          </span>
                          <span className="break-all">{t.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Open-tile action (right rail). Hidden when already
                    selected or when there's no tile capacity left. */}
                {!selected && canAdd && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPickSession({
                        type: sample.sessionType,
                        id: sample.sessionId,
                      });
                    }}
                    aria-label="open as tile"
                    className="pt-[3px] text-[var(--color-fg-dim)] hover:text-[var(--color-accent)] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function rowSampleEvent(row: FeedRow): FleetEvent {
  if (row.kind === "event") return row.event;
  const first = row.tools[0];
  // Defensive: tool-group never has empty tools (builder guarantees ≥2)
  if (!first) {
    return {
      ts: row.ts,
      sessionType: row.sessionType,
      sessionId: row.sessionId,
      repo: row.repo,
      status: row.status,
      agentId: row.agentId,
      kind: "tool",
      summary: "",
    };
  }
  return first;
}

function summarizeBurst(tools: readonly FleetEvent[]): string {
  // Strip the "args" suffix and dedupe so "Read · A; Read · B; Read · C"
  // becomes "Read ×3". Keeps the collapsed view scannable.
  const counts = new Map<string, number>();
  for (const t of tools) {
    const name = t.summary.split(" · ")[0] ?? t.summary;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [name, n] of counts) {
    parts.push(n > 1 ? `${name} ×${n}` : name);
  }
  return parts.join(" · ");
}

function formatBurst(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function EventIcon({ kind }: { kind: FleetEventKind }) {
  switch (kind) {
    case "user":
      return <User className="w-3.5 h-3.5" aria-hidden />;
    case "assistant":
      return <MessageSquare className="w-3.5 h-3.5" aria-hidden />;
    case "tool":
      return <Wrench className="w-3.5 h-3.5" aria-hidden />;
    case "system":
      return <Settings className="w-3.5 h-3.5" aria-hidden />;
    case "waiting":
      return <AlertTriangle className="w-3.5 h-3.5" aria-hidden />;
    case "ended":
      return <Check className="w-3.5 h-3.5" aria-hidden />;
    case "interrupted":
      return <XCircle className="w-3.5 h-3.5" aria-hidden />;
    case "spawn":
      return <Sparkles className="w-3.5 h-3.5" aria-hidden />;
    default:
      return <MessageSquare className="w-3.5 h-3.5" aria-hidden />;
  }
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function StreamPill({
  status,
}: {
  status: "connecting" | "live" | "reconnecting" | "error" | "idle";
}) {
  const label = status === "live" ? "live" : status;
  const color =
    status === "live"
      ? "var(--color-accent)"
      : status === "error"
        ? "var(--color-danger,#dc2626)"
        : "var(--color-fg-dim)";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono"
      style={{ color }}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block w-1.5 h-1.5 rounded-full",
          status === "live" && "relay-pulse-strong",
        )}
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

// Sonar — horizontal strip below the filters that surfaces per-session
// silence. Each chip is a tall thin bar whose height is silence / max; the
// hue ribbon and label below identify the session. Bars whose silence
// exceeds median × 3 pulse and turn warning-colored so a stalled session
// pops without the user having to scroll the feed.
function SonarStrip({
  entries,
  hueMap,
  maxSilence,
  threshold,
  selectedKeys,
  canAdd,
  onPickSession,
}: {
  entries: readonly SonarEntry[];
  hueMap: ReadonlyMap<string, number>;
  maxSilence: number;
  threshold: number;
  selectedKeys: ReadonlySet<string>;
  canAdd: boolean;
  onPickSession: (spec: TileSpec) => void;
}) {
  // Cap how many sessions render so a fleet of 30+ doesn't blow out the
  // header. Longest silences are already at the front (buildSonarEntries
  // sorted them), so slicing keeps the most interesting ones.
  const VISIBLE = 16;
  const shown = entries.slice(0, VISIBLE);
  const hidden = entries.length - shown.length;
  return (
    <div className="px-6 pb-1.5 pt-0.5 flex items-end gap-1.5 overflow-x-auto border-t border-[var(--color-border)]/40">
      <span className="text-[9.5px] font-mono uppercase tracking-wide text-[var(--color-fg-dim)] pr-1 pb-2 self-end">
        sonar
      </span>
      {shown.map((e) => {
        const hue = hueForSession(hueMap, e.sessionType, e.sessionId);
        const stalled = !e.isEnded && e.silenceMs >= threshold;
        const selected = selectedKeys.has(e.key);
        const ratio = maxSilence > 0 ? e.silenceMs / maxSilence : 0;
        // Floor at 8% so even short silences render as a visible nub.
        const barHeight = Math.max(0.08, ratio) * 100;
        const tile: TileSpec = { type: e.sessionType, id: e.sessionId };
        const clickable = selected || canAdd;
        return (
          <button
            key={e.key}
            type="button"
            disabled={!clickable}
            onClick={() => onPickSession(tile)}
            title={`${e.sessionType}/${e.repo ?? "—"}${e.agentId ? ` · ${e.agentId}` : ""}\nsilence: ${formatSilence(e.silenceMs)}${stalled ? "  (stalled · ≥ median × 3)" : ""}`}
            className={cn(
              "flex flex-col items-center gap-0.5 px-0.5 py-0.5 rounded-[var(--radius-sm)]",
              clickable
                ? "hover:bg-[var(--color-border)]/30 cursor-pointer"
                : "opacity-70 cursor-default",
              selected && "ring-1 ring-[var(--color-accent)]",
            )}
          >
            <span
              aria-hidden
              className="relative w-1.5 h-6 rounded-full overflow-hidden bg-[var(--color-border)]/40"
            >
              <span
                className={cn(
                  "absolute bottom-0 left-0 right-0 rounded-full",
                  stalled && "relay-pulse-strong",
                )}
                style={{
                  height: `${barHeight}%`,
                  background: stalled
                    ? "var(--color-warn,#d97706)"
                    : e.isEnded
                      ? `hsl(${hue}, 25%, 45%)`
                      : `hsl(${hue}, 65%, 55%)`,
                  opacity: e.isEnded ? 0.55 : 1,
                }}
              />
            </span>
            <span
              className={cn(
                "text-[9px] font-mono tabular leading-none",
                stalled
                  ? "text-[var(--color-warn,#d97706)]"
                  : "text-[var(--color-fg-dim)]",
              )}
            >
              {formatSilence(e.silenceMs)}
            </span>
          </button>
        );
      })}
      {hidden > 0 && (
        <span className="text-[10px] font-mono text-[var(--color-fg-dim)] pl-1 pb-2 self-end">
          +{hidden}
        </span>
      )}
    </div>
  );
}

function EmptyHint({
  hiddenByFilter,
  clearFilters,
}: {
  hiddenByFilter: number;
  clearFilters: () => void;
}) {
  if (hiddenByFilter > 0) {
    return (
      <div className="px-6 py-4 text-[12px] text-[var(--color-fg-dim)]">
        no events match current filters.{" "}
        <button
          type="button"
          onClick={clearFilters}
          className="underline hover:text-[var(--color-accent)]"
        >
          clear {hiddenByFilter} hidden
        </button>
      </div>
    );
  }
  return (
    <div className="px-6 py-4 text-[12px] text-[var(--color-fg-dim)]">
      no events yet. activity will appear here when sessions produce messages.
    </div>
  );
}
