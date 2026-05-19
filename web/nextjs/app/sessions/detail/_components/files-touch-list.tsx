"use client";

import { useMemo } from "react";
import type { SessionToolCall } from "@/lib/api";
import { cn } from "@/lib/utils";
import { getFileOpColor } from "../_lib/colors";
import { extractFileTouches } from "../_lib/file-touch";
import { truncatePath } from "../_lib/format";

const MAX_PATH = 60;

export function FilesTouchList({
  toolCalls,
  compact = false,
}: {
  toolCalls: SessionToolCall[];
  compact?: boolean;
}) {
  const rows = useMemo(() => extractFileTouches(toolCalls), [toolCalls]);
  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)] py-6 text-center">no file touches</p>
    );
  }
  return (
    <ul className={cn("space-y-1.5", compact ? "pt-2" : "pt-3")}>
      {rows.map((r) => (
        <li
          key={r.path}
          className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 flex items-center gap-2 text-[11.5px] font-mono"
        >
          <code
            className="flex-1 truncate text-[var(--color-fg)]"
            title={r.path}
          >
            {truncatePath(r.path, MAX_PATH)}
          </code>
          <BadgeGroup row={r} />
        </li>
      ))}
    </ul>
  );
}

function BadgeGroup({ row }: { row: { reads: number; writes: number; edits: number } }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {row.reads > 0 && (
        <span
          className="text-[10px] font-mono"
          style={{ color: getFileOpColor("read") }}
          title={`${row.reads} read${row.reads === 1 ? "" : "s"}`}
        >
          r×{row.reads}
        </span>
      )}
      {row.writes > 0 && (
        <span
          className="text-[10px] font-mono"
          style={{ color: getFileOpColor("write") }}
          title={`${row.writes} write${row.writes === 1 ? "" : "s"}`}
        >
          w×{row.writes}
        </span>
      )}
      {row.edits > 0 && (
        <span
          className="text-[10px] font-mono"
          style={{ color: getFileOpColor("edit") }}
          title={`${row.edits} edit${row.edits === 1 ? "" : "s"}`}
        >
          e×{row.edits}
        </span>
      )}
    </span>
  );
}
