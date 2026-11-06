// Web queue runner: `relay queue run --headless` started from the browser.
//
// The queue tray used to stop at "copy this command into a terminal". The
// runner lets `relay web` work the queue itself — headless only, one runner
// per process, and the same cross-process lock as the CLI so the two never
// launch the same task. State lives in memory (the server is the only
// process that can report on its own runner); finished runs and their logs
// are in the DB / ~/.relay/runs as usual.

import { loadConfig, type Config } from "../config.js";
import { processQueue, QueueBusyError, type QueueOutcome, type QueueRunDeps } from "../commands/queue.js";
import { readQueueLock } from "./queue-lock.js";

export interface QueueRunnerStartOptions {
  verify?: boolean;
  retries?: number;
  closeOnSuccess?: boolean;
  continueOnError?: boolean;
  limit?: number;
  timeoutMin?: number;
}

export interface QueueRunnerState {
  status: "idle" | "running" | "stopping" | "finished" | "error";
  started_at: string | null;
  finished_at: string | null;
  options: QueueRunnerStartOptions | null;
  current: { task_id: number; title: string; repo: string; assignee: string; started_at: string } | null;
  outcomes: QueueOutcome[];
  /** Last lines of runner output (ANSI stripped). */
  log: string[];
  error: string | null;
}

const LOG_KEEP = 200;

function idleState(): QueueRunnerState {
  return {
    status: "idle",
    started_at: null,
    finished_at: null,
    options: null,
    current: null,
    outcomes: [],
    log: [],
    error: null,
  };
}

export interface QueueRunnerDeps {
  cfg?: () => Config;
  process?: typeof processQueue;
  execute?: QueueRunDeps["execute"];
}

export class QueueRunner {
  private state: QueueRunnerState = idleState();
  private abort: AbortController | null = null;
  private done: Promise<void> | null = null;

  constructor(private readonly deps: QueueRunnerDeps = {}) {}

  snapshot(): QueueRunnerState {
    return { ...this.state, outcomes: [...this.state.outcomes], log: [...this.state.log] };
  }

  get running(): boolean {
    return this.state.status === "running" || this.state.status === "stopping";
  }

  /** Resolves when the current run (if any) has finished. */
  wait(): Promise<void> {
    return this.done ?? Promise.resolve();
  }

  /**
   * Start working the queue in the background. Throws QueueBusyError when
   * this runner or another process (`relay queue run`) already holds it.
   */
  start(options: QueueRunnerStartOptions): QueueRunnerState {
    if (this.running) {
      throw new QueueBusyError({ pid: process.pid, owner: "web", started_at: this.state.started_at ?? "" });
    }
    const holder = readQueueLock();
    if (holder) throw new QueueBusyError(holder);
    const cfg = (this.deps.cfg ?? loadConfig)();
    const run = this.deps.process ?? processQueue;
    const abort = new AbortController();
    this.abort = abort;
    this.state = {
      ...idleState(),
      status: "running",
      started_at: new Date().toISOString(),
      options,
    };
    const log = (line: string) => {
      const clean = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
      for (const part of clean.split("\n")) {
        if (part.trim().length === 0) continue;
        this.state.log.push(part);
      }
      if (this.state.log.length > LOG_KEEP) this.state.log.splice(0, this.state.log.length - LOG_KEEP);
    };
    this.done = (async () => {
      try {
        await run(
          {
            headless: true,
            verify: options.verify,
            retries: options.retries,
            closeOnSuccess: options.closeOnSuccess,
            continueOnError: options.continueOnError,
            limit: options.limit,
            timeoutMin: options.timeoutMin,
          },
          {
            cfg,
            log,
            execute: this.deps.execute,
            signal: abort.signal,
            handleSigint: false,
            lockOwner: "web",
            onTaskStart: (info) => {
              this.state.current = {
                task_id: info.taskId,
                title: info.title,
                repo: info.repo,
                assignee: info.assignee,
                started_at: new Date().toISOString(),
              };
            },
            onTaskDone: (outcome) => {
              this.state.outcomes.push(outcome);
              if (this.state.current?.task_id === outcome.taskId) this.state.current = null;
            },
          },
        );
        this.state.status = "finished";
      } catch (e) {
        // Includes a QueueBusyError when a CLI runner took the lock between
        // the check above and processQueue's own acquire.
        this.state.status = "error";
        this.state.error = e instanceof Error ? e.message : String(e);
      } finally {
        this.state.current = null;
        this.state.finished_at = new Date().toISOString();
        this.abort = null;
      }
    })();
    return this.snapshot();
  }

  /** Stop after the task that is running now. */
  stop(): boolean {
    if (!this.running || !this.abort) return false;
    this.state.status = "stopping";
    this.abort.abort();
    return true;
  }
}

/** The server's runner (one per `relay web` process). */
export const queueRunner = new QueueRunner();
