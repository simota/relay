"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SSE_BASE } from "@/lib/api";
import type { SyncEvent } from "@/lib/types";

interface PreviewRow {
  adapter: string;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  sampleSourceIds: string[];
}

type AdapterEvent = Extract<SyncEvent, { type: "adapter_done" }>;

export function SyncPreviewButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => () => esRef.current?.close(), []);

  const startPreview = () => {
    setOpen(true);
    setRows([]);
    setDone(false);
    setRunning(true);
    const es = new EventSource(`${SSE_BASE}/api/sync/preview`);
    esRef.current = es;
    es.addEventListener("adapter_done", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as AdapterEvent;
      setRows((prev) => [
        ...prev,
        {
          adapter: ev.adapter,
          fetched: ev.fetched,
          inserted: ev.inserted,
          updated: ev.updated,
          unchanged: ev.unchanged,
          sampleSourceIds: ev.sampleSourceIds ?? [],
        },
      ]);
    });
    es.addEventListener("done", () => {
      setDone(true);
      setRunning(false);
      es.close();
      esRef.current = null;
    });
    es.onerror = () => {
      setRunning(false);
      es.close();
      esRef.current = null;
    };
  };

  const close = () => {
    esRef.current?.close();
    esRef.current = null;
    setOpen(false);
    setRunning(false);
  };

  const totalInsert = rows.reduce((sum, r) => sum + r.inserted, 0);
  const totalUpdate = rows.reduce((sum, r) => sum + r.updated, 0);
  const totalUnchanged = rows.reduce((sum, r) => sum + r.unchanged, 0);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={startPreview}
        title="Preview sync without writing to DB"
      >
        <Eye className="w-3 h-3" />
        Preview
      </Button>
      <dialog
        ref={dialogRef}
        className="bg-[var(--color-bg-elev)] text-[var(--color-fg)] rounded-[var(--radius-md)] border border-[var(--color-border)] shadow-[var(--shadow-pop)] p-0 max-w-[680px] w-[90vw] backdrop:bg-black/40"
        onClose={() => setOpen(false)}
      >
        <div className="flex items-center justify-between px-5 h-11 border-b border-[var(--color-border)]">
          <h2 className="text-[14px] font-semibold tracking-tight">Sync preview</h2>
          <button
            type="button"
            onClick={close}
            className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          <p className="text-[12px] text-[var(--color-fg-muted)]">
            DB は変更されません。各アダプタが今 sync を実行したらどうなるかを表示します。
          </p>
          {rows.length === 0 && running && (
            <p className="text-[12px] text-[var(--color-fg-dim)]">running…</p>
          )}
          {rows.length === 0 && done && (
            <p className="text-[12px] text-[var(--color-fg-dim)]">no adapters enabled</p>
          )}
          {rows.map((r) => (
            <div
              key={r.adapter}
              className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between">
                <div className="font-mono text-[12px] font-medium">{r.adapter}</div>
                <div className="text-[11px] tabular text-[var(--color-fg-muted)]">
                  fetched <span className="text-[var(--color-fg)]">{r.fetched}</span> ·{" "}
                  would_insert <span className="text-[var(--color-accent)]">{r.inserted}</span>{" "}
                  · would_update{" "}
                  <span className="text-[var(--color-warm)]">{r.updated}</span> ·{" "}
                  unchanged{" "}
                  <span className="text-[var(--color-fg-dim)]">{r.unchanged}</span>
                </div>
              </div>
              {r.sampleSourceIds.length > 0 && (
                <div className="mt-1.5 text-[10.5px] text-[var(--color-fg-dim)] font-mono break-all">
                  sample: {r.sampleSourceIds.join(", ")}
                  {r.fetched > r.sampleSourceIds.length
                    ? ` … +${r.fetched - r.sampleSourceIds.length} more`
                    : ""}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-5 h-12 border-t border-[var(--color-border)]">
          <div className="text-[11px] tabular text-[var(--color-fg-muted)]">
            total: would_insert{" "}
            <span className="text-[var(--color-accent)]">{totalInsert}</span> ·{" "}
            would_update <span className="text-[var(--color-warm)]">{totalUpdate}</span>{" "}
            · unchanged{" "}
            <span className="text-[var(--color-fg-dim)]">{totalUnchanged}</span>
          </div>
          <Button variant="default" size="sm" onClick={close}>
            Close
          </Button>
        </div>
      </dialog>
    </>
  );
}
