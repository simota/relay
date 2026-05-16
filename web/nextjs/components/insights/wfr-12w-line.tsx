"use client";

import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { api } from "@/lib/api";
import { c } from "@/lib/copy";
import type { WfrResponse } from "@/lib/types";

interface Wfr12wLineProps {
  enabled: boolean;
}

const WIDTH = 360;
const HEIGHT = 80;
const PADDING_X = 6;
const PADDING_Y = 8;

export function Wfr12wLine({ enabled }: Wfr12wLineProps) {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<WfrResponse>(
    enabled ? "insights.wfr.12w" : null,
    () => api.insights.wfr("12w"),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const weeks = data?.weeks ?? [];
  const values = weeks.map((w) => w.wfr);

  if (!enabled) return null;

  return (
    <div
      className="mt-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/40 p-3"
      aria-live="polite"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
          {c("page.insights.w18.title")}
        </span>
        {!isLoading && !variant && values.length > 0 && (
          <span className="text-[11px] tabular text-[var(--color-fg-dim)] font-mono">
            {weeks[0]?.wk} → {weeks[weeks.length - 1]?.wk}
          </span>
        )}
      </div>
      {isLoading && (
        <div className="h-[80px] rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />
      )}
      {variant && <PageState variant={variant} hint={c("page.insights.error.hint")} action={() => mutate()} />}
      {!variant && !isLoading && values.length < 3 && (
        <p className="text-[12px] text-[var(--color-fg-dim)]">{c("page.insights.w18.empty")}</p>
      )}
      {!variant && values.length >= 3 && <Line values={values} />}
    </div>
  );
}

function Line({ values }: { values: number[] }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = (WIDTH - PADDING_X * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = PADDING_X + i * stepX;
    const y = HEIGHT - PADDING_Y - ((v - min) / range) * (HEIGHT - PADDING_Y * 2);
    return { x, y };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  const midY = HEIGHT - PADDING_Y - ((1 - min) / range) * (HEIGHT - PADDING_Y * 2);
  const showMidline = min <= 1 && max >= 1;
  return (
    <svg
      role="img"
      aria-label={c("page.insights.w18.aria")}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height: HEIGHT }}
    >
      {showMidline && (
        <line
          x1={PADDING_X}
          x2={WIDTH - PADDING_X}
          y1={midY}
          y2={midY}
          stroke="var(--color-border)"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
      )}
      <path
        d={path}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last.x} cy={last.y} r={2.5} fill="var(--color-accent)" />
    </svg>
  );
}
