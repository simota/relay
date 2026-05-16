"use client";

import { useEffect, useState } from "react";
import type { SessionType } from "@/lib/api";
import { formatRelative } from "../_lib/format";

export function TypeBadge({ type }: { type: SessionType }) {
  return (
    <span className="font-mono text-[10.5px] uppercase tracking-wider px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-accent)]">
      {type}
    </span>
  );
}

export function RelativeTime({ iso }: { iso: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return <span className="text-[11px] text-[var(--color-fg-dim)]">—</span>;
  return (
    <span
      className="text-[11px] text-[var(--color-fg-muted)] font-mono"
      title={new Date(t).toLocaleString()}
    >
      {formatRelative(t, nowMs)}
    </span>
  );
}
