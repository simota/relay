"use client";

import { useState } from "react";
import useSWR from "swr";
import { mutate as globalMutate } from "swr";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { StaleResponse } from "@/lib/types";

interface Props {
  threshold?: 7 | 14 | 30;
  onClosed?: (count: number) => void;
}

export function StaleCloseButton({ threshold = 30, onClosed }: Props) {
  const [status, setStatus] = useState<"idle" | "confirming" | "loading" | "done">("idle");
  const [closedCount, setClosedCount] = useState(0);

  // Peek at the stale count so we can show it in the confirm dialog
  const { data: staleData } = useSWR<StaleResponse>(
    `insights.stale.${threshold}`,
    () => api.insights.stale(threshold),
    { revalidateOnFocus: false },
  );
  const staleCount = staleData?.stale ?? 0;

  async function handleConfirm() {
    setStatus("loading");
    try {
      const result = await api.insights.staleClose(threshold);
      setClosedCount(result.closed);
      setStatus("done");
      onClosed?.(result.closed);
      // Refresh stale-related insights after closing
      await globalMutate((key: unknown) => {
        if (typeof key === "string") {
          return key.includes("stale") || key.includes("insights");
        }
        if (Array.isArray(key)) {
          return String(key[0]).includes("insights");
        }
        return false;
      });
    } catch {
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <span className="text-[11px] text-[var(--color-accent)] font-mono">
        Closed {closedCount} task{closedCount !== 1 ? "s" : ""}
      </span>
    );
  }

  if (status === "confirming") {
    return (
      <span className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--color-fg-muted)]">
          Close {staleCount} stale task{staleCount !== 1 ? "s" : ""}?
        </span>
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={handleConfirm}
        >
          Confirm
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setStatus("idle")}
        >
          Cancel
        </Button>
      </span>
    );
  }

  if (status === "loading") {
    return (
      <span className="text-[11px] text-[var(--color-fg-dim)] font-mono">Closing…</span>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => setStatus("confirming")}
      disabled={staleCount === 0}
      title={staleCount === 0 ? "No stale tasks to close" : `Close ${staleCount} stale tasks older than ${threshold} days`}
    >
      Close stale
    </Button>
  );
}
