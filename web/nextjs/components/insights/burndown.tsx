"use client";

import { useState } from "react";
import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { BurndownResponse } from "@/lib/types";

const SVG_W = 560;
const SVG_H = 140;
const PAD_L = 28;
const PAD_R = 8;
const PAD_T = 8;
const PAD_B = 20;
const CHART_W = SVG_W - PAD_L - PAD_R;
const CHART_H = SVG_H - PAD_T - PAD_B;

interface TooltipState {
  x: number;
  y: number;
  date: string;
  open: number;
  in_progress: number;
}

function buildPolyline(
  rows: BurndownResponse["rows"],
  key: "open" | "in_progress",
  maxY: number,
): string {
  if (rows.length === 0 || maxY === 0) return "";
  return rows
    .map((r, i) => {
      const x = PAD_L + (i / (rows.length - 1)) * CHART_W;
      const y = PAD_T + CHART_H - (r[key] / maxY) * CHART_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function BurndownChart({ days = 30 }: { days?: number }) {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<BurndownResponse>(
    ["insights.burndown", days],
    () => api.insights.burndown(days),
    { refreshInterval: 60_000, revalidateOnFocus: false },
  );
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const variant = stateVariantFromError(error, online);
  const rows = data?.rows ?? [];
  const maxY = rows.reduce((acc, r) => Math.max(acc, r.open + r.in_progress), 0) || 1;

  const openPoly = buildPolyline(rows, "open", maxY);
  const ipPoly = buildPolyline(rows, "in_progress", maxY);

  // Y-axis tick labels (top, mid, bottom)
  const yTicks = [maxY, Math.round(maxY / 2), 0];

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>Burndown</CardTitle>
        {!isLoading && !variant && rows.length > 0 && (
          <span className="text-[11px] tabular font-mono text-[var(--color-fg-dim)]">
            {days}d window
          </span>
        )}
      </CardHeader>
      <CardBody>
        {isLoading && (
          <div className="h-[140px] rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />
        )}
        {variant && (
          <PageState variant={variant} hint="Could not load burndown data." action={() => mutate()} />
        )}
        {!variant && !isLoading && rows.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">No task data yet.</p>
        )}
        {!variant && rows.length > 0 && (
          <div className="space-y-2">
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              className="w-full"
              style={{ height: SVG_H }}
              onMouseLeave={() => setTooltip(null)}
            >
              {/* Y-axis ticks */}
              {yTicks.map((tick) => {
                const y = PAD_T + CHART_H - (tick / maxY) * CHART_H;
                return (
                  <g key={tick}>
                    <line
                      x1={PAD_L}
                      y1={y}
                      x2={PAD_L + CHART_W}
                      y2={y}
                      stroke="var(--color-border)"
                      strokeWidth="0.5"
                    />
                    <text
                      x={PAD_L - 4}
                      y={y + 3}
                      textAnchor="end"
                      fontSize="9"
                      fill="var(--color-fg-dim)"
                    >
                      {tick}
                    </text>
                  </g>
                );
              })}

              {/* in_progress area (under open) */}
              {ipPoly && (
                <polyline
                  points={ipPoly}
                  fill="none"
                  stroke="var(--color-warm)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  opacity="0.7"
                />
              )}

              {/* open line */}
              {openPoly && (
                <polyline
                  points={openPoly}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
              )}

              {/* Invisible hit targets for tooltip */}
              {rows.map((r, i) => {
                const x = PAD_L + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * CHART_W);
                return (
                  <rect
                    key={r.date}
                    x={x - CHART_W / rows.length / 2}
                    y={PAD_T}
                    width={CHART_W / rows.length}
                    height={CHART_H}
                    fill="transparent"
                    onMouseEnter={() =>
                      setTooltip({ x, y: PAD_T + 4, date: r.date, open: r.open, in_progress: r.in_progress })
                    }
                  />
                );
              })}

              {/* Tooltip */}
              {tooltip && (
                <g>
                  <line
                    x1={tooltip.x}
                    y1={PAD_T}
                    x2={tooltip.x}
                    y2={PAD_T + CHART_H}
                    stroke="var(--color-fg-dim)"
                    strokeWidth="1"
                    strokeDasharray="3 2"
                  />
                  <rect
                    x={tooltip.x > SVG_W / 2 ? tooltip.x - 100 : tooltip.x + 6}
                    y={PAD_T + 4}
                    width={96}
                    height={42}
                    rx="3"
                    fill="var(--color-bg-elev)"
                    stroke="var(--color-border)"
                    strokeWidth="1"
                  />
                  <text
                    x={tooltip.x > SVG_W / 2 ? tooltip.x - 52 : tooltip.x + 54}
                    y={PAD_T + 16}
                    textAnchor="middle"
                    fontSize="9"
                    fill="var(--color-fg-muted)"
                  >
                    {tooltip.date}
                  </text>
                  <text
                    x={tooltip.x > SVG_W / 2 ? tooltip.x - 52 : tooltip.x + 54}
                    y={PAD_T + 28}
                    textAnchor="middle"
                    fontSize="9"
                    fill="var(--color-accent)"
                  >
                    open: {tooltip.open}
                  </text>
                  <text
                    x={tooltip.x > SVG_W / 2 ? tooltip.x - 52 : tooltip.x + 54}
                    y={PAD_T + 40}
                    textAnchor="middle"
                    fontSize="9"
                    fill="var(--color-warm)"
                  >
                    in_progress: {tooltip.in_progress}
                  </text>
                </g>
              )}

              {/* X-axis: first and last date labels */}
              {rows.length > 0 && (
                <>
                  <text
                    x={PAD_L}
                    y={SVG_H - 4}
                    fontSize="9"
                    fill="var(--color-fg-dim)"
                  >
                    {rows[0]?.date}
                  </text>
                  <text
                    x={PAD_L + CHART_W}
                    y={SVG_H - 4}
                    textAnchor="end"
                    fontSize="9"
                    fill="var(--color-fg-dim)"
                  >
                    {rows[rows.length - 1]?.date}
                  </text>
                </>
              )}
            </svg>

            <div className="flex items-center gap-4 text-[10px] font-mono text-[var(--color-fg-dim)]">
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-[var(--color-accent)]" /> open
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-sm bg-[var(--color-warm)]" /> in_progress
              </span>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
