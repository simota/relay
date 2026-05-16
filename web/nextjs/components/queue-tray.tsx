"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ChevronUp, ClipboardCopy, Trash2, X } from "lucide-react";
import { api, type QueueItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";

const QUEUE_KEY = "/api/queue";

export function QueueTray() {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trayRef, expanded);
  const { data: items = [], mutate } = useSWR<QueueItem[]>(QUEUE_KEY, () => api.queue.list());

  const snippet = useMemo(() => buildSnippet(items), [items]);

  async function copyAll() {
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  async function remove(id: number) {
    await api.queue.remove(id);
    await mutate();
  }

  async function clear() {
    await api.queue.clear();
    await mutate();
    setExpanded(false);
  }

  useEffect(() => {
    if (!expanded) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      setExpanded(false);
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [expanded]);

  return (
    <footer className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg)]">
      {expanded && (
        <div
          ref={trayRef}
          role="dialog"
          aria-modal="true"
          aria-label={c("queue.tray")}
          className="max-h-[240px] overflow-y-auto border-b border-[var(--color-border)] bg-[var(--color-bg-elev)]/40"
        >
          <div className="px-4 py-2 space-y-1">
            {items.length === 0 ? (
              <p className="text-[12px] text-[var(--color-fg-dim)]">{c("queue.empty")}</p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[64px_minmax(120px,180px)_minmax(0,1fr)_32px] items-center gap-2 h-8 text-[12px]"
                >
                  <span className="font-mono text-[var(--color-fg-dim)]">#{item.task_id}</span>
                  <span className="font-mono text-[var(--color-cool)] truncate">{item.repo}</span>
                  <code className="truncate text-[11.5px] text-[var(--color-fg-muted)]">
                    {commandFor(item)}
                  </code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={c("queue.removeTask", { id: item.task_id })}
                    title={c("common.remove")}
                    onClick={() => { void remove(item.id); }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      <div className="h-12 px-4 flex items-center justify-between gap-3">
        <button
          type="button"
          className="min-w-0 inline-flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <ChevronUp className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          <span className="font-medium text-[var(--color-fg)]">{c("queue.title")}</span>
          <span className="tabular">{c("common.items", { count: formatNumber(items.length) })}</span>
          {snippet && <code className="hidden md:block truncate text-[11px] max-w-[52vw]">{snippet}</code>}
        </button>
        <div className="shrink-0 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!snippet}
            onClick={() => { void copyAll(); }}
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            {copied ? c("common.copied") : c("common.copyAll")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={items.length === 0}
            onClick={() => { void clear(); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {c("common.clear")}
          </Button>
        </div>
      </div>
    </footer>
  );
}

function buildSnippet(items: QueueItem[]): string {
  return items.map(commandFor).join(" && ");
}

function commandFor(item: QueueItem): string {
  return `cd ${shellQuote(item.repo)} && relay run ${item.task_id}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
