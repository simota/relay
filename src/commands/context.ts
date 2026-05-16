import { createHash } from "node:crypto";
import chalk from "chalk";
import { RelayDB } from "../db/client.js";
import { gitSnapshot } from "../context/git.js";
import { deterministicSummary, llmSummary } from "../context/summarize.js";
import { formatSummary, summarizeTranscript } from "../context/transcript.js";
import { loadConfig, resolveScanRoots } from "../config.js";
import { resolveRepoForCwd } from "../lib/repo-from-cwd.js";

interface AutoHookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
}

export async function runContextSave(opts: {
  auto?: boolean;
  repo?: string;
  summary?: string;
}): Promise<void> {
  if (opts.auto) {
    const payload = await readStdinJson<AutoHookPayload>();
    await autoSave(payload);
    return;
  }
  manualSave(opts);
}

async function autoSave(payload: AutoHookPayload | null): Promise<void> {
  if (!payload) return; // silent: don't disrupt session end
  const cwd = payload.cwd ?? process.cwd();
  const repo = inferRepoFromCwd(cwd);
  if (!repo) return;

  const snap = gitSnapshot(cwd);
  if (!snap) return;

  let summary = "";
  if (payload.transcript_path) {
    try {
      summary = formatSummary(summarizeTranscript(payload.transcript_path));
    } catch {
      summary = "";
    }
  }
  if (!summary) summary = `(auto save at ${new Date().toISOString()})`;

  const hash = makeHash(repo, snap.headSha, summary, Date.now());

  const db = new RelayDB();
  db.insertContext({
    hash,
    repo,
    branch: snap.branch,
    headSha: snap.headSha,
    dirtyFiles: snap.dirtyFiles,
    summary,
    sessionId: payload.session_id ?? null,
  });
  const linked = db.linkContextToActiveTasks(repo, hash, payload.session_id);
  db.close();

  // Silent on success — hook should not pollute the session.
  if (process.env.RELAY_DEBUG) {
    console.error(`[context] auto-saved ${hash.slice(0, 10)} (repo=${repo}, linked=${linked})`);
  }
}

function manualSave(opts: { repo?: string; summary?: string }): void {
  const cwd = process.cwd();
  const repo = opts.repo ?? inferRepoFromCwd(cwd);
  if (!repo) {
    console.log(chalk.red("could not infer repo; pass --repo"));
    process.exit(1);
  }
  const snap = gitSnapshot(cwd);
  if (!snap) {
    console.log(chalk.red(`${cwd} is not a git repo`));
    process.exit(1);
  }
  const summary = opts.summary ?? "(manual save)";
  const hash = makeHash(repo, snap.headSha, summary, Date.now());

  const db = new RelayDB();
  db.insertContext({
    hash,
    repo,
    branch: snap.branch,
    headSha: snap.headSha,
    dirtyFiles: snap.dirtyFiles,
    summary,
    sessionId: null,
  });
  db.close();

  console.log(chalk.green(`✓ saved context ${hash.slice(0, 10)}`));
  console.log(chalk.gray(`  repo:   ${repo}`));
  console.log(chalk.gray(`  branch: ${snap.branch}`));
  console.log(chalk.gray(`  HEAD:   ${snap.headSha.slice(0, 10)}`));
  if (snap.dirtyFiles.length) {
    console.log(chalk.gray(`  dirty:  ${snap.dirtyFiles.length} files`));
  }
}

export function runContextList(opts: { repo?: string }): void {
  const db = new RelayDB();
  const contexts = db.listContexts(opts.repo, 50);
  db.close();
  if (contexts.length === 0) {
    console.log(chalk.gray("no contexts yet."));
    return;
  }
  for (const c of contexts) {
    const dirty = c.dirtyFiles.length ? chalk.yellow(` (+${c.dirtyFiles.length} dirty)`) : "";
    const first = c.summary.split("\n")[0] ?? "";
    console.log(
      `${chalk.gray(c.hash.slice(0, 10))}  ${chalk.cyan(c.repo.padEnd(20))}  ${chalk.dim(c.branch.padEnd(20))}  ${chalk.gray(c.createdAt)}${dirty}`,
    );
    if (first) console.log(`    ${chalk.dim(first.slice(0, 100))}`);
  }
}

