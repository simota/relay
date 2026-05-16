import type { Adapter } from "../types.js";
import { agentsNoteAdapter } from "./agents-note.js";
import { codeTodoAdapter } from "./code-todo.js";
import { claudeSessionAdapter } from "./claude-session.js";
import { codexSessionAdapter } from "./codex-session.js";
import { cursorSessionAdapter } from "./cursor-session.js";
import { geminiSessionAdapter } from "./gemini-session.js";
import { ghNotificationAdapter } from "./gh-notification.js";
import { ghProjectCardAdapter } from "./gh-project-card.js";
import { ghRunFailureAdapter } from "./gh-run-failure.js";
import { githubAdapter } from "./github.js";
import { gitInterruptedAdapter } from "./git-interrupted.js";
import { gitStashAdapter } from "./git-stash.js";
import { manualAdapter } from "./manual.js";
import { orphanBranchAdapter } from "./orphan-branch.js";

export const allAdapters: Adapter[] = [
  codeTodoAdapter,
  claudeSessionAdapter,
  codexSessionAdapter,
  geminiSessionAdapter,
  cursorSessionAdapter,
  githubAdapter,
  ghNotificationAdapter,
  ghProjectCardAdapter,
  ghRunFailureAdapter,
  gitInterruptedAdapter,
  gitStashAdapter,
  orphanBranchAdapter,
  agentsNoteAdapter,
  manualAdapter,
];

/**
 * Return only the adapters whose flag keys are enabled in `flags`.
 *
 * Each adapter declares its own `flagKeys` (defaults to `[adapter.name]`).
 * The adapter is included when *any* of its flag keys is truthy in `flags`.
 * Unknown keys default to `true` so future adapters are opt-in-by-default.
 *
 * Special cases are handled declaratively in the adapter's `flagKeys` field:
 * - `github` adapter: enabled when `github_issue` OR `github_pr` is true.
 * - session adapters (`claude_session_todo` etc.): flag key drops the `_todo`
 *   suffix (e.g. `claude_session`).
 */
export function enabledAdapters(flags: Record<string, boolean>): Adapter[] {
  return allAdapters.filter((a) => {
    const keys = a.flagKeys ?? [a.name];
    return keys.some((k) => flags[k] ?? true);
  });
}

export function findAdapter(name: string): Adapter | undefined {
  return allAdapters.find((a) => a.name === name);
}
