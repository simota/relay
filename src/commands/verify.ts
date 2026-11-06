// `relay verify` — run (or inspect) the verify gate outside an agent run.
//
// Useful to check a `[[verify.repos]]` entry / `.agents/RELAY_VERIFY` before
// trusting an overnight `relay queue run --headless --verify --retries 2`,
// and to re-check a repo by hand after fixing an agent's work.

import chalk from "chalk";
import { loadConfig } from "../config.js";
import { RelayDB } from "../db/client.js";
import { resolveVerifyCommand, runVerify } from "../executor/verify.js";
import { resolveRepoPath } from "../repo-resolver.js";

export interface VerifyCommandOptions {
  taskId?: number;
  repo?: string;
  list?: boolean;
  json?: boolean;
}

export async function runVerifyCommand(options: VerifyCommandOptions): Promise<void> {
  const cfg = loadConfig();

  if (options.list) {
    let repos: string[];
    {
      using db = new RelayDB();
      repos = db.repoNames();
    }
    const rows = repos.map((repo) => {
      const root = resolveRepoPath(repo, cfg);
      const cmd = resolveVerifyCommand(repo, root, cfg);
      return { repo, path: root, command: cmd?.command ?? null, source: cmd?.source ?? null };
    });
    if (options.json) {
      console.log(JSON.stringify({ auto: cfg.verify.auto, retries: cfg.verify.retries, repos: rows }, null, 2));
      return;
    }
    const configured = rows.filter((r) => r.command);
    console.log(
      chalk.bold(`verify gate: ${configured.length}/${rows.length} repos have a verify command`) +
        chalk.gray(` · auto=${cfg.verify.auto} · retries=${cfg.verify.retries} · timeout=${cfg.verify.timeout_min}m`),
    );
    for (const r of rows) {
      if (r.command) {
        const src = r.source === "config" ? "config" : ".agents/RELAY_VERIFY";
        console.log(`  ${chalk.green("✓")} ${r.repo.padEnd(28)} ${r.command} ${chalk.gray(`(${src})`)}`);
      } else {
        console.log(`  ${chalk.gray("·")} ${chalk.gray(r.repo.padEnd(28))} ${chalk.gray(r.path ? "(none)" : "(repo not on disk)")}`);
      }
    }
    if (configured.length === 0) {
      console.log(
        chalk.gray(
          '\nadd one with `[[verify.repos]]\\nrepo = "my-repo"\\ncommand = "bun test"` in ~/.relay/config.toml, or a <repo>/.agents/RELAY_VERIFY file',
        ),
      );
    }
    return;
  }

  let repo = options.repo;
  if (!repo) {
    if (!options.taskId) {
      console.error(chalk.red("give a task id, --repo <name>, or --list"));
      process.exit(1);
    }
    using db = new RelayDB();
    const task = db.getTask(options.taskId);
    if (!task) {
      console.error(chalk.red(`task #${options.taskId} not found`));
      process.exit(1);
    }
    repo = task.repo;
  }
  const root = resolveRepoPath(repo, cfg);
  if (!root) {
    console.error(chalk.red(`repo '${repo}' not found under scan.roots or scan.tracked_repos`));
    process.exit(1);
  }
  const cmd = resolveVerifyCommand(repo, root, cfg);
  if (!cmd) {
    const msg = `no verify command for ${repo} — add [[verify.repos]] to config.toml or ${root}/.agents/RELAY_VERIFY`;
    if (options.json) console.log(JSON.stringify({ repo, path: root, command: null, status: null }));
    else console.error(chalk.yellow(msg));
    process.exit(2);
  }
  if (!options.json) console.log(chalk.cyan(`▶ verify ${repo}`) + chalk.gray(`  $ ${cmd.command}  (cwd ${root})`));
  const timeoutMin = cfg.verify.timeout_min;
  const result = await runVerify(cmd.command, root, {
    timeoutMs: timeoutMin > 0 ? timeoutMin * 60_000 : undefined,
    echo: !options.json,
  });
  if (options.json) {
    console.log(JSON.stringify({ repo, path: root, source: cmd.source, ...result }, null, 2));
  } else {
    const secs = (result.durationMs / 1000).toFixed(1);
    console.log(
      result.status === "passed"
        ? chalk.green(`\n✓ verify passed in ${secs}s`)
        : chalk.red(`\n✗ verify ${result.timedOut ? "timed out" : `failed (exit ${result.exitCode})`} after ${secs}s`),
    );
  }
  process.exit(result.status === "passed" ? 0 : 1);
}
