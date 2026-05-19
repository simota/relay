"use client";

import { useMemo } from "react";
import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { computeCadenceBuckets } from "../_lib/cadence";
import { getDensityColor, getStateColor } from "../_lib/colors";
import { shortTime } from "../_lib/format";

const BUCKET_COUNT = 60;

function intensity(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.log1p(count) / Math.log1p(max);
}

/**
 * Horizontal strip visualizing how messages are distributed across the
 * session's lifetime. Each cell is one equal-width time bucket; opacity
 * scales with message count. The trailing cell turns warm when the
 * session is currently waiting on the user so the cadence row doubles
 * as an at-a-glance "needs attention" indicator.
 */
export function CadenceHeatmap({
  data,
  compact = false,
}: {
  data: SessionDetail;
  compact?: boolean;
}) {
  const buckets = useMemo(
    () =>
      computeCadenceBuckets(data.messages, {
        bucketCount: BUCKET_COUNT,
        status: data.status,
        startedAt: data.started_at,
        lastActive: data.last_active,
      }),
    [data.messages, data.status, data.started_at, data.last_active],
  );

  if (buckets.length === 0) return null;

  const max = buckets.reduce((m, b) => (b.count > m ? b.count : m), 0);
  const height = compact ? 8 : 12;

  return (
    <div className="flex w-full items-center gap-2">
      <div
        className="flex w-14 shrink-0 items-center gap-1 text-[9px] font-mono uppercase tracking-wide text-[var(--color-fg-dim)]"
        title="Message activity volume across time"
      >
        <svg
          width={10}
          height={10}
          viewBox="0 0 10 10"
          fill="currentColor"
          aria-hidden="true"
          className="shrink-0"
        >
          <rect x={0} y={5} width={2} height={5} rx={0.5} />
          <rect x={3} y={2} width={2} height={8} rx={0.5} />
          <rect x={6} y={6} width={2} height={4} rx={0.5} />
        </svg>
        <span>activity</span>
      </div>
      <div
        className="flex flex-1 min-w-0 gap-px rounded-[var(--radius-sm)] overflow-hidden border border-[var(--color-border)]"
        role="img"
        aria-label={`Message cadence across ${buckets.length} time buckets`}
        title={`Cadence: ${data.messages.length} messages across ${buckets.length} buckets`}
      >
        {buckets.map((b, i) => {
          const startLabel = shortTime(new Date(b.start).toISOString());
          const endLabel = shortTime(new Date(b.end).toISOString());
          const bg = b.isWaiting
            ? getStateColor("waiting_for_user")
            : b.count === 0
              ? "transparent"
              : getDensityColor(intensity(b.count, max));
          return (
            <div
              key={i}
              className={cn("flex-1 transition-colors", b.isWaiting && "relay-attention")}
              style={{ height, backgroundColor: bg }}
              title={`${startLabel} – ${endLabel}: ${b.count} message${b.count === 1 ? "" : "s"}${
                b.isWaiting ? " · waiting for user" : ""
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
