"use client";

import type { SessionType } from "@/lib/api";
import { c } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { useSessionStream } from "../_hooks/use-session-stream";
import type { StreamStatus, TileSpec } from "../_types";
import { SessionTileView } from "./session-tile-view";

// ---------------------------------------------------------------------------
// SessionTile — one session's subscription + view
// ---------------------------------------------------------------------------
export function SessionTile({
  type,
  id,
  tileIndex,
  onClose,
  showClose,
  onReplaceTile,
  onAddSubagents,
  currentTileCount,
}: {
  type: SessionType;
  id: string;
  tileIndex: number;
  onClose: () => void;
  showClose: boolean;
  onReplaceTile: (index: number, spec: TileSpec) => void;
  onAddSubagents: (agentIds: string[], type: SessionType) => void;
  currentTileCount: number;
}) {
  const { data, status, error, freshMessageKeys } = useSessionStream(type, id);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {status === "connecting" && !data && (
        <div className="p-4 text-[13px] text-[var(--color-fg-dim)]">{c("common.loading")}</div>
      )}
      {error && (
        <div className="px-4 py-2 text-[12px] text-[var(--color-warn,var(--color-accent))]">
          {error}
        </div>
      )}
      {data && (
        <SessionTileView
          data={data}
          streamStatus={status}
          freshMessageKeys={freshMessageKeys}
          onClose={showClose ? onClose : undefined}
          tileIndex={tileIndex}
          onReplaceTile={onReplaceTile}
          onAddSubagents={onAddSubagents}
          currentTileCount={currentTileCount}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StreamStatusBadge
// ---------------------------------------------------------------------------
export function StreamStatusBadge({ status }: { status: StreamStatus }) {
  const config: Record<StreamStatus, { label: string; color: string; pulse: boolean }> = {
    idle: { label: "idle", color: "var(--color-fg-dim)", pulse: false },
    connecting: { label: "connecting", color: "var(--color-fg-muted)", pulse: true },
    live: { label: "live", color: "var(--color-accent)", pulse: true },
    reconnecting: {
      label: "reconnecting",
      color: "var(--color-warn, var(--color-fg-muted))",
      pulse: true,
    },
    error: { label: "offline", color: "var(--color-fg-dim)", pulse: false },
  };
  const cfg = config[status];
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] font-mono uppercase tracking-wider"
      style={{ color: cfg.color }}
      title={`stream: ${status}`}
    >
      <span
        className={cn("w-1.5 h-1.5 rounded-full", cfg.pulse && "animate-pulse")}
        style={{ backgroundColor: cfg.color }}
      />
      {cfg.label}
    </span>
  );
}
