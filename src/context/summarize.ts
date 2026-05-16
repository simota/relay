// Memory cue generator — builds a one-line summary of a saved context so
// 2-week-future-self can pick up where past-self left off (Plea #10).
//
// Two modes:
//   - Deterministic (default): assembles from branch + dirty files + the
//     first line of the previously-saved summary. Zero external calls.
//   - LLM (`--llm`): invokes the configured claude binary with a focused
//     prompt and replaces the summary with the model's one-liner.
//
// The model never sees raw transcript content here — only the metadata
// already in the DB. Transcript-derived bullets remain in `summary` and
// are appended to the prompt as hint text.

import { spawnSync } from "node:child_process";
import type { RelayContext } from "../db/client.js";

const TARGET_MIN = 80;
const TARGET_MAX = 160;
const LLM_TIMEOUT_MS = 30_000;

export interface SummarizeResult {
  summary: string;
  generatedAt: string | null;
  modelName: string | null;
}

export function deterministicSummary(ctx: RelayContext): SummarizeResult {
  const parts: string[] = [];
  parts.push(`on \`${ctx.branch}\``);
  if (ctx.dirtyFiles.length > 0) {
    const top = ctx.dirtyFiles.slice(0, 2).join(", ");
    const more = ctx.dirtyFiles.length > 2 ? ` (+${ctx.dirtyFiles.length - 2} more)` : "";
    parts.push(`dirty: ${top}${more}`);
  }
  const firstLine = ctx.summary
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^\(auto save at /.test(l) && !/^\(manual save\)$/.test(l));
  if (firstLine) {
    const trimmed = firstLine.replace(/^[-*•]\s+/, "").slice(0, 100);
    parts.push(trimmed);
  }
  const summary = clampLength(parts.join(" — "));
  return { summary, generatedAt: null, modelName: null };
}

export function llmSummary(
  ctx: RelayContext,
  binary: string,
): SummarizeResult | { error: string } {
  const prompt = buildPrompt(ctx);
  const proc = spawnSync(binary, ["-p", prompt], {
    encoding: "utf8",
    timeout: LLM_TIMEOUT_MS,
  });
  if (proc.error) {
    return { error: `failed to invoke ${binary}: ${proc.error.message}` };
  }
  if (proc.status !== 0) {
    const stderr = proc.stderr?.trim() ?? "";
    return { error: `${binary} exited with ${proc.status}${stderr ? `: ${stderr}` : ""}` };
  }
  const stdout = proc.stdout?.trim() ?? "";
  if (!stdout) return { error: `${binary} returned empty output` };

  const oneLine = stdout.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  if (!oneLine) return { error: `${binary} returned no usable line` };

  return {
    summary: clampLength(oneLine),
    generatedAt: new Date().toISOString(),
    modelName: binary,
  };
}

function buildPrompt(ctx: RelayContext): string {
  const dirty = ctx.dirtyFiles.length > 0 ? ctx.dirtyFiles.slice(0, 10).join(", ") : "none";
  const previous = ctx.summary.split("\n").slice(0, 5).join(" / ").slice(0, 400);
  return [
    "You are writing a one-line memory cue so a developer can resume work",
    "after a 2-week break. Output ONLY the cue itself — no preamble, no quotes,",
    `no markdown. Target ${TARGET_MIN}–${TARGET_MAX} characters. Tone: terse, present-tense,`,
    "focuses on the unfinished action, not the past.",
    "",
    `Repo: ${ctx.repo}`,
    `Branch: ${ctx.branch}`,
    `HEAD: ${ctx.headSha.slice(0, 10)}`,
    `Dirty files: ${dirty}`,
    `Previous notes: ${previous}`,
  ].join("\n");
}

function clampLength(s: string): string {
  if (s.length <= TARGET_MAX) return s;
  return s.slice(0, TARGET_MAX - 1).trimEnd() + "…";
}
