"use client";

import { Activity, Home, Orbit, Rss } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import type { SessionSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useFleetStream } from "../_hooks/use-fleet-stream";
import { sessionKey } from "../_lib/fleet-timeline";
import type { TileSpec } from "../_types";
import { FleetActivityFeed } from "./fleet-activity-feed";
import { FleetHamlet } from "./fleet-hamlet";
import { FleetPulseSparklines } from "./fleet-pulse-sparklines";

// R3F + Three.js + postprocessing touch `window` / WebGL on mount, so they
// cannot render during SSR. `ssr: false` keeps the rest of the page
// server-renderable and defers ~700KB of WebGL JS to the moment the user
// actually opens the Cosmos tab.
const FleetCosmos3D = dynamic(
  () => import("./fleet-cosmos-3d").then((m) => m.FleetCosmos3D),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center text-[12px] text-[var(--color-fg-dim)]">
        loading cosmos…
      </div>
    ),
  },
);

export type FleetSubview = "feed" | "pulse" | "cosmos" | "hamlet";

export type FleetStreamStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "error"
  | "idle";

export interface FleetViewData {
  sessions: SessionSummary[];
  streamStatus: FleetStreamStatus;
  error: string | null;
}

interface Props {
  subview: FleetSubview;
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
}

export function FleetView({ subview, selectedKeys, onPickSession, canAdd }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  // Single fleet stream shared across feed/pulse/dag — no per-subview
  // EventSource churn when the user switches tabs. The filtered view
  // only includes sessions the user has open as tiles (Board selection
  // = Fleet scope).
  const { sessions: allSessions, status: streamStatus, error } = useFleetStream({
    lookbackDays: 7,
    limit: 500,
  });

  const data = useMemo<FleetViewData>(() => {
    if (!allSessions) return { sessions: [], streamStatus, error };
    const filtered = allSessions.filter((s) => selectedKeys.has(sessionKey(s)));
    return { sessions: filtered, streamStatus, error };
  }, [allSessions, streamStatus, error, selectedKeys]);

  const empty = selectedKeys.size === 0;

  const goSub = useCallback(
    (sv: FleetSubview) => {
      const next = new URLSearchParams(params.toString());
      next.set("view", "fleet");
      next.set("fv", sv);
      router.replace(`/sessions/detail?${next.toString()}`);
    },
    [params, router],
  );

  const tabs = useMemo(
    () => [
      { key: "feed" as const, label: "Feed", icon: Rss },
      { key: "pulse" as const, label: "Pulse", icon: Activity },
      { key: "cosmos" as const, label: "Cosmos", icon: Orbit },
      { key: "hamlet" as const, label: "Hamlet", icon: Home },
    ],
    [],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-1.5 flex items-center gap-1 border-b border-[var(--color-border)]">
        {tabs.map((t) => {
          const active = subview === t.key;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => goSub(t.key)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1 px-2 h-6 rounded-[var(--radius-sm)] border text-[11px] font-mono",
                active
                  ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                  : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              <Icon className="w-3 h-3" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-h-0">
        {empty ? (
          <EmptyScope />
        ) : (
          <>
            {subview === "feed" && (
              <FleetActivityFeed
                data={data}
                selectedKeys={selectedKeys}
                onPickSession={onPickSession}
                canAdd={canAdd}
              />
            )}
            {subview === "pulse" && (
              <FleetPulseSparklines
                data={data}
                selectedKeys={selectedKeys}
                onPickSession={onPickSession}
                canAdd={canAdd}
              />
            )}
            {subview === "cosmos" && (
              <FleetCosmos3D
                data={data}
                selectedKeys={selectedKeys}
                onPickSession={onPickSession}
                canAdd={canAdd}
              />
            )}
            {subview === "hamlet" && (
              <FleetHamlet
                data={data}
                selectedKeys={selectedKeys}
                onPickSession={onPickSession}
                canAdd={canAdd}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyScope() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
      <div className="text-[13px] text-[var(--color-fg-muted)]">
        No sessions in scope.
      </div>
      <div className="text-[11px] text-[var(--color-fg-dim)] max-w-sm">
        Open one or more sessions as tiles in the <span className="font-mono">Board</span> tab.
        The Fleet view shows only what you have selected.
      </div>
    </div>
  );
}
