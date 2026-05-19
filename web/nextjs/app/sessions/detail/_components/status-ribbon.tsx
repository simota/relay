"use client";

import { useMemo } from "react";
import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getStateColor } from "../_lib/colors";
import { shortTime } from "../_lib/format";
import { computeRibbonBuckets, type RibbonState } from "../_lib/status-ribbon";

const BUCKET_COUNT = 60;

function labelFor(state: RibbonState): string {
  switch (state) {
    case "active":
      return "active";
    case "waiting_for_user":
      return "waiting for user";
    case "interrupted":
      return "interrupted";
    case "ended":
      return "ended";
    case "idle":
    default:
      return "idle";
  }
}

/**
 * One-line ribbon showing how the session state evolved over its lifetime.
 *
 * CadenceHeatmap encodes *activity volume*; this ribbon encodes *state*.
 * Together they sit as two complementary single-row strips under the tile
 * header, giving an at-a-glance read of "how busy" and "in what mode" the
 * session has been without scrolling the transcript.
 */
export function StatusRibbon({
  data,
  compact = false,
}: {
  data: SessionDetail;
  compact?: boolean;
}) {
  const buckets = useMemo(
    () =>
      computeRibbonBuckets(data.messages, data.tool_calls, {
        bucketCount: BUCKET_COUNT,
        status: data.status,
        startedAt: data.started_at,
        lastActive: data.last_active,
      }),
    [data.messages, data.tool_calls, data.status, data.started_at, data.last_active],
  );

  if (buckets.length === 0) return null;

  const height = compact ? 6 : 8;

  return (
    <div className="flex w-full items-center gap-2">
      <div
        className="flex w-14 shrink-0 items-center gap-1 text-[9px] font-mono uppercase tracking-wide text-[var(--color-fg-dim)]"
        title="Session lifecycle state across time"
      >
        <svg
          width={10}
          height={10}
          viewBox="0 0 10 10"
          aria-hidden="true"
          className="shrink-0"
        >
          <circle cx={5} cy={5} r={3.5} fill="currentColor" />
          <circle cx={5} cy={5} r={1.5} fill="var(--color-bg-elev, var(--color-bg))" />
        </svg>
        <span>status</span>
      </div>
      <div
        className="flex flex-1 min-w-0 gap-px rounded-[var(--radius-sm)] overflow-hidden border border-[var(--color-border)]"
        role="img"
        aria-label={`Session status ribbon across ${buckets.length} time buckets`}
        title={`Status ribbon · ${buckets.length} buckets`}
      >
        {buckets.map((b, i) => {
          const startLabel = shortTime(new Date(b.start).toISOString());
          const endLabel = shortTime(new Date(b.end).toISOString());
          const isWaiting = b.state === "waiting_for_user";
          return (
            <div
              key={i}
              className={cn("flex-1 transition-colors", isWaiting && "relay-attention")}
              style={{ height, backgroundColor: getStateColor(b.state) }}
              title={`${startLabel} – ${endLabel}: ${labelFor(b.state)}${
                b.count > 0 ? ` · ${b.count} event${b.count === 1 ? "" : "s"}` : ""
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