export function runContextShow(hash: string): void {
  const db = new RelayDB();
  const c = db.getContext(hash);
  db.close();
  if (!c) {
    console.log(chalk.red(`context ${hash} not found`));
    process.exit(1);
  }
  console.log(chalk.bold(c.hash));
  console.log(chalk.gray(`repo:    ${c.repo}`));
  console.log(chalk.gray(`branch:  ${c.branch}`));
  console.log(chalk.gray(`HEAD:    ${c.headSha}`));
  console.log(chalk.gray(`saved:   ${c.createdAt}`));
  if (c.generatedAt) {
    console.log(chalk.gray(`cue:     ${c.modelName ?? "manual"} @ ${c.generatedAt}`));
  }
  if (c.dirtyFiles.length) {
    console.log(chalk.gray(`dirty:`));
    for (const f of c.dirtyFiles) console.log(chalk.yellow(`  ${f}`));
  }
  if (c.summary) {
    console.log("");
    console.log(c.summary);
  }
}

export function runContextSummarize(hash: string, opts: { llm?: boolean }): void {
  const db = new RelayDB();
  const c = db.getContext(hash);
  if (!c) {
    db.close();
    console.log(chalk.red(`context ${hash} not found`));
    process.exit(1);
  }

  let result;
  let mode: "deterministic" | "llm";
  if (opts.llm) {
    const cfg = loadConfig();
    const binary = cfg.agents.claude_bin;
    const r = llmSummary(c, binary);
    if ("error" in r) {
      db.close();
      console.log(chalk.red(`✗ llm summary failed: ${r.error}`));
      console.log(chalk.gray(`  (falling back: re-run without --llm for deterministic summary)`));
      process.exit(1);
    }
    result = r;
    mode = "llm";
  } else {
    result = deterministicSummary(c);
    mode = "deterministic";
  }

  db.updateContextSummary({
    hash: c.hash,
    summary: result.summary,
    generatedAt: result.generatedAt,
    modelName: result.modelName,
  });
  db.close();

  console.log(chalk.green(`✓ summarized ${c.hash.slice(0, 10)} (${mode})`));
  console.log(chalk.gray(`  ${result.summary}`));
}

export function runContextEdit(hash: string, summary: string): void {
  if (!summary.trim()) {
    console.log(chalk.red("summary cannot be empty"));
    process.exit(1);
  }
  const db = new RelayDB();
  const c = db.getContext(hash);
  if (!c) {
    db.close();
    console.log(chalk.red(`context ${hash} not found`));
    process.exit(1);
  }
  db.updateContextSummary({
    hash: c.hash,
    summary: summary.trim(),
    generatedAt: null,
    modelName: null,
  });
  db.close();
  console.log(chalk.green(`✓ updated summary for ${c.hash.slice(0, 10)} (manual)`));
}

function inferRepoFromCwd(cwd: string): string | null {
  const cfg = loadConfig();
  return resolveRepoForCwd(cwd, resolveScanRoots(cfg));
}

function makeHash(repo: string, sha: string, summary: string, ts: number): string {
  return createHash("sha256")
    .update(`${repo}:${sha}:${summary}:${ts}`)
    .digest("hex");
}

function readStdinJson<T>(): Promise<T | null> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c.toString("utf8")));
    process.stdin.on("end", () => {
      const trimmed = data.trim();
      if (!trimmed) return resolve(null);
      try {
        resolve(JSON.parse(trimmed) as T);
      } catch {
        resolve(null);
      }
    });
    process.stdin.on("error", () => resolve(null));
    // If stdin is closed (no pipe), end will fire immediately
  });
}
