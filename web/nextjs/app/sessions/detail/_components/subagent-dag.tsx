"use client";

import { useMemo } from "react";
import type { SessionStatus, SessionSummary, SessionToolCall } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getStateColor } from "../_lib/colors";
import { computeSubagentDag, type SpawnNode } from "../_lib/subagent-dag";

const VB_HEIGHT = 200;
const PARENT_Y = 28;
const CHILD_Y = 150;
const PARENT_X = 360;
const NODE_PAD_X = 56;
const NODE_W = 96;
const NODE_H = 38;

function statusColor(s: SessionStatus | undefined): string {
  return s ? getStateColor(s) : "var(--color-fg-dim)";
}

interface DagViewProps {
  childrenSessions: SessionSummary[];
  toolCalls: SessionToolCall[];
  parentId: string;
  loading?: boolean;
  error?: string | null;
  onOpenChild?: (child: SessionSummary) => void;
  compact?: boolean;
}

export function SubagentDag({
  childrenSessions,
  toolCalls,
  parentId,
  loading = false,
  error = null,
  onOpenChild,
  compact = false,
}: DagViewProps) {
  const model = useMemo(
    () => computeSubagentDag(parentId, toolCalls, childrenSessions),
    [parentId, toolCalls, childrenSessions],
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
  if (childrenSessions.length === 0 && model.spawnNodes.length === 0) {
    return (
      <div className={cn("font-mono text-[11px] text-[var(--color-fg-dim)]", compact ? "py-2" : "py-3")}>
        no subagents
      </div>
    );
  }

  // Lay out spawn nodes horizontally by TaskCreate timestamp; orphans (no
  // spawn record) get appended after the rightmost ts so they stay visible.
  const spawnTs = model.spawnNodes.map((s) => s.ts);
  const minTs = spawnTs.length > 0 ? Math.min(...spawnTs) : 0;
  const maxTs = spawnTs.length > 0 ? Math.max(...spawnTs) : 1;
  const span = Math.max(1, maxTs - minTs);

  type Slot = {
    key: string;
    x: number;
    spawn: SpawnNode | null;
    child: SessionSummary | null;
  };

  const slots: Slot[] = [];

  model.spawnNodes.forEach((s, idx) => {
    const child = s.childId
      ? model.children.find((c) => c.id === s.childId) ?? null
      : null;
    const x =
      span === 0
        ? NODE_PAD_X + idx * (NODE_W + 16)
        : NODE_PAD_X + ((s.ts - minTs) / span) * 480;
    slots.push({ key: `spawn-${idx}`, x, spawn: s, child });
  });

  // Append orphan children to the right side, evenly spaced.
  model.unmatchedChildren.forEach((c, idx) => {
    const baseX = slots.length > 0 ? Math.max(...slots.map((s) => s.x)) + NODE_W : NODE_PAD_X;
    slots.push({
      key: `orphan-${c.id}`,
      x: baseX + idx * (NODE_W + 16),
      spawn: null,
      child: c,
    });
  });

  // De-overlap by enforcing a minimum horizontal gap.
  slots.sort((a, b) => a.x - b.x);
  for (let i = 1; i < slots.length; i++) {
    const prev = slots[i - 1];
    const cur = slots[i];
    if (!prev || !cur) continue;
    const minNext = prev.x + NODE_W + 16;
    if (cur.x < minNext) cur.x = minNext;
  }

  const rightmost = slots.length > 0 ? (slots[slots.length - 1]?.x ?? PARENT_X) : PARENT_X;
  const vbWidth = Math.max(720, rightmost + NODE_W + NODE_PAD_X);

  const handleClick = (child: SessionSummary | null) => {
    if (child && onOpenChild) onOpenChild(child);
  };

  return (
    <div className={cn("w-full", compact ? "py-1" : "py-2")} style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${vbWidth} ${VB_HEIGHT}`}
        preserveAspectRatio="xMinYMid meet"
        width={vbWidth}
        height={VB_HEIGHT}
        role="img"
        aria-label="Subagent spawn DAG"
        style={{ display: "block", minWidth: "100%" }}
      >
        <defs>
          <marker
            id="dag-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-fg-muted)" />
          </marker>
        </defs>

        <rect
          x={0}
          y={0}
          width={vbWidth}
          height={VB_HEIGHT}
          fill="var(--color-bg-elev)"
          stroke="var(--color-border)"
        />

        {/* Parent node centered above */}
        <g>
          <rect
            x={(vbWidth - NODE_W) / 2}
            y={PARENT_Y - NODE_H / 2}
            width={NODE_W}
            height={NODE_H}
            rx={6}
            fill="color-mix(in srgb, var(--color-accent) 18%, var(--color-bg))"
            stroke="var(--color-accent)"
          />
          <text
            x={vbWidth / 2}
            y={PARENT_Y - 2}
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize={10}
            fill="var(--color-fg)"
          >
            parent
          </text>
          <text
            x={vbWidth / 2}
            y={PARENT_Y + 12}
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize={9}
            fill="var(--color-fg-muted)"
          >
            {parentId.slice(0, 8)}
          </text>
        </g>

        {/* Edges parent → child */}
        {slots.map((slot) => {
          const cx = slot.x + NODE_W / 2;
          const sx = vbWidth / 2;
          const sy = PARENT_Y + NODE_H / 2;
          const ey = CHILD_Y - NODE_H / 2;
          const my = (sy + ey) / 2;
          const d = `M ${sx} ${sy} C ${sx} ${my}, ${cx} ${my}, ${cx} ${ey}`;
          const color = statusColor(slot.child?.status);
          return (
            <path
              key={`edge-${slot.key}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={1.25}
              opacity={0.65}
              markerEnd="url(#dag-arrow)"
            />
          );
        })}

        {/* Child / spawn nodes */}
        {slots.map((slot) => {
          const x = slot.x;
          const child = slot.child;
          const status = child?.status;
          const color = statusColor(status);
          const label = child?.agent_id ?? child?.id.slice(0, 8) ?? slot.spawn?.subagent ?? "spawn";
          const sub = slot.spawn?.description ?? "";
          const msgCount = child ? child.message_count : null;
          const isWaiting = status === "waiting_for_user";
          const clickable = !!child;
          return (
            <g
              key={`node-${slot.key}`}
              style={{ cursor: clickable ? "pointer" : "default" }}
              onClick={() => handleClick(child)}
            >
              <rect
                x={x}
                y={CHILD_Y - NODE_H / 2}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={`color-mix(in srgb, ${color} 14%, var(--color-bg))`}
                stroke={color}
                className={cn(isWaiting && "relay-attention")}
              >
                <title>
                  {child
                    ? `${label} · ${status ?? "unknown"} · ${child.message_count} msg`
                    : `spawn: ${slot.spawn?.subagent ?? "?"}${sub ? `\n${sub}` : ""}`}
                </title>
              </rect>
              <circle
                cx={x + 8}
                cy={CHILD_Y - NODE_H / 2 + 8}
                r={3}
                fill={color}
              />
              <text
                x={x + NODE_W / 2}
                y={CHILD_Y - 2}
                textAnchor="middle"
                fontFamily="ui-monospace, monospace"
                fontSize={10}
                fill="var(--color-fg)"
              >
                {label.length > 12 ? label.slice(0, 11) + "…" : label}
              </text>
              <text
                x={x + NODE_W / 2}
                y={CHILD_Y + 12}
                textAnchor="middle"
                fontFamily="ui-monospace, monospace"
                fontSize={9}
                fill="var(--color-fg-muted)"
              >
                {msgCount !== null ? `${msgCount} msg` : "(spawn only)"}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
