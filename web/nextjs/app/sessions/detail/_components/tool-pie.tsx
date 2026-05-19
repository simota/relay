"use client";

import { useMemo } from "react";
import { getToolColor } from "../_lib/colors";
import { computeToolStats, type ToolStat } from "../_lib/stats";
import type { SessionToolCall } from "@/lib/api";

/**
 * Self-contained SVG donut chart of tool usage. No legend is rendered;
 * each slice exposes its label + percentage via the `<title>` element
 * so the hover tooltip doubles as the legend. Keeps the inline footprint
 * tiny — the chart lives in the tile header next to text stats.
 *
 * When `onSelect` is provided the slices become interactive: clicking one
 * forwards the tool name (or the synthetic "other" bucket) to the caller,
 * which can route it to the tools-tab filter. Clicking the same name twice
 * is the caller's responsibility to interpret as a toggle.
 */
export function ToolPie({
  toolCalls,
  size = 28,
  compact = false,
  onSelect,
  selected,
}: {
  toolCalls: SessionToolCall[];
  size?: number;
  compact?: boolean;
  onSelect?: (name: string) => void;
  selected?: string | null;
}) {
  const stats = useMemo(() => computeToolStats(toolCalls), [toolCalls]);
  const dim = compact ? 20 : size;
  if (stats.length === 0) return null;

  const stroke = Math.max(3, Math.floor(dim / 4));
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = dim / 2;
  const cy = dim / 2;

  // dasharray sweeps each slice in sequence; dashoffset advances by the
  // cumulative length of previously drawn slices so we don't need
  // <path d="M ... A ..."> arcs for a simple ring.
  let offset = 0;
  const slices: Array<{ stat: ToolStat; len: number; dash: string; off: number }> = [];
  for (const stat of stats) {
    const len = (stat.pct / 100) * circumference;
    const dash = `${len} ${circumference - len}`;
    slices.push({ stat, len, dash, off: -offset });
    offset += len;
  }

  const interactive = typeof onSelect === "function";
  const hint = interactive ? "\nClick a slice to filter the tools tab" : "";
  const totalLabel =
    stats.map((s) => `${s.name}: ${s.count} (${s.pct.toFixed(0)}%)`).join("\n") + hint;

  return (
    <svg
      width={dim}
      height={dim}
      viewBox={`0 0 ${dim} ${dim}`}
      role="img"
      aria-label="Tool usage distribution"
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <title>{totalLabel}</title>
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={stroke}
      />
      {slices.map((s, i) => {
        const isSelected = selected != null && selected === s.stat.name;
        const isDimmed = selected != null && !isSelected;
        return (
          <circle
            key={`${s.stat.name}-${i}`}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={getToolColor(s.stat.name)}
            strokeWidth={stroke}
            strokeDasharray={s.dash}
            strokeDashoffset={s.off}
            // Start at 12 o'clock so the largest slice reads naturally.
            transform={`rotate(-90 ${cx} ${cy})`}
            onClick={interactive ? () => onSelect?.(s.stat.name) : undefined}
            style={{
              cursor: interactive ? "pointer" : undefined,
              opacity: isDimmed ? 0.35 : 1,
              transition: "opacity 120ms",
            }}
          >
            <title>
              {`${s.stat.name}: ${s.stat.count} (${s.stat.pct.toFixed(0)}%)`}
              {interactive ? "\nClick to filter tools tab" : ""}
            </title>
          </circle>
        );
      })}
    </svg>
  );
}
