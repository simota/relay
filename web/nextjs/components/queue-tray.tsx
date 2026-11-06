"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowDown, ArrowUp, ChevronUp, ClipboardCopy, TerminalSquare, Trash2, X } from "lucide-react";
import { api, type QueueItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";

const QUEUE_KEY = "/api/queue";

export function QueueTray() {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<"run" | "headless" | null>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trayRef, expanded);
  const { data: items = [], mutate } = useSWR<QueueItem[]>(QUEUE_KEY, () => api.queue.list());
  // `relay queue run` defers items whose blockers are unfinished; say so here.
  const { data: blocked = {} } = useSWR("/api/deps/blocked", () => api.blockedMap());

  // Agents with a headless mode; the rest only run interactively.
  const headlessReady = useMemo(
    () => items.filter((item) => item.assignee === "claude-code" || item.assignee === "codex").length,
    [items],
  );

  async function copy(kind: "run" | "headless") {
    if (items.length === 0) return;
    await navigator.clipboard.writeText(kind === "run" ? RUN_COMMAND : HEADLESS_COMMAND);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1200);
  }

  async function remove(id: number) {
    await api.queue.remove(id);
    await mutate();
  }

  async function move(id: number, direction: "up" | "down") {
    await api.queue.move(id, direction);
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
          id="queue-tray-panel"
          role="region"
          aria-label={c("queue.tray")}
          className="max-h-[280px] overflow-y-auto border-b border-[var(--color-border)] bg-[var(--color-bg-elev)]/40"
        >
          <div className="px-4 py-2 space-y-1">
            {items.length === 0 ? (
              <p className="text-[12px] text-[var(--color-fg-dim)]">{c("queue.empty")}</p>
            ) : (
              <>
                <ol className="space-y-0.5">
                  {items.map((item, index) => (
                    <li
                      key={item.id}
                      className="grid grid-cols-[24px_56px_minmax(0,1fr)_auto] md:grid-cols-[24px_56px_96px_minmax(80px,150px)_minmax(0,1fr)_auto] items-center gap-2 h-8 text-[12px]"
                    >
                      <span className="tabular text-right text-[var(--color-fg-dim)]">{index + 1}.</span>
                      <span className="font-mono text-[var(--color-fg-dim)]">#{item.task_id}</span>
                      <span className="hidden md:block font-mono text-[11px] text-[var(--color-fg-muted)] truncate">{item.assignee}</span>
                      <span className="hidden md:block font-mono text-[var(--color-cool)] truncate">{item.repo}</span>
                      <span className="truncate text-[var(--color-fg)]" title={item.title}>
                        {item.title}
                        {item.status === "done" && <span className="ml-2 text-[11px] text-[var(--color-fg-dim)]">(done — skipped)</span>}
                        {item.status !== "done" && blocked[String(item.task_id)] && (
                          <span
                            className="ml-2 text-[11px] text-[var(--color-warm)]"
                            title="queue run starts this after its blockers succeed (or skips it if they fail)"
                          >
                            ⛓ after {blocked[String(item.task_id)]!.map((id) => `#${id}`).join(" ")}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`move #${item.task_id} up`}
                          title="Move up"
                          disabled={index === 0}
                          onClick={() => { void move(item.id, "up"); }}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`move #${item.task_id} down`}
                          title="Move down"
                          disabled={index === items.length - 1}
                          onClick={() => { void move(item.id, "down"); }}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
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
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="pt-1 text-[11px] text-[var(--color-fg-dim)]">
                  Run in order from a terminal: <code>{RUN_COMMAND}</code> (interactive) or{" "}
                  <code>{HEADLESS_COMMAND}</code> (unattended, {formatNumber(headlessReady)} of{" "}
                  {formatNumber(items.length)} ready — claude-code / codex only). Successful tasks leave the queue;
                  results appear under each task&apos;s agent runs.
                </p>
              </>
            )}
          </div>
        </div>
      )}
      <div className="h-12 px-4 flex items-center justify-between gap-3">
        <button
          type="button"
          className="min-w-0 inline-flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors ring-focus rounded-[var(--radius)]"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="queue-tray-panel"
        >
          <ChevronUp className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
          <span className="font-medium text-[var(--color-fg)]">{c("queue.title")}</span>
          <span className="tabular">{c("common.items", { count: formatNumber(items.length) })}</span>
          {items.length > 0 && (
            <span className="hidden md:block truncate text-[11px] max-w-[40vw]">
              next: #{items[0]?.task_id} {items[0]?.title}
            </span>
          )}
        </button>
        <div className="shrink-0 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={items.length === 0}
            onClick={() => { void copy("run"); }}
            title={`Copy: ${RUN_COMMAND}`}
          >
            <ClipboardCopy className="h-3.5 w-3.5" />
            {copied === "run" ? c("common.copied") : "copy run"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={headlessReady === 0}
            onClick={() => { void copy("headless"); }}
            title={`Copy: ${HEADLESS_COMMAND}`}
          >
            <TerminalSquare className="h-3.5 w-3.5" />
            {copied === "headless" ? c("common.copied") : "headless"}
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

const RUN_COMMAND = "relay queue run";
const HEADLESS_COMMAND = "relay queue run --headless";
