"use client";

import { useMemo } from "react";
import type { SessionToolCall } from "@/lib/api";
import { cn } from "@/lib/utils";
import { extractBashCalls } from "../_lib/bash-extract";

export function BashCommandPanel({
  toolCalls,
  compact = false,
}: {
  toolCalls: SessionToolCall[];
  compact?: boolean;
}) {
  const rows = useMemo(() => extractBashCalls(toolCalls), [toolCalls]);
  if (rows.length === 0) return null;

  return (
    <ul
      className={cn(
        "rounded-[var(--radius)] border border-[var(--color-border)] divide-y divide-[var(--color-border)] overflow-hidden",
        compact ? "mt-2" : "mt-3",
      )}
      style={{ backgroundColor: "var(--color-bg-elev)" }}
    >
      {rows.map((r) => (
        <li
          key={r.command}
          className={cn(
            "flex items-start gap-2 font-mono text-[11px]",
            compact ? "px-2 py-1" : "px-3 py-1.5",
          )}
        >
          <code className="flex-1 whitespace-pre-wrap break-all text-[var(--color-fg)]">
            {r.command}
          </code>
          {r.count > 1 && (
            <span
              className="shrink-0 text-[10px] text-[var(--color-fg-muted)]"
              title={`run ${r.count} times`}
            >
              ×{r.count}
            </span>
          )}
          {r.runInBackground && (
            <span
              className="shrink-0 text-[10px] text-[var(--color-cool)]"
              title="run_in_background"
            >
              [bg]
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
