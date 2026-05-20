"use client";

import { Activity, Rss } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import type { TileSpec } from "../_types";
import { FleetActivityFeed } from "./fleet-activity-feed";
import { FleetPulseSparklines } from "./fleet-pulse-sparklines";

export type FleetSubview = "feed" | "pulse";

interface Props {
  subview: FleetSubview;
  selectedKeys: ReadonlySet<string>;
  onPickSession: (spec: TileSpec) => void;
  canAdd: boolean;
}

export function FleetView({ subview, selectedKeys, onPickSession, canAdd }: Props) {
  const router = useRouter();
  const params = useSearchParams();

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
        {subview === "feed" && (
          <FleetActivityFeed
            selectedKeys={selectedKeys}
            onPickSession={onPickSession}
            canAdd={canAdd}
          />
        )}
        {subview === "pulse" && (
          <FleetPulseSparklines
            selectedKeys={selectedKeys}
            onPickSession={onPickSession}
            canAdd={canAdd}
          />
        )}
      </div>
    </div>
  );
}
