import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Task } from "../types.js";

export interface RunOptions {
  task: Task;
  repoRoot: string;
  claudeBin?: string;
  codexBin?: string;
  geminiBin?: string;
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
  exitCode: number | null;
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
    proc.on("close", (code) => {
      resolve({
        status: code === 0 ? "success" : "failed",
        exitCode: code,
      });
    });
  });
}

function resolveCommand(
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
    case "gemini": {
      const bin = opts.geminiBin ?? "gemini";
      // Gemini's `--resume` takes an index or `"latest"`, not a UUID, so we
      // can't address a specific historical session by its stored session_id.
      // Gracefully degrade to a fresh prompt with context preamble — same
      // behavior as if `session_id` were null. `#TODO(agent): if gemini ever
      // adds UUID-based resume, wire it here.
      const prompt = buildPrompt(task.prompt, opts.contextPreamble, opts.repoTemplate);
      return { bin, args: prompt ? [prompt] : [] };
    }
    case "self": {
      const editor = process.env.EDITOR ?? "vim";
      return { bin: editor, args: ["."] };
    }
    case "human-review":
      return { bin: "open", args: [task.body] };
    default:
      throw new Error(`unknown assignee: ${task.assignee}`);
  }
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
