"use client";

import {
  AlertTriangle,
  Check,
  MessageSquare,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useFleetStream } from "../_hooks/use-fleet-stream";
import {
  buildActivityEvents,
  type FleetEvent,
} from "../_lib/fleet-activity";
import { sessionKey, statusColor } from "../_lib/fleet-timeline";
import type { TileSpec } from "../_types";

interface Props {
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
}

export function FleetActivityFeed({ selectedKeys, onPickSession, canAdd }: Props) {
  const { sessions, status: streamStatus, error } = useFleetStream({
    lookbackDays: 7,
    limit: 200,
  });
  const [repoFilter, setRepoFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<FleetEvent["kind"] | "all">("all");

  const events = useMemo(
    () => (sessions ? buildActivityEvents(sessions) : []),
    [sessions],
  );
  const repos = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.repo) set.add(e.repo);
    return [...set].sort();
  }, [events]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (repoFilter && e.repo !== repoFilter) return false;
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      return true;
    });
  }, [events, repoFilter, kindFilter]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-2 flex items-center gap-2 flex-wrap text-[11px] font-mono text-[var(--color-fg-dim)] border-b border-[var(--color-border)]">
        <span>{filtered.length} events</span>
        <StreamPill status={streamStatus} />
        <span className="text-[var(--color-fg-dim)]">·</span>
        <select
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
          className="bg-transparent border border-[var(--color-border)] rounded-[var(--radius-sm)] px-1 h-6"
        >
          <option value="">all repos</option>
          {repos.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          {(["all", "message", "waiting", "ended", "spawn", "interrupted"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKindFilter(k)}
              aria-pressed={kindFilter === k}
              className={cn(
                "px-1.5 h-5 rounded-[var(--radius-sm)] border",
                kindFilter === k
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-2">
        {error && (
          <div className="text-[12px] text-[var(--color-danger,#dc2626)] py-2">
            feed load failed: {error}
          </div>
        )}
        {!error && sessions === null && (
          <div className="text-[12px] text-[var(--color-fg-dim)] py-2">loading…</div>
        )}
        {!error && sessions !== null && filtered.length === 0 && (
          <div className="text-[12px] text-[var(--color-fg-dim)] py-2">
            no events to show.
          </div>
        )}
        <ul className="divide-y divide-[var(--color-border)]">
          {filtered.map((e, i) => {
            const key = sessionKey({ type: e.sessionType, id: e.sessionId });
            const selected = selectedKeys.has(key);
            const disabled = !canAdd && !selected;
            return (
              <li key={`${e.ts}-${key}-${e.kind}-${i}`}>
                <button
                  type="button"
                  onClick={() =>
                    onPickSession({ type: e.sessionType, id: e.sessionId })
                  }
                  disabled={disabled}
                  className={cn(
                    "w-full text-left py-2 px-1 grid grid-cols-[78px_22px_1fr] gap-x-3 items-start",
                    "hover:bg-[var(--color-bg-elevated,rgba(255,255,255,0.02))]",
                    disabled && "opacity-60 cursor-not-allowed",
                    selected && "bg-[var(--color-bg-elevated,rgba(255,255,255,0.04))]",
                  )}
                >
                  <time
                    className="text-[10.5px] font-mono text-[var(--color-fg-dim)] tabular pt-[2px]"
                    dateTime={new Date(e.ts).toISOString()}
                  >
                    {formatClock(e.ts)}
                  </time>
                  <span
                    className="pt-[2px] flex items-center justify-center"
                    style={{ color: statusColor(e.status) }}
                  >
                    <EventIcon kind={e.kind} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-mono text-[var(--color-fg-muted)]">
                      <span className="text-[var(--color-fg-dim)]">
                        {e.sessionType[0]}/
                      </span>
                      <span className={cn(selected && "text-[var(--color-accent)]")}>
                        {e.repo ?? "—"}
                      </span>
                      {e.agentId && (
                        <span className="text-[var(--color-fg-dim)]">· {e.agentId}</span>
                      )}
                      <span className="text-[var(--color-fg-dim)] ml-auto">
                        {e.kind}
                      </span>
                    </div>
                    <div className="text-[12px] text-[var(--color-fg)] mt-0.5 line-clamp-2 break-words">
                      {e.summary}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function EventIcon({ kind }: { kind: FleetEvent["kind"] }) {
  switch (kind) {
    case "waiting":
      return <AlertTriangle className="w-3.5 h-3.5" aria-hidden />;
    case "ended":
      return <Check className="w-3.5 h-3.5" aria-hidden />;
    case "interrupted":
      return <XCircle className="w-3.5 h-3.5" aria-hidden />;
    case "spawn":
      return <Sparkles className="w-3.5 h-3.5" aria-hidden />;
    default:
      return <MessageSquare className="w-3.5 h-3.5" aria-hidden />;
  }
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function StreamPill({
  status,
}: {
  status: "connecting" | "live" | "reconnecting" | "error" | "idle";
}) {
  const label = status === "live" ? "live" : status;
  const color =
    status === "live"
      ? "var(--color-accent)"
      : status === "error"
        ? "var(--color-danger,#dc2626)"
        : "var(--color-fg-dim)";
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono"
      style={{ color }}
    >
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  );
}
