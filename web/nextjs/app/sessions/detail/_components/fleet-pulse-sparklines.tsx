"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type SessionDetail, type SessionSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useFleetStream } from "../_hooks/use-fleet-stream";
import {
  bucketizeMessages,
  maxBucket,
  normalizeBuckets,
  type PulseRange,
  pulseTicks,
  pulseWindowFor,
} from "../_lib/fleet-pulse";
import { buildFleetRows, sessionKey, statusColor } from "../_lib/fleet-timeline";
import type { TileSpec } from "../_types";

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
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
}

export function FleetPulseSparklines({
  selectedKeys,
  onPickSession,
  canAdd,
}: Props) {
  const [range, setRange] = useState<PulseRange>("24h");
  const { sessions, status: streamStatus, error: listError } = useFleetStream({
    lookbackDays: range === "7d" ? 7 : 1,
    limit: 200,
  });
  const [details, setDetails] = useState<Map<string, SessionDetail>>(
    () => new Map(),
  );
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [now, setNow] = useState(() => Date.now());
  // Tracks the last_active timestamp we used when fetching each session's
  // detail. When the fleet stream pushes a newer last_active for a session,
  // we know its JSONL grew and re-fetch the detail to refresh its sparkline.
  const detailVersionRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const handle = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(handle);
  }, []);

  const visibleSessions = useMemo(() => {
    if (!sessions) return [];
    const rows = buildFleetRows(sessions);
    return rows.slice(0, limit);
  }, [sessions, limit]);

  // Fetch detail for visible sessions whose last_active is unseen or newer
  // than what we previously fetched. Parallelized; per-row failures are
  // swallowed so one slow session doesn't block the others.
  useEffect(() => {
    if (visibleSessions.length === 0) return;
    let cancelled = false;
    const stale = visibleSessions.filter((r) => {
      const key = sessionKey(r.session);
      const fetched = detailVersionRef.current.get(key);
      return fetched !== r.session.last_active;
    });
    if (stale.length === 0) return;
    void Promise.all(
      stale.map(async (r) => {
        try {
          const d = await api.session(r.session.type, r.session.id);
          return {
            key: sessionKey(r.session),
            detail: d,
            version: r.session.last_active,
          };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setDetails((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r) {
            next.set(r.key, r.detail);
            detailVersionRef.current.set(r.key, r.version);
          }
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [visibleSessions]);

  const win = useMemo(() => pulseWindowFor(range, now), [range, now]);
  const ticks = useMemo(() => pulseTicks(win, 6), [win]);

  const bucketRows = useMemo(() => {
    const rows = visibleSessions.map((r) => {
      const key = sessionKey(r.session);
      const detail = details.get(key);
      const buckets = detail
        ? bucketizeMessages(detail.messages, win)
        : new Array(win.bucketCount).fill(0);
      return { row: r, key, detail, buckets };
    });
    return rows;
  }, [visibleSessions, details, win]);

  const sharedMax = useMemo(
    () => maxBucket(bucketRows.map((r) => r.buckets)),
    [bucketRows],
  );

  const hasMore = sessions !== null && sessions.length > limit;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-2 flex items-center gap-2 flex-wrap text-[11px] font-mono text-[var(--color-fg-dim)] border-b border-[var(--color-border)]">
        <span>{visibleSessions.length}/{sessions?.length ?? 0} sessions</span>
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
        {!listError && sessions === null && (
          <div className="text-[12px] text-[var(--color-fg-dim)] py-2">loading sessions…</div>
        )}
        {!listError && sessions !== null && visibleSessions.length === 0 && (
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
              {bucketRows.map(({ row, key, detail, buckets }) => {
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
                        "relative h-6 rounded-[2px] border border-transparent",
                        selected && "ring-1 ring-[var(--color-accent)]",
                        disabled && "cursor-not-allowed",
                      )}
                    >
                      <Sparkline
                        normalized={normalized}
                        color={statusColor(row.session.status)}
                        loading={isLoading}
                      />
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
            <div className="mt-3 flex items-center gap-3 text-[10px] text-[var(--color-fg-dim)]">
              <span>shared max: {sharedMax || 0} msgs/bucket</span>
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
