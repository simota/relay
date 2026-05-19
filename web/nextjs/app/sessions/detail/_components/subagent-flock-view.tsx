"use client";

import { useMemo, useState } from "react";
import type { SessionStatus, SessionSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getStateColor, getSubagentStatusColor } from "../_lib/colors";
import {
  FLOCK_BUCKET_ORDER,
  STALE_THRESHOLD_OPTIONS,
  computeFlockLanes,
  computeFlockSummary,
  computeFlockTimeRange,
  computeStaleSubagents,
  formatElapsed,
  type FlockStatusBucket,
} from "../_lib/subagent-flock";
import { HoverDetailPanel } from "./hover-detail-panel";

const DONUT_SIZE = 80;
const DONUT_STROKE = 14;

const BUCKET_LABEL: Record<FlockStatusBucket, string> = {
  active: "active",
  waiting_for_user: "waiting",
  idle: "idle",
  interrupted: "interrupted",
  ended: "ended",
  unknown: "unknown",
};

function bucketColor(b: FlockStatusBucket): string {
  if (b === "unknown") return "var(--color-fg-dim)";
  return getSubagentStatusColor(b);
}

function laneColor(status: SessionStatus | undefined): string {
  if (!status) return "var(--color-fg-dim)";
  return getSubagentStatusColor(status);
}

interface FlockViewProps {
  childrenSessions: SessionSummary[];
  loading?: boolean;
  error?: string | null;
  onOpenChild?: (child: SessionSummary) => void;
  compact?: boolean;
}

