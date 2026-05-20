"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { SessionDetail, SessionSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSessionDetails } from "../_hooks/use-session-details";
import {
  bucketizeLatencies,
  bucketizeMessages,
  LATENCY_BUCKETS,
  LATENCY_COLORS,
  latencyTotal,
  maxBucket,
  normalizeBuckets,
  type PulseRange,
  pulseTicks,
  pulseWindowFor,
} from "../_lib/fleet-pulse";
import { buildFleetRows, sessionKey, statusColor } from "../_lib/fleet-timeline";
import type { TileSpec } from "../_types";
import type { FleetViewData } from "./fleet-view";

const RANGES: { key: PulseRange; label: string }[] = [
  { key: "1h", label: "1h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
];

// Hard cap on how many sessions we fetch detail for in a single mount.
// Each detail is potentially MBs of JSONL — pulling 50+ would balloon
// the SPA's memory and saturate the local server. The user can raise it
// with "show more", which simply bumps this in state.
const DEFAULT_LIMIT = 8;

// Re-tick `now` every 30s so the pulse window slides forward even when no
// new sessions arrive. Without this, the right edge of the sparkline would
// drift behind real time and old buckets would never roll off.
const NOW_TICK_MS = 30_000;

interface Props {
  data: FleetViewData;
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
}

export function FleetPulseSparklines({
  data,
  selectedKeys,
  onPickSession,
  canAdd,
}: Props) {
  const [range, setRange] = useState<PulseRange>("24h");
  const { sessions, streamStatus, error: listError } = data;
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(handle);
  }, []);

  const visibleSessions = useMemo(() => {
    if (sessions.length === 0) return [];
    const rows = buildFleetRows(sessions);
    return rows.slice(0, limit);
  }, [sessions, limit]);

  const visibleSessionList = useMemo<SessionSummary[]>(
    () => visibleSessions.map((r) => r.session),
    [visibleSessions],
  );
  const details = useSessionDetails(visibleSessionList);

  const win = useMemo(() => pulseWindowFor(range, now), [range, now]);
  const ticks = useMemo(() => pulseTicks(win, 6), [win]);

  const bucketRows = useMemo(() => {
    const rows = visibleSessions.map((r) => {
      const key = sessionKey(r.session);
      const detail = details.get(key);
      const buckets = detail
        ? bucketizeMessages(detail.messages, win)
        : new Array(win.bucketCount).fill(0);
      // Tide stack — per-row response-latency histogram. Empty array
      // when detail hasn't arrived; downstream treats that as "no data".
      const latency = detail
        ? bucketizeLatencies(detail.messages, win)
        : new Array(LATENCY_BUCKETS.length).fill(0);
      return { row: r, key, detail, buckets, latency };
    });
    return rows;
  }, [visibleSessions, details, win]);

  const sharedMax = useMemo(
    () => maxBucket(bucketRows.map((r) => r.buckets)),
    [bucketRows],
  );

  const hasMore = sessions.length > limit;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-2 flex items-center gap-2 flex-wrap text-[11px] font-mono text-[var(--color-fg-dim)] border-b border-[var(--color-border)]">
        <span>{visibleSessions.length}/{sessions.length} sessions</span>
        <StreamPill status={streamStatus} />
        <span>bucket: {bucketLabel(range)}</span>
        <div className="ml-auto flex items-center gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              aria-pressed={range === r.key}
              className={cn(
                "px-1.5 h-5 rounded-[var(--radius-sm)] border",
                range === r.key
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2">
        {listError && (
          <div className="text-[12px] text-[var(--color-danger,#dc2626)] py-2">
            list load failed: {listError}
          </div>
        )}
        {!listError && streamStatus === "connecting" && visibleSessions.length === 0 && (
          <div className="text-[12px] text-[var(--color-fg-dim)] py-2">loading sessions…</div>
        )}
        {!listError && streamStatus !== "connecting" && visibleSessions.length === 0 && (
          <div className="text-[12px] text-[var(--color-fg-dim)] py-2">
            no sessions to plot.
          </div>
        )}
        {visibleSessions.length > 0 && (
          <>
            <div className="grid grid-cols-[minmax(160px,200px)_1fr_18px] gap-x-3">
              <div />
              <div className="relative h-3 text-[10px] text-[var(--color-fg-dim)]">
                {ticks.map((t, i) => (
                  <span
                    key={i}
                    className="absolute -translate-x-1/2"
                    style={{ left: `${t.position}%` }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
              <div />
              {bucketRows.map(({ row, key, detail, buckets, latency }) => {
                const selected = selectedKeys.has(key);
                const waiting = row.session.status === "waiting_for_user";
                const normalized = normalizeBuckets(buckets, sharedMax);
                const isLoading = !detail;
                const disabled = !canAdd && !selected;
                return (
                  <div key={key} className="contents">
                    <button
                      type="button"
                      onClick={() =>
                        onPickSession({
                          type: row.session.type,
                          id: row.session.id,
                        })
                      }
                      disabled={disabled}
                      title={rowTitle(row.session, detail)}
                      className={cn(
                        "text-left text-[11px] font-mono truncate py-1",
                        row.indent === 1 && "pl-3",
                        selected
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                        disabled && "opacity-60 cursor-not-allowed",
                      )}
                    >
                      {row.indent === 1 && (
                        <span className="text-[var(--color-fg-dim)]">└ </span>
                      )}
                      <span className="text-[var(--color-fg-dim)]">
                        {row.session.type[0]}/
                      </span>
                      {row.session.repo ?? "—"}
                      {row.session.agent_id && (
                        <span className="text-[var(--color-fg-dim)]">
                          {" "}· {row.session.agent_id.slice(6, 13)}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onPickSession({
                          type: row.session.type,
                          id: row.session.id,
                        })
                      }
                      disabled={disabled}
                      title={rowTitle(row.session, detail)}
                      className={cn(
                        "relative h-8 rounded-[2px] border border-transparent flex flex-col items-stretch py-0.5 gap-0.5",
                        selected && "ring-1 ring-[var(--color-accent)]",
                        disabled && "cursor-not-allowed",
                      )}
                    >
                      <span className="relative flex-1 min-h-0">
                        <Sparkline
                          normalized={normalized}
                          color={statusColor(row.session.status)}
                          loading={isLoading}
                        />
                      </span>
                      <TideStack latency={latency} loading={isLoading} />
                    </button>
                    <span
                      className="self-center text-[var(--color-fg-dim)]"
                      style={{ color: waiting ? "var(--color-warn,#d97706)" : undefined }}
                    >
                      {waiting ? (
                        <AlertTriangle className="w-3 h-3" aria-hidden />
                      ) : (
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: statusColor(row.session.status) }}
                        />
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-3 text-[10px] text-[var(--color-fg-dim)] flex-wrap">
              <span>shared max: {sharedMax || 0} msgs/bucket</span>
              <span className="inline-flex items-center gap-1.5">
                <span>tide:</span>
                {LATENCY_BUCKETS.map((b, i) => (
                  <span key={b.key} className="inline-flex items-center gap-0.5">
                    <span
                      aria-hidden
                      className="inline-block w-2 h-2 rounded-[1px]"
                      style={{ background: LATENCY_COLORS[i] }}
                    />
                    <span className="tabular">{b.key}</span>
                  </span>
                ))}
              </span>
              <span>click row → open tile</span>
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + DEFAULT_LIMIT)}
                  className="ml-auto text-[var(--color-accent)] hover:underline"
                >
                  show more (+{Math.min(DEFAULT_LIMIT, sessions.length - limit)})
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Sparkline({
  normalized,
  color,
  loading,
}: {
  normalized: number[];
  color: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span
        aria-hidden
        className="absolute inset-y-1 left-0 right-0 rounded-[2px]"
        style={{
          background: "var(--color-border)",
          animation: "relay-skeleton-pulse 1.4s ease-in-out infinite",
        }}
      />
    );
  }
  if (normalized.length === 0) return null;
  // Render each bucket as a CSS flex item so the sparkline scales with the
  // parent's width without needing a measured viewport. A 1px gap between
  // bars keeps the silhouette readable even for sparse rows.
  return (
    <span
      aria-hidden
      className="absolute inset-0 flex items-end gap-[1px] px-[1px] py-[1px]"
    >
      {normalized.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-[1px]"
          style={{
            height: `${Math.max(v * 100, v > 0 ? 6 : 0)}%`,
            background: v > 0 ? color : "transparent",
            opacity: v > 0 ? 0.35 + v * 0.65 : 0,
          }}
        />
      ))}
    </span>
  );
}

// Tide stack — horizontal stacked bar of user→assistant latency counts.
// Each segment's width is its share of the row's total, so a session full
// of <10s replies reads as a green ribbon and one full of long waits as a
// red one. Drawn underneath the sparkline within the same button cell.
function TideStack({
  latency,
  loading,
}: {
  latency: readonly number[];
  loading: boolean;
}) {
  const total = latencyTotal(latency);
  if (loading) {
    return (
      <span
        aria-hidden
        className="block h-1.5 rounded-[1px]"
        style={{
          background: "var(--color-border)",
          animation: "relay-skeleton-pulse 1.4s ease-in-out infinite",
        }}
      />
    );
  }
  if (total === 0) {
    // No pairs in window — render an empty rail so the row height stays
    // consistent with rows that have data.
    return (
      <span
        aria-hidden
        className="block h-1.5 rounded-[1px]"
        style={{ background: "var(--color-border)", opacity: 0.35 }}
      />
    );
  }
  return (
    <span aria-hidden className="flex h-1.5 rounded-[1px] overflow-hidden">
      {latency.map((v, i) => {
        if (v === 0) return null;
        const pct = (v / total) * 100;
        return (
          <span
            key={i}
            className="block h-full"
            style={{
              width: `${pct}%`,
              background: LATENCY_COLORS[i] ?? "var(--color-border)",
            }}
          />
        );
      })}
    </span>
  );
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
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}

function bucketLabel(range: PulseRange): string {
  switch (range) {
    case "1h":
      return "1m";
    case "24h":
      return "30m";
    case "7d":
      return "3h";
  }
}

function rowTitle(s: SessionSummary, d: SessionDetail | undefined): string {
  const parts: string[] = [
    `${s.type} · ${s.repo ?? "(no repo)"}`,
    s.title || "(no prompt)",
    `${s.message_count} msgs · ${s.status ?? "idle"}`,
  ];
  if (d) parts.push(`detail messages: ${d.messages.length}`);
  return parts.join("\n");
}
