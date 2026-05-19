"use client";

import { useMemo } from "react";
import type { SessionToolCall } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getDensityColor } from "../_lib/colors";
import { computeTransitions } from "../_lib/transitions";

function intensity(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.log1p(count) / Math.log1p(max);
}

function truncateTool(name: string, max: number): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + "…";
}

export function ToolTransitionMatrix({
  toolCalls,
  compact = false,
}: {
  toolCalls: SessionToolCall[];
  compact?: boolean;
}) {
  const { tools, matrix } = useMemo(() => computeTransitions(toolCalls), [toolCalls]);
  if (tools.length === 0) return null;

  let max = 0;
  for (const row of matrix) {
    for (const v of row) if (v > max) max = v;
  }
  if (max === 0) return null;

  const N = tools.length;
  const labelMax = compact ? 6 : 16;
  const cellH = compact ? 14 : 18;

  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[var(--color-border)] overflow-hidden",
        compact ? "mt-2 p-2" : "mt-3 p-3",
      )}
      style={{ backgroundColor: "var(--color-bg-elev)" }}
      role="img"
      aria-label="Tool transition matrix"
    >
      <div
        className={cn(
          "text-[10px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)]",
          compact ? "mb-1" : "mb-1.5",
        )}
      >
        transitions
      </div>
      <div
        className="grid gap-px"
        style={{
          gridTemplateColumns: `auto repeat(${N}, minmax(0, 1fr))`,
        }}
      >
        <div />
        {tools.map((t) => (
          <div
            key={`col-${t}`}
            className="text-[9px] font-mono text-[var(--color-fg-muted)] text-center truncate"
            title={t}
          >
            {truncateTool(t, labelMax)}
          </div>
        ))}
        {tools.map((from, i) => (
          <FragmentRow
            key={`row-${from}`}
            from={from}
            cells={matrix[i] ?? []}
            tools={tools}
            max={max}
            cellH={cellH}
            labelMax={labelMax}
          />
        ))}
      </div>
    </div>
  );
}

function FragmentRow({
  from,
  cells,
  tools,
  max,
  cellH,
  labelMax,
}: {
  from: string;
  cells: number[];
  tools: string[];
  max: number;
  cellH: number;
  labelMax: number;
}) {
  return (
    <>
      <div
        className="text-[9px] font-mono text-[var(--color-fg-muted)] pr-1 truncate flex items-center"
        title={from}
        style={{ height: cellH }}
      >
        {from.length <= labelMax ? from : from.slice(0, labelMax - 1) + "…"}
      </div>
      {tools.map((to, j) => {
        const v = cells[j] ?? 0;
        return (
          <div
            key={`cell-${from}-${to}`}
            style={{
              height: cellH,
              backgroundColor: getDensityColor(intensity(v, max)),
              border: "1px solid var(--color-border)",
            }}
            title={`${from} → ${to}: ${v}`}
          />
        );
      })}
    </>
  );
}
