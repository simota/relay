"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { ArrowDown, ArrowUp, ChevronUp, ClipboardCopy, Play, RotateCcw, Square, TerminalSquare, Trash2, X } from "lucide-react";
import { api, ApiError, type QueueItem, type QueueRunnerState, type QueueRunOutcome } from "@/lib/api";
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
  // The server-side headless runner: polled fast while it works the queue.
  const { data: runner, mutate: mutateRunner } = useSWR<QueueRunnerState>(RUNNER_KEY, () => api.queue.runner(), {
    refreshInterval: (state) => (state && isActive(state) ? 1500 : 20000),
  });
  const runnerActive = runner ? isActive(runner) : false;
  const { data: items = [], mutate } = useSWR<QueueItem[]>(QUEUE_KEY, () => api.queue.list(), {
    refreshInterval: runnerActive ? 3000 : 0,
  });
  // `relay queue run` defers items whose blockers are unfinished; say so here.
  const { data: blocked = {} } = useSWR("/api/deps/blocked", () => api.blockedMap());
  // Tasks whose latest agent run failed / was interrupted and are not queued.
  const { data: failed, mutate: mutateFailed } = useSWR("/api/queue/retry-failed", () => api.queue.failedCount());
  const failedCount = failed?.count ?? 0;
  const [retrying, setRetrying] = useState(false);

  async function retryFailed() {
    setRetrying(true);
    try {
      await api.queue.retryFailed();
      await Promise.all([mutate(), mutateFailed()]);
    } finally {
      setRetrying(false);
    }
  }

  const [runVerify, setRunVerify] = useState(true);
  const [runRetries, setRunRetries] = useState(1);
  const [runClose, setRunClose] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [showLog, setShowLog] = useState(false);

  // When a run ends, the queue / failed counts it changed are stale.
  const lastStatus = useRef<QueueRunnerState["status"] | undefined>(undefined);
  useEffect(() => {
    const status = runner?.status;
    if (lastStatus.current && isActiveStatus(lastStatus.current) && status && !isActiveStatus(status)) {
      void mutate();
      void mutateFailed();
    }
    lastStatus.current = status;
  }, [runner?.status, mutate, mutateFailed]);

  async function startRunner() {
    setStarting(true);
    setRunError(null);
    try {
      const state = await api.queue.startRunner({
        verify: runVerify,
        retries: runRetries,
        close_on_success: runClose,
        continue_on_error: true,
      });
      await mutateRunner(state);
    } catch (error) {
      setRunError(error instanceof ApiError || error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  async function stopRunner() {
    try {
      const state = await api.queue.stopRunner();
      await mutateRunner(state);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  }

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
            <RunnerPanel
              runner={runner}
              itemCount={items.length}
              headlessReady={headlessReady}
              verify={runVerify}
              retries={runRetries}
              closeOnSuccess={runClose}
              onVerify={setRunVerify}
              onRetries={setRunRetries}
              onCloseOnSuccess={setRunClose}
              onStart={() => { void startRunner(); }}
              starting={starting}
              error={runError}
              showLog={showLog}
              onToggleLog={() => setShowLog((v) => !v)}
            />
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
          {runner && runnerActive && (
            <>
              <span className="hidden sm:inline text-[11px] text-[var(--color-cool)] tabular max-w-[28vw] truncate" role="status" aria-live="polite">
                {runner.status === "stopping" ? "stopping after " : "running "}
                {runner.current ? `#${runner.current.task_id} ${runner.current.title}` : "…"}
                {" · "}
                {formatNumber(runner.outcomes.length)} done
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={runner.status === "stopping"}
                onClick={() => { void stopRunner(); }}
                title="Stop after the task that is running now"
              >
                <Square className="h-3.5 w-3.5" />
                stop
              </Button>
            </>
          )}
          {runner && !runnerActive && runner.can_start && !runner.external && headlessReady > 0 && (
            <Button
              type="button"
              size="sm"
              onClick={() => setExpanded(true)}
              title="Run the queue unattended from here (headless, with verify / retry options)"
            >
              <Play className="h-3.5 w-3.5" />
              run…
            </Button>
          )}
          {failedCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={retrying}
              onClick={() => { void retryFailed(); }}
              title={`Queue the ${formatNumber(failedCount)} open task(s) whose latest agent run failed (relay queue add --failed)`}
              className="text-[var(--color-warm)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {retrying ? "queuing…" : `retry ${formatNumber(failedCount)} failed`}
            </Button>
          )}
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
const RUNNER_KEY = "/api/queue/runner";

function isActiveStatus(status: QueueRunnerState["status"]): boolean {
  return status === "running" || status === "stopping";
}

function isActive(state: QueueRunnerState): boolean {
  return isActiveStatus(state.status);
}

interface RunnerPanelProps {
  runner: QueueRunnerState | undefined;
  itemCount: number;
  headlessReady: number;
  verify: boolean;
  retries: number;
  closeOnSuccess: boolean;
  onVerify: (value: boolean) => void;
  onRetries: (value: number) => void;
  onCloseOnSuccess: (value: boolean) => void;
  onStart: () => void;
  starting: boolean;
  error: string | null;
  showLog: boolean;
  onToggleLog: () => void;
}

/** Start options + live progress of the server-side headless queue run. */
function RunnerPanel(props: RunnerPanelProps) {
  const { runner, itemCount, headlessReady } = props;
  if (!runner) return null;
  const active = isActive(runner);
  const hasResult = runner.outcomes.length > 0 || runner.status === "error";
  const canStart = runner.can_start && !runner.external && !active && headlessReady > 0 && itemCount > 0;
  return (
    <section aria-label="Headless queue run" className="pb-2 mb-1 border-b border-[var(--color-border)] space-y-1.5">
      {!active && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
          <span className="font-medium text-[var(--color-fg)]">Run headless here</span>
          <label className="inline-flex items-center gap-1 text-[var(--color-fg-muted)]">
            <input type="checkbox" checked={props.verify} onChange={(e) => props.onVerify(e.target.checked)} />
            verify gate
          </label>
          <label className="inline-flex items-center gap-1 text-[var(--color-fg-muted)]">
            retries
            <select
              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-[var(--radius)] px-1 text-[12px]"
              value={props.retries}
              onChange={(e) => props.onRetries(Number(e.target.value))}
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1 text-[var(--color-fg-muted)]">
            <input type="checkbox" checked={props.closeOnSuccess} onChange={(e) => props.onCloseOnSuccess(e.target.checked)} />
            close on success
          </label>
          <Button type="button" size="sm" disabled={!canStart || props.starting} onClick={props.onStart}>
            <Play className="h-3.5 w-3.5" />
            {props.starting ? "starting…" : `start (${formatNumber(headlessReady)})`}
          </Button>
          {!runner.can_start && (
            <span className="text-[11px] text-[var(--color-fg-dim)]">agent runs can only be started from the machine running relay web</span>
          )}
          {runner.external && (
            <span className="text-[11px] text-[var(--color-warm)]">
              a terminal <code>relay queue run</code> (pid {runner.external.pid}) is working the queue
            </span>
          )}
        </div>
      )}
      {props.error && <p role="alert" className="text-[11px] text-[var(--color-critical)]">{props.error}</p>}
      {active && runner.current && (
        <p className="text-[12px] text-[var(--color-cool)]" role="status">
          ▶ #{runner.current.task_id} {runner.current.title}
          <span className="text-[var(--color-fg-dim)]"> · {runner.current.repo} · {runner.current.assignee}</span>
        </p>
      )}
      {hasResult && (
        <>
          <ul className="space-y-0.5 text-[12px] font-mono" aria-label="Queue run results">
            {runner.outcomes.map((outcome, index) => (
              <OutcomeRow key={`${outcome.taskId}-${index}`} outcome={outcome} />
            ))}
          </ul>
          {runner.error && <p className="text-[11px] text-[var(--color-critical)]">{runner.error}</p>}
          {!active && runner.finished_at && (
            <p className="text-[11px] text-[var(--color-fg-dim)]">
              finished {new Date(runner.finished_at).toLocaleTimeString()} — each task&apos;s agent runs show logs, changes and verify output
            </p>
          )}
        </>
      )}
      {runner.log.length > 0 && (
        <div>
          <button
            type="button"
            className="text-[11px] text-[var(--color-cool)] hover:underline ring-focus rounded-[var(--radius)]"
            aria-expanded={props.showLog}
            aria-controls="queue-runner-log"
            onClick={props.onToggleLog}
          >
            {props.showLog ? "hide output" : "show output"}
          </button>
          {props.showLog && (
            <pre
              id="queue-runner-log"
              className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)]/60 px-2 py-1 text-[11px] text-[var(--color-fg-dim)]"
            >
              {runner.log.join("\n")}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

function OutcomeRow({ outcome }: { outcome: QueueRunOutcome }) {
  const tone =
    outcome.kind === "success"
      ? "text-[var(--color-accent)]"
      : outcome.kind === "skipped"
        ? "text-[var(--color-fg-dim)]"
        : outcome.kind === "interrupted"
          ? "text-[var(--color-warm)]"
          : "text-[var(--color-critical)]";
  const mark = outcome.kind === "success" ? "✓" : outcome.kind === "skipped" ? "–" : outcome.kind === "interrupted" ? "■" : "✗";
  return (
    <li className="flex items-baseline gap-2 min-w-0">
      <span className={cn("shrink-0", tone)} aria-label={outcome.kind}>{mark}</span>
      <span className="shrink-0 text-[var(--color-fg-dim)]">#{outcome.taskId}</span>
      <span className="truncate text-[var(--color-fg)]" title={outcome.title}>{outcome.title}</span>
      {(outcome.attempts ?? 1) > 1 && (
        <span className="shrink-0 text-[11px] text-[var(--color-warm)]" title="attempts (auto-retry with feedback)">×{outcome.attempts}</span>
      )}
      {outcome.verify === "passed" && <span className="shrink-0 text-[11px] text-[var(--color-accent)]">verified</span>}
      {outcome.verify === "missing" && (
        <span className="shrink-0 text-[11px] text-[var(--color-fg-dim)]" title="no [[verify.repos]] entry or .agents/RELAY_VERIFY for this repo">unverified</span>
      )}
      {outcome.reason && outcome.kind !== "success" && (
        <span className="truncate text-[11px] text-[var(--color-fg-dim)]" title={outcome.reason}>{outcome.reason.split("\n")[0]}</span>
      )}
    </li>
  );
}
const HEADLESS_COMMAND = "relay queue run --headless";