export function SubagentFlockView({
  childrenSessions,
  loading = false,
  error = null,
  onOpenChild,
  compact = false,
}: FlockViewProps) {
  const [thresholdMs, setThresholdMs] = useState<number>(5 * 60_000);
  const [hover, setHover] = useState<{
    time?: string;
    primary?: string;
    secondary?: string;
    tertiary?: string;
  } | null>(null);

  // `now` is computed once per render. The parent hook re-fetches every
  // MIN_REFETCH_MS=15s which re-renders this view, so the staleness clock
  // advances on the same cadence as the data — no separate interval needed.
  const now = Date.now();

  const summary = useMemo(
    () => computeFlockSummary(childrenSessions, thresholdMs, now),
    [childrenSessions, thresholdMs, now],
  );
  const range = useMemo(
    () => computeFlockTimeRange(childrenSessions),
    [childrenSessions],
  );
  const lanes = useMemo(
    () => (range ? computeFlockLanes(childrenSessions, range) : []),
    [childrenSessions, range],
  );
  const stale = useMemo(
    () => computeStaleSubagents(childrenSessions, thresholdMs, now),
    [childrenSessions, thresholdMs, now],
  );

  if (loading && childrenSessions.length === 0) {
    return (
      <div className={cn("font-mono text-[11px] text-[var(--color-fg-dim)]", compact ? "py-2" : "py-3")}>
        loading subagents…
      </div>
    );
  }
  if (error) {
    return (
      <div
        className={cn(
          "font-mono text-[11px] text-[var(--color-warn,var(--color-accent))]",
          compact ? "py-2" : "py-3",
        )}
      >
        {error}
      </div>
    );
  }
  if (childrenSessions.length === 0) {
    return (
      <div className={cn("font-mono text-[11px] text-[var(--color-fg-dim)]", compact ? "py-2" : "py-3")}>
        no subagents
      </div>
    );
  }

  return (
    <div className={cn("w-full space-y-3 font-mono", compact ? "py-2" : "py-3")}>
      <FlockHeader
        summary={summary}
        compact={compact}
        onHover={(d) => setHover(d)}
        onLeave={() => setHover(null)}
      />
      <FlockGantt
        lanes={lanes}
        compact={compact}
        onOpen={onOpenChild}
        onHover={(d) => setHover(d)}
        onLeave={() => setHover(null)}
      />
      <FlockStale
        stale={stale}
        thresholdMs={thresholdMs}
        onChangeThreshold={setThresholdMs}
        now={now}
        compact={compact}
        onOpen={onOpenChild}
      />
      <HoverDetailPanel
        time={hover?.time}
        primary={hover?.primary}
        secondary={hover?.secondary}
        tertiary={hover?.tertiary}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top: Status Donut + KPI band
// ---------------------------------------------------------------------------
function FlockHeader({
  summary,
  compact,
  onHover,
  onLeave,
}: {
  summary: ReturnType<typeof computeFlockSummary>;
  compact: boolean;
  onHover: (d: { primary?: string; secondary?: string }) => void;
  onLeave: () => void;
}) {
  const slices = useMemo(() => {
    const total = summary.total || 1;
    const circumference = 2 * Math.PI * ((DONUT_SIZE - DONUT_STROKE) / 2);
    let offset = 0;
    const out: Array<{
      bucket: FlockStatusBucket;
      count: number;
      dash: string;
      off: number;
    }> = [];
    for (const b of FLOCK_BUCKET_ORDER) {
      const count = summary.byStatus[b];
      if (count <= 0) continue;
      const len = (count / total) * circumference;
      out.push({ bucket: b, count, dash: `${len} ${circumference - len}`, off: -offset });
      offset += len;
    }
    return out;
  }, [summary]);

  const radius = (DONUT_SIZE - DONUT_STROKE) / 2;
  const waitingWarm = summary.waiting > 0;

  return (
    <div className="flex items-center gap-4">
      <svg
        width={DONUT_SIZE}
        height={DONUT_SIZE}
        viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
        role="img"
        aria-label="Subagent status distribution"
        style={{ display: "block", flexShrink: 0 }}
      >
        <circle
          cx={DONUT_SIZE / 2}
          cy={DONUT_SIZE / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={DONUT_STROKE}
        />
        {slices.map((s) => (
          <circle
            key={s.bucket}
            cx={DONUT_SIZE / 2}
            cy={DONUT_SIZE / 2}
            r={radius}
            fill="none"
            stroke={bucketColor(s.bucket)}
            strokeWidth={DONUT_STROKE}
            strokeDasharray={s.dash}
            strokeDashoffset={s.off}
            transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}
            onMouseEnter={() =>
              onHover({
                primary: `${BUCKET_LABEL[s.bucket]} · ${s.count}`,
                secondary: `${((s.count / Math.max(1, summary.total)) * 100).toFixed(0)}% of ${summary.total}`,
              })
            }
            onMouseLeave={onLeave}
            style={{ cursor: "pointer" }}
          >
            <title>{`${BUCKET_LABEL[s.bucket]}: ${s.count}`}</title>
          </circle>
        ))}
        <text
          x={DONUT_SIZE / 2}
          y={DONUT_SIZE / 2 + 4}
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize={14}
          fill="var(--color-fg)"
        >
          {summary.total}
        </text>
      </svg>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <KpiPill
          label="active"
          value={summary.active}
          color={getStateColor("active")}
          compact={compact}
        />
        <KpiPill
          label="waiting"
          value={summary.waiting}
          color={getStateColor("waiting_for_user")}
          compact={compact}
          emphasize={waitingWarm}
        />
        <KpiPill
          label="stale"
          value={summary.stale}
          color="var(--color-warm)"
          compact={compact}
          emphasize={summary.stale > 0}
        />
        <KpiPill
          label="total"
          value={summary.total}
          color="var(--color-fg-muted)"
          compact={compact}
        />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--color-fg-muted)]">
          {FLOCK_BUCKET_ORDER.map((b) => {
            const count = summary.byStatus[b];
            if (count <= 0) return null;
            return (
              <span key={b} className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block w-2 h-2 rounded-[2px]"
                  style={{ backgroundColor: bucketColor(b) }}
                />
                <span>{BUCKET_LABEL[b]} {count}</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function KpiPill({
  label,
  value,
  color,
  compact,
  emphasize = false,
}: {
  label: string;
  value: number;
  color: string;
  compact: boolean;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5 tabular-nums",
        compact ? "text-[10.5px]" : "text-[11px]",
        emphasize
          ? "border-[color:var(--color-warm)] text-[var(--color-fg)]"
          : "border-[var(--color-border)] text-[var(--color-fg)]",
      )}
      style={emphasize ? { backgroundColor: "color-mix(in srgb, var(--color-warm) 12%, var(--color-bg))" } : undefined}
    >
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-[var(--color-fg-muted)]">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Middle: Lifeline Gantt
// ---------------------------------------------------------------------------
function FlockGantt({
  lanes,
  compact,
  onOpen,
  onHover,
  onLeave,
}: {
  lanes: ReturnType<typeof computeFlockLanes>;
  compact: boolean;
  onOpen?: (child: SessionSummary) => void;
  onHover: (d: {
    primary?: string;
    secondary?: string;
    tertiary?: string;
  }) => void;
  onLeave: () => void;
}) {
  if (lanes.length === 0) return null;
  const rowH = compact ? 10 : 14;
  const labelW = compact ? 84 : 104;
  const metaW = compact ? 72 : 88;
  const tooMany = lanes.length > 20;

  return (
    <div
      className={cn(
        "rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]",
        compact ? "px-2 py-1.5" : "px-2.5 py-2",
      )}
    >
      <div className={cn("text-[10px] text-[var(--color-fg-muted)] mb-1")}>
        lifeline · {lanes.length} subagent{lanes.length === 1 ? "" : "s"}
      </div>
      <div
        className="w-full"
        style={tooMany ? { maxHeight: rowH * 20 + 4, overflowY: "auto" } : undefined}
      >
        {lanes.map((lane) => {
          const { child } = lane;
          const label = child.agent_id ?? child.id.slice(0, 8);
          const color = laneColor(child.status);
          const isWaiting = child.status === "waiting_for_user";
          const leftPct = lane.x0 * 100;
          const widthPct = Math.max(0.8, (lane.x1 - lane.x0) * 100);
          const clickable = !!onOpen;
          return (
            <button
              key={child.id}
              type="button"
              onClick={() => clickable && onOpen?.(child)}
              onMouseEnter={() =>
                onHover({
                  primary: `${label} · ${child.status ?? "unknown"}`,
                  secondary: `${child.message_count} msg`,
                  tertiary: child.title,
                })
              }
              onMouseLeave={onLeave}
              className={cn(
                "w-full flex items-center gap-2 text-left rounded-[var(--radius-sm)] hover:bg-[var(--color-bg)]",
                clickable ? "cursor-pointer" : "cursor-default",
              )}
              style={{ height: rowH + 4 }}
              title={child.title}
            >
              <span
                className="text-[var(--color-fg)] truncate inline-block"
                style={{ width: labelW, fontSize: compact ? 10 : 11 }}
              >
                {label}
              </span>
              <span
                aria-hidden
                className={cn("inline-block rounded-full", isWaiting && "relay-attention-soft")}
                style={{ width: 6, height: 6, backgroundColor: color, flexShrink: 0 }}
              />
              <span className="relative flex-1 h-full">
                <span
                  className="absolute inset-y-0"
                  style={{
                    left: 0,
                    right: 0,
                    top: "50%",
                    height: 1,
                    transform: "translateY(-0.5px)",
                    backgroundColor: "var(--color-border)",
                  }}
                />
                <span
                  className={cn("absolute rounded-[2px]", isWaiting && "relay-attention-soft")}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: "50%",
                    height: rowH,
                    transform: "translateY(-50%)",
                    backgroundColor: `color-mix(in srgb, ${color} 38%, var(--color-bg))`,
                    border: `1px solid ${color}`,
                  }}
                />
              </span>
              <span
                className="text-[var(--color-fg-muted)] tabular-nums text-right inline-block"
                style={{ width: metaW, fontSize: compact ? 10 : 10.5 }}
              >
                {child.message_count} msg
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom: Stale Spotlight
// ---------------------------------------------------------------------------
function FlockStale({
  stale,
  thresholdMs,
  onChangeThreshold,
  now,
  compact,
  onOpen,
}: {
  stale: SessionSummary[];
  thresholdMs: number;
  onChangeThreshold: (ms: number) => void;
  now: number;
  compact: boolean;
  onOpen?: (child: SessionSummary) => void;
}) {
  const parse = (s: string | undefined) => {
    if (!s) return 0;
    const n = Date.parse(s);
    return Number.isNaN(n) ? 0 : n;
  };

  return (
    <div
      className={cn(
        "rounded-[var(--radius-sm)] border border-[var(--color-border)]",
        compact ? "px-2 py-1.5" : "px-2.5 py-2",
      )}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-[10px] text-[var(--color-fg-muted)]">stale spotlight</span>
        <div className="flex items-center gap-0.5" role="radiogroup" aria-label="stale threshold">
          {STALE_THRESHOLD_OPTIONS.map((opt) => {
            const active = opt.ms === thresholdMs;
            return (
              <button
                key={opt.label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChangeThreshold(opt.ms)}
                className={cn(
                  "rounded-[var(--radius-sm)] border px-1.5 h-5 text-[10px]",
                  active
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <span className="ml-auto text-[10px] text-[var(--color-fg-muted)] tabular-nums">
          {stale.length} stale
        </span>
      </div>
      {stale.length === 0 ? (
        <div className="text-[11px] text-[var(--color-fg-dim)]">No stale subagents</div>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {stale.map((c) => {
            const label = c.agent_id ?? c.id.slice(0, 8);
            const last = parse(c.last_active);
            const elapsed = last > 0 ? now - last : 0;
            const color = laneColor(c.status);
            const clickable = !!onOpen;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => clickable && onOpen?.(c)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 text-[10.5px] hover:bg-[var(--color-bg-elev)] transition-colors",
                    clickable ? "cursor-pointer" : "cursor-default",
                  )}
                  style={{
                    borderColor: color,
                    backgroundColor: "color-mix(in srgb, var(--color-warm) 8%, var(--color-bg))",
                  }}
                  title={c.title}
                >
                  <span
                    aria-hidden
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-[var(--color-fg)]">{label}</span>
                  <span className="text-[var(--color-warm)] tabular-nums">{formatElapsed(elapsed)}</span>
                  <span className="text-[var(--color-fg-muted)]">{c.message_count} msg</span>
                  <span className="text-[var(--color-fg-dim)]">{c.status ?? "unknown"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
