"use client";

import { useMemo, useState } from "react";
import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getDensityColor, getLaneColor } from "../_lib/colors";
import { useHoverDetail } from "../_lib/hover-detail";
import {
  bandify,
  computeGridTicks,
  computeSequenceLane,
  decimateSameLaneChains,
  formatDt,
  type GridMode,
  type LaneEvent,
  type LaneId,
} from "../_lib/sequence-lane";
import { HoverDetailPanel } from "./hover-detail-panel";

const VB_WIDTH = 800;
const VB_HEIGHT = 160;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;
const PAD_X = 8;
const LANE_LABEL_WIDTH = 64;

const LANE_LABEL: Record<LaneId, string> = {
  user: "user",
  assistant: "assistant",
  tool: "tool",
  subagent: "subagent",
};

function formatHM(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function formatHMS(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function SequenceLane({
  data,
  compact = false,
  onJumpToMessage,
  onJumpToToolByQuery,
}: {
  data: SessionDetail;
  compact?: boolean;
  onJumpToMessage: (key: string) => void;
  onJumpToToolByQuery: (q: string) => void;
}) {
  const model = useMemo(
    () =>
      computeSequenceLane(data.messages, data.tool_calls, {
        status: data.status,
        startedAt: data.started_at,
        lastActive: data.last_active,
      }),
    [
      data.messages,
      data.tool_calls,
      data.status,
      data.started_at,
      data.last_active,
    ],
  );

  const { visibleSet, chains } = useMemo(() => {
    const result = decimateSameLaneChains(model.events, "tool");
    const drop = new Set<number>();
    for (const c of result.chains) {
      for (let k = c.laneStart + 1; k < c.laneEnd; k++) drop.add(k);
    }
    const visible = new Set<number>();
    for (let i = 0; i < model.events.length; i++) {
      if (!drop.has(i)) visible.add(i);
    }
    return { visibleSet: visible, chains: result.chains };
  }, [model.events]);

  const span = Math.max(1, model.end - model.start);

  const bands = useMemo(
    () => bandify(model.events, { span }),
    [model.events, span],
  );
  const maxBandCount = bands.reduce((m, b) => (b.count > m ? b.count : m), 0);

  const [gridMode, setGridMode] = useState<GridMode>("absolute");
  const ticks = useMemo(
    () => computeGridTicks(model.start, model.end, gridMode),
    [model.start, model.end, gridMode],
  );

  const [hoveredArrow, setHoveredArrow] = useState<number | null>(null);

  const sortedEvents = useMemo(
    () => [...model.events].sort((a, b) => a.ts - b.ts),
    [model.events],
  );
  const hover = useHoverDetail<LaneEvent>();

  if (model.events.length === 0 || model.lanes.length === 0) return null;

  const innerWidth = VB_WIDTH - PAD_X - 8;
  const innerHeight = VB_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const laneCount = model.lanes.length;
  const laneStep = innerHeight / Math.max(1, laneCount);
  const yFor = (lane: LaneId) => {
    const idx = model.lanes.indexOf(lane);
    return PAD_TOP + laneStep * idx + laneStep / 2;
  };
  const xFor = (ts: number) =>
    PAD_X + ((ts - model.start) / span) * innerWidth;

  const tsFromX = (vbX: number): number => {
    if (innerWidth <= 0) return model.start;
    const ratio = Math.max(0, Math.min(1, (vbX - PAD_X) / innerWidth));
    return model.start + ratio * span;
  };

  const findNearest = (vbX: number): LaneEvent | null => {
    if (sortedEvents.length === 0) return null;
    const targetTs = tsFromX(vbX);
    let lo = 0;
    let hi = sortedEvents.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const ev = sortedEvents[mid];
      if (!ev) break;
      if (ev.ts < targetTs) lo = mid + 1;
      else hi = mid;
    }
    const cand = sortedEvents[lo] ?? null;
    const prev = lo > 0 ? sortedEvents[lo - 1] ?? null : null;
    if (cand && prev) {
      return Math.abs(cand.ts - targetTs) <= Math.abs(prev.ts - targetTs)
        ? cand
        : prev;
    }
    return cand ?? prev;
  };

  const handleEventClick = (ev: LaneEvent) => {
    if (ev.lane === "tool" || ev.lane === "subagent") {
      const q = ev.toolName ?? ev.preview.split(" ")[0] ?? "";
      if (q) onJumpToToolByQuery(q);
    } else {
      onJumpToMessage(ev.key);
    }
  };

  const hoverArrow =
    hoveredArrow !== null ? model.arrows[hoveredArrow] ?? null : null;
  const hoverFrom = hoverArrow ? model.events[hoverArrow.from] ?? null : null;
  const hoverTo = hoverArrow ? model.events[hoverArrow.to] ?? null : null;
  const hoverEvent = hover.hover.item;
  const hoverX = hover.hover.x;

  return (
    <div className={cn("w-full", compact ? "pt-2" : "pt-3")}>
      <div className="flex items-center justify-end pb-1.5 min-h-7">
        <button
          type="button"
          onClick={() =>
            setGridMode((m) => (m === "absolute" ? "relative" : "absolute"))
          }
          className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:border-[var(--color-fg-muted)] transition-colors"
          aria-label={`Switch to ${gridMode === "absolute" ? "relative" : "absolute"} time`}
          title={`Switch to ${gridMode === "absolute" ? "relative" : "absolute"} time`}
        >
          {gridMode}
        </button>
      </div>
      <div
        className="flex items-stretch w-full"
        style={{ aspectRatio: `${VB_WIDTH} / ${VB_HEIGHT}` }}
      >
        <div
          className="flex flex-col justify-around shrink-0 pr-1.5"
          style={{
            paddingTop: `${(PAD_TOP / VB_WIDTH) * 100}%`,
            paddingBottom: `${(PAD_BOTTOM / VB_WIDTH) * 100}%`,
            width: `${(LANE_LABEL_WIDTH / VB_WIDTH) * 100}%`,
          }}
          aria-hidden
        >
          {model.lanes.map((lane) => (
            <span
              key={`lane-label-${lane}`}
              className="text-[10px] font-mono text-[var(--color-fg-muted)] text-right leading-none"
            >
              {LANE_LABEL[lane]}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          height="100%"
          role="img"
          aria-label="Session sequence lane diagram"
          style={{ display: "block", flex: 1, minWidth: 0 }}
          onMouseMove={(e) => hover.onSvgMouseMove(e, VB_WIDTH, findNearest)}
          onMouseLeave={hover.onSvgMouseLeave}
        >
          <defs>
            <marker
              id="lane-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>

          <rect
            x={0}
            y={0}
            width={VB_WIDTH}
            height={VB_HEIGHT}
            fill="var(--color-bg-elev)"
            stroke="var(--color-border)"
            vectorEffect="non-scaling-stroke"
          />

          {model.waitingRanges.map((w, i) => {
            const x1 = xFor(w.start);
            const x2 = xFor(w.end);
            return (
              <rect
                key={`wait-${i}`}
                x={x1}
                y={PAD_TOP}
                width={Math.max(1, x2 - x1)}
                height={innerHeight}
                fill="color-mix(in srgb, var(--color-warm) 18%, transparent)"
              >
                <title>{`waiting for user · ${formatHM(w.start)} – ${formatHM(w.end)}`}</title>
              </rect>
            );
          })}

          {ticks.map((tk, i) => {
            const x = xFor(tk.ts);
            return (
              <g key={`tick-${i}`}>
                <line
                  x1={x}
                  y1={PAD_TOP}
                  x2={x}
                  y2={VB_HEIGHT - PAD_BOTTOM}
                  stroke="var(--color-border)"
                  strokeDasharray="1 4"
                  opacity={0.7}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={x}
                  y={VB_HEIGHT - 8}
                  textAnchor="middle"
                  fontFamily="ui-monospace, monospace"
                  fontSize={9}
                  fill="var(--color-fg-dim)"
                >
                  {tk.label}
                </text>
              </g>
            );
          })}

          {model.lanes.map((lane) => {
            const y = yFor(lane);
            return (
              <g key={`lane-${lane}`}>
                <line
                  x1={PAD_X}
                  y1={y}
                  x2={VB_WIDTH - 8}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeDasharray="2 3"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}

          {bands.map((band, i) => {
            const base = getLaneColor(band.lane);
            const t =
              maxBandCount > 0
                ? Math.log1p(band.count) / Math.log1p(maxBandCount)
                : 0;
            const fill = getDensityColor(t, base);
            const y = yFor(band.lane);
            const ev = model.events[band.firstIdx];
            const onClick = () => {
              if (ev) handleEventClick(ev);
            };
            if (band.start === band.end) {
              const size = 8;
              return (
                <rect
                  key={`band-${i}`}
                  x={xFor(band.start) - size / 2}
                  y={y - size / 2}
                  width={size}
                  height={size}
                  rx={2}
                  ry={2}
                  fill={fill}
                  stroke="var(--color-bg)"
                  strokeWidth={0.75}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: "pointer" }}
                  onClick={onClick}
                >
                  <title>{`${band.lane} · ${formatHM(band.start)}\n${ev?.preview ?? ""}`}</title>
                </rect>
              );
            }
            const x1 = xFor(band.start);
            const x2 = xFor(band.end);
            const barH = Math.max(4, laneStep * 0.45);
            return (
              <rect
                key={`band-${i}`}
                x={x1}
                y={y - barH / 2}
                width={Math.max(2, x2 - x1)}
                height={barH}
                rx={2}
                ry={2}
                fill={fill}
                stroke="var(--color-bg)"
                strokeWidth={0.5}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "pointer" }}
                onClick={onClick}
              >
                <title>{`${band.lane} · ${band.count} events\n${formatHM(band.start)} – ${formatHM(band.end)}`}</title>
              </rect>
            );
          })}

          {chains.map((c, i) => {
            const startEv = model.events[c.laneStart];
            const endEv = model.events[c.laneEnd];
            if (!startEv || !endEv) return null;
            const x1 = xFor(startEv.ts);
            const x2 = xFor(endEv.ts);
            const y = yFor("tool");
            const bulge = Math.min(12, (x2 - x1) * 0.2);
            const dir = i % 2 === 0 ? -1 : 1;
            const midX = (x1 + x2) / 2;
            const midY = y + dir * bulge;
            const stroke = `color-mix(in srgb, ${getLaneColor("tool")} 40%, transparent)`;
            return (
              <path
                key={`chain-${i}`}
                d={`M ${x1} ${y} Q ${midX} ${midY} ${x2} ${y}`}
                fill="none"
                stroke={stroke}
                strokeWidth={1.5}
                opacity={0.85}
                pointerEvents="none"
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${c.count} tool calls · ${formatHM(startEv.ts)} – ${formatHM(endEv.ts)}`}</title>
              </path>
            );
          })}

          {model.arrows.map((a, i) => {
            const evFrom = model.events[a.from];
            const evTo = model.events[a.to];
            if (!evFrom || !evTo) return null;
            if (!visibleSet.has(a.from) || !visibleSet.has(a.to)) return null;
            const x1 = xFor(evFrom.ts);
            const y1 = yFor(evFrom.lane);
            const x2 = xFor(evTo.ts);
            const y2 = yFor(evTo.lane);
            const isSubagent =
              evFrom.lane === "subagent" || evTo.lane === "subagent";
            const stroke = getLaneColor(evFrom.lane);
            const isHovered = hoveredArrow === i;
            const dt = formatDt(a.dtMs);
            const distance = Math.hypot(x2 - x1, y2 - y1);
            return (
              <g key={`arrow-${i}`}>
                <path
                  d={`M ${x1} ${y1} L ${x2} ${y2}`}
                  stroke={stroke}
                  strokeWidth={isHovered ? 1.5 : 0.9}
                  opacity={isHovered ? 0.9 : 0.6}
                  strokeDasharray={isSubagent ? "3 2" : undefined}
                  fill="none"
                  markerEnd="url(#lane-arrow)"
                  pointerEvents="none"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth={6}
                  onMouseEnter={() => setHoveredArrow(i)}
                  onMouseLeave={() =>
                    setHoveredArrow((prev) => (prev === i ? null : prev))
                  }
                  style={{ cursor: "pointer" }}
                />
                {distance > 24 && (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 3}
                    textAnchor="middle"
                    fontFamily="ui-monospace, monospace"
                    fontSize={8}
                    fill="var(--color-fg-muted)"
                    pointerEvents="none"
                  >
                    {dt}
                  </text>
                )}
              </g>
            );
          })}

          {hoverX !== null && (
            <line
              x1={hoverX}
              y1={PAD_TOP}
              x2={hoverX}
              y2={VB_HEIGHT - PAD_BOTTOM}
              stroke="var(--color-fg-muted)"
              strokeDasharray="2 2"
              opacity={0.6}
              pointerEvents="none"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      <HoverDetailPanel
        time={
          hoverArrow
            ? formatDt(hoverArrow.dtMs)
            : hoverEvent
              ? formatHMS(hoverEvent.ts)
              : undefined
        }
        primary={
          hoverArrow && hoverFrom && hoverTo
            ? `${hoverFrom.lane} → ${hoverTo.lane}`
            : hoverEvent
              ? hoverEvent.lane
              : undefined
        }
        secondary={
          hoverArrow && hoverFrom
            ? hoverFrom.preview
            : hoverEvent
              ? hoverEvent.rawPreview
              : undefined
        }
        tertiary={
          hoverArrow && hoverTo
            ? `→ ${hoverTo.preview}`
            : hoverEvent && hoverEvent.toolName && hoverEvent.toolArgs
              ? hoverEvent.toolArgs
              : undefined
        }
      />
    </div>
  );
}
