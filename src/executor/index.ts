import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
import type { Task } from "../types.js";

export interface RunOptions {
  task: Task;
  repoRoot: string;
  claudeBin?: string;
  codexBin?: string;
  antigravityBin?: string;
  contextPreamble?: string;  // prepended to the prompt when no resume is available
  repoTemplate?: string;     // body of <repo>/.agents/RELAY_PROMPT.md, prepended before context
  /** "Prerequisite tasks" section listing the task's dependencies (schema v12). */
  prerequisites?: string;
  /** "Notes" section: the user's progress notes on the task (schema v14). */
  notes?: string;
  /**
   * Force a fresh prompt-based launch even when the task has a `session_id`.
   * Useful when the CLI's resume command is broken, or the user wants to
   * branch off a previous session with a new context preamble.
   */
  noResume?: boolean;
}

export interface RunResult {
  status: "success" | "failed" | "interrupted";
  exitCode: number;
}

export async function runTask(opts: RunOptions): Promise<RunResult> {
  const { task, repoRoot } = opts;
  if (!existsSync(repoRoot)) {
    throw new Error(`repo path not found: ${repoRoot}`);
  }
  const { bin, args } = resolveCommand(task, opts);

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { cwd: repoRoot, stdio: "inherit" });
    proc.on("error", reject);
    proc.on("close", (code, signal) => resolve(runResultFromExit(code, signal)));
  });
}

/**
 * Map a child's exit to a run result. A signal-terminated child reports
 * `code === null`; keep that from reading as success (`process.exit(null)`
 * exits 0) by using the shell convention 128 + signal number.
 */
export function runResultFromExit(
  code: number | null,
  signal: NodeJS.Signals | null,
): RunResult {
  if (code === null) {
    const signo = signal ? constants.signals[signal] : undefined;
    return { status: "interrupted", exitCode: signo ? 128 + signo : 1 };
  }
  return { status: code === 0 ? "success" : "failed", exitCode: code };
}

export function resolveCommand(
  task: Task,
  opts: RunOptions,
): { bin: string; args: string[] } {
  const canResume = Boolean(task.session_id) && !opts.noResume;
  switch (task.assignee) {
    case "claude-code": {
      const bin = opts.claudeBin ?? "claude";
      if (canResume) return { bin, args: ["--resume", task.session_id as string] };
      const prompt = buildPrompt(promptBody(task, opts.notes), opts.contextPreamble, opts.repoTemplate, opts.prerequisites, opts.notes);
      return { bin, args: prompt ? [prompt] : [] };
    }
    case "codex": {
      const bin = opts.codexBin ?? "codex";
      if (canResume) {
        // `codex resume <SESSION_ID> [PROMPT]` — positional args, not flags.
        // The optional prompt is appended only when relay has one to inject
        // (typically null when resuming a session-derived task).
        const args = ["resume", task.session_id as string];
        const followUp = withResumeNotes(task.prompt, opts.notes);
        if (followUp) args.push(followUp);
        return { bin, args };
      }
      const prompt = buildPrompt(promptBody(task, opts.notes), opts.contextPreamble, opts.repoTemplate, opts.prerequisites, opts.notes);
      return { bin, args: prompt ? [prompt] : [] };
    }
    case "antigravity": {
      const bin = opts.antigravityBin ?? "agy";
      // Antigravity CLI (`agy`) has no UUID-based resume command yet — the
      // CLI re-attaches to whichever conversation matches the current
      // workspace on launch. We can't deterministically pin a historical
      // conversationId from outside, so we degrade to a fresh prompt with
      // context preamble (same behavior as if `session_id` were null).
      // #TODO(agent): if `agy` adds `agy resume <id>`, wire it here.
      const prompt = buildPrompt(promptBody(task, opts.notes), opts.contextPreamble, opts.repoTemplate, opts.prerequisites, opts.notes);
      return { bin, args: prompt ? [prompt] : [] };
    }
    case "self": {
      const editor = process.env.EDITOR ?? "vim";
      return { bin: editor, args: ["."] };
    }
    case "human-review": {
      // Never hand `task.body` to the opener: for GitHub PRs it is the PR
      // description (third-party text, possibly flag-shaped) and the URL
      // lives in `source_id`. Only a parsed http(s) URL is forwarded.
      const url = resolveReviewUrl(task);
      if (!url) throw new Error(`no http(s) URL to open for task #${task.id}`);
      return { bin: process.platform === "darwin" ? "open" : "xdg-open", args: [url] };
    }
    default:
      throw new Error(`unknown assignee: ${task.assignee}`);
  }
}

/**
 * URL a `human-review` task should open: `source_id` when it is itself a
 * URL (github_pr / github_issue), else the first http(s) URL in the body
 * (manual tasks). Returns the normalized `href`, which always starts with
 * the scheme, or null when nothing usable exists.
 */
