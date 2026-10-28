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
      const prompt = buildPrompt(task.prompt, opts.contextPreamble, opts.repoTemplate);
      return { bin, args: prompt ? [prompt] : [] };
    }
    case "codex": {
      const bin = opts.codexBin ?? "codex";
      if (canResume) {
        // `codex resume <SESSION_ID> [PROMPT]` — positional args, not flags.
        // The optional prompt is appended only when relay has one to inject
        // (typically null when resuming a session-derived task).
        const args = ["resume", task.session_id as string];
        if (task.prompt) args.push(task.prompt);
        return { bin, args };
      }
      const prompt = buildPrompt(task.prompt, opts.contextPreamble, opts.repoTemplate);
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
      const prompt = buildPrompt(task.prompt, opts.contextPreamble, opts.repoTemplate);
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

export function buildPrompt(
  prompt: string | null,
  preamble?: string,
  repoTemplate?: string,
): string | null {
  if (!prompt && !preamble && !repoTemplate) return null;
  const parts: string[] = [];
  if (repoTemplate) parts.push(repoTemplate);
  if (preamble) parts.push(`# Resuming from previous session\n\n${preamble}`);
  if (prompt) parts.push(prompt);
  return parts.join("\n\n---\n\n");
}
