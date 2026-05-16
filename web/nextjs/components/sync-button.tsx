"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Check, X, Trash2 } from "lucide-react";
import { useSWRConfig } from "swr";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SyncEvent } from "@/lib/types";

type AdapterStatus = "running" | "done" | "error";

interface AdapterProgress {
  adapter: string;
  status: AdapterStatus;
  inserted?: number;
  updated?: number;
  message?: string;
}

interface PruneInfo {
  closedCount: number;
  deletedCount: number;
  missingRepoCount: number;
}

export function SyncButton() {
  const { mutate } = useSWRConfig();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<AdapterProgress[]>([]);
  const [last, setLast] = useState<string | null>(null);
  const [pruneInfo, setPruneInfo] = useState<PruneInfo | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const pruneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    esRef.current?.close();
    if (pruneTimerRef.current !== null) clearTimeout(pruneTimerRef.current);
  }, []);

  const startSync = () => {
    if (syncing) return;
    setSyncing(true);
    setProgress([]);
    setLast(null);
    setPruneInfo(null);
    if (pruneTimerRef.current !== null) {
      clearTimeout(pruneTimerRef.current);
      pruneTimerRef.current = null;
    }

    const es = new EventSource("/api/sync/stream");
    esRef.current = es;

    const upsert = (adapter: string, patch: Partial<AdapterProgress> & { status: AdapterStatus }) => {
      setProgress((rows) => {
        const i = rows.findIndex((r) => r.adapter === adapter);
        if (i === -1) return [...rows, { adapter, ...patch }];
        const next = rows.slice();
        next[i] = { ...next[i]!, ...patch };
        return next;
      });
    };

    es.addEventListener("adapter_start", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as SyncEvent;
      if (ev.type === "adapter_start") upsert(ev.adapter, { status: "running" });
    });
    es.addEventListener("adapter_done", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as SyncEvent;
      if (ev.type === "adapter_done") {
        upsert(ev.adapter, { status: "done", inserted: ev.inserted, updated: ev.updated });
      }
    });
    es.addEventListener("adapter_error", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as SyncEvent;
      if (ev.type === "adapter_error") upsert(ev.adapter, { status: "error", message: ev.message });
    });
    es.addEventListener("prune_complete", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as SyncEvent;
      if (ev.type === "prune_complete" && (ev.closedCount > 0 || ev.deletedCount > 0)) {
        setPruneInfo({
          closedCount: ev.closedCount,
          deletedCount: ev.deletedCount,
          missingRepoCount: ev.missingRepoCount,
        });
      }
    });
    es.addEventListener("done", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as SyncEvent;
      if (ev.type === "done") {
        const r = ev.report;
        setLast(`+${r.inserted} new, ${r.updated} updated${r.errors.length ? `, ${r.errors.length} errors` : ""}`);
      }
      es.close();
      esRef.current = null;
      setSyncing(false);
      mutate((key) => typeof key === "string" && key.startsWith("/api/"));
      setTimeout(() => {
        setProgress([]);
        setLast(null);
        setPruneInfo(null);
        pruneTimerRef.current = null;
      }, 6000);
    });
    es.onerror = () => {
      setLast("connection error");
      es.close();
      esRef.current = null;
      setSyncing(false);
    };
  };

  return (
    <>
      <div className="flex items-center gap-2 max-w-[640px]">
        <div className="flex items-center gap-1.5 max-w-[520px] overflow-x-auto">
          {progress.map((p) => (
            <AdapterChip key={p.adapter} progress={p} />
          ))}
          {!syncing && last && (
            <span className="text-[10.5px] font-mono text-[var(--color-fg-muted)] whitespace-nowrap">{last}</span>
          )}
        </div>
        <Button onClick={startSync} disabled={syncing} size="sm">
          <RefreshCw className={cn("w-3 h-3", syncing && "animate-spin")} />
          {syncing ? "syncing" : "sync"}
        </Button>
      </div>
      {pruneInfo && <PruneToast info={pruneInfo} onDismiss={() => setPruneInfo(null)} />}
    </>
  );
}

function AdapterChip({ progress }: { progress: AdapterProgress }) {
  const { adapter, status, inserted, updated, message } = progress;
  const tone =
    status === "done"
      ? "border-[var(--color-accent)]/40 text-[var(--color-accent)]"
      : status === "error"
        ? "border-[var(--color-critical)]/40 text-[var(--color-critical)]"
        : "border-[var(--color-border)] text-[var(--color-fg-muted)]";

  const label = label_for(adapter);
  const detail = status === "done"
    ? `+${inserted ?? 0}/${updated ?? 0}`
    : status === "error"
      ? (message ? message.slice(0, 24) : "error")
      : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10.5px] font-mono whitespace-nowrap",
        tone,
      )}
      title={message ?? `${label} ${status}`}
    >
      {status === "running" && <RefreshCw className="w-2.5 h-2.5 animate-spin" />}
      {status === "done" && <Check className="w-2.5 h-2.5" />}
      {status === "error" && <X className="w-2.5 h-2.5" />}
      <span>{label}</span>
      {detail && <span className="text-[var(--color-fg-dim)]">{detail}</span>}
    </span>
  );
}

const ADAPTER_LABELS: Record<string, string> = {
  code_todo: "code",
  github_issue: "issue",
  github_pr: "PR",
  claude_session_todo: "session",
  agents_note: ".agents",
  manual: "manual",
};

function label_for(adapter: string): string {
  return ADAPTER_LABELS[adapter] ?? adapter;
}

function PruneToast({ info, onDismiss }: { info: PruneInfo; onDismiss: () => void }) {
  const label = buildPruneLabel(info);

  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-50 w-[min(420px,calc(100vw-32px))] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3 py-2.5 shadow-[var(--shadow-pop)] motion-safe:animate-[relay-toast-enter_var(--duration-base)_var(--ease-out)]"
    >
      <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
        <Trash2 className="h-3.5 w-3.5 shrink-0 text-[var(--color-fg-muted)]" />
        <span className="min-w-0 flex-1 font-medium text-[var(--color-fg)]">{label}</span>
        <button
          type="button"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function buildPruneLabel(info: PruneInfo): string {
  const { closedCount, deletedCount, missingRepoCount } = info;
  const repoSuffix = `from ${missingRepoCount} missing repo(s)`;
  if (closedCount > 0 && deletedCount > 0) {
    return `Closed ${closedCount} open + deleted ${deletedCount} done task(s) ${repoSuffix}`;
  }
  if (closedCount > 0) {
    return `Closed ${closedCount} open task(s) ${repoSuffix}`;
  }
  return `Cleaned up ${deletedCount} done task(s) ${repoSuffix}`;
}