export function resolveReviewUrl(task: Task): string | null {
  // Trailing sentence punctuation ("see https://x/y.") is prose, not URL.
  const fromBody = task.body.match(/https?:\/\/[^\s<>"'`)\]]+/)?.[0]?.replace(/[.,;:!?]+$/, "");
  const candidates = [task.source_id, fromBody];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch {
      // not a URL — try the next candidate
    }
  }
  return null;
}

/**
 * Prompt used when a task has none of its own. Interactive launches can
 * open an empty agent session, but a headless run needs instructions, so
 * describe the task from the fields relay already has.
 */
export function fallbackPrompt(task: Task): string {
  const lines = [`Work on this task in the current repository: ${task.title}`];
  const body = task.body.trim();
  if (body) lines.push("", body);
  if (task.files.length > 0) lines.push("", `Relevant files: ${task.files.join(", ")}`);
  if (task.source_type !== "manual") lines.push("", `(source: ${task.source_type} ${task.source_id})`);
  return lines.join("\n");
}

/**
 * The prompt body for an interactive launch. A task without its own prompt
 * normally launches the agent bare, but once the user left notes the agent
 * must also be told what the task is — notes alone are not a task.
 */
export function promptBody(task: Task, notes: string | undefined): string | null {
  return task.prompt ?? (notes ? fallbackPrompt(task) : null);
}

export function buildPrompt(
  prompt: string | null,
  preamble?: string,
  repoTemplate?: string,
  prerequisites?: string,
  notes?: string,
): string | null {
  if (!prompt && !preamble && !repoTemplate && !prerequisites && !notes) return null;
  const parts: string[] = [];
  if (repoTemplate) parts.push(repoTemplate);
  if (preamble) parts.push(`# Resuming from previous session\n\n${preamble}`);
  if (prerequisites) parts.push(`# Prerequisite tasks\n\n${prerequisites}`);
  if (prompt) parts.push(prompt);
  // Notes go last: they are the user's newest steering ("the last run
  // failed because X — try Y"), so they should be the freshest thing the
  // agent reads before it starts.
  if (notes) parts.push(`# Notes from the user\n\n${notes}`);
  return parts.join("\n\n---\n\n");
}

/**
 * A resumed session already has its history, but the user's notes may be
 * newer than it (that is the point of "retry with feedback"), so they ride
 * along with the follow-up prompt.
 */
export function withResumeNotes(prompt: string | null, notes: string | undefined): string | null {
  if (!notes) return prompt;
  const section = `# Notes from the user\n\n${notes}`;
  return prompt ? `${prompt}\n\n---\n\n${section}` : section;
}

/** Newest notes kept in the prompt; older ones are summarized as a count. */
export const PROMPT_NOTE_LIMIT = 10;

/**
 * Render a task's notes for the agent prompt, oldest first so the agent
 * reads them as a story. Only the newest {@link PROMPT_NOTE_LIMIT} are
 * included. Empty string when there are none.
 */
export function formatNotes(
  notes: ReadonlyArray<{ body: string; created_at: string }>,
  limit: number = PROMPT_NOTE_LIMIT,
): string {
  if (notes.length === 0) return "";
  const kept = notes.slice(-limit);
  const dropped = notes.length - kept.length;
  const lines = kept.map((n) => {
    const when = n.created_at.slice(0, 16).replace("T", " ");
    const [first, ...rest] = n.body.split("\n");
    const cont = rest.map((line) => `  ${line}`).join("\n");
    return `- [${when}] ${first ?? ""}${cont ? `\n${cont}` : ""}`;
  });
  const head =
    "The user left these notes on the task (oldest first). The newest note takes precedence when they conflict; " +
    "they often explain why a previous attempt failed.";
  return `${head}${dropped > 0 ? ` (${dropped} older note${dropped === 1 ? "" : "s"} omitted)` : ""}\n\n${lines.join("\n")}`;
}

/**
 * Render a task's dependencies for the agent prompt: what this task builds
 * on and whether that work is finished. Empty string when there are none.
 */
export function formatPrerequisites(
  blockers: ReadonlyArray<Pick<Task, "id" | "title" | "repo" | "status">>,
  taskRepo: string,
): string {
  if (blockers.length === 0) return "";
  const lines = blockers.map((b) => {
    const where = b.repo === taskRepo ? "" : ` (repo: ${b.repo})`;
    return `- #${b.id} [${b.status === "done" ? "done" : `not done: ${b.status}`}] ${b.title}${where}`;
  });
  return `This task depends on the following tasks. Build on their results; if one is not done yet, check its state before relying on it.\n\n${lines.join("\n")}`;
}
