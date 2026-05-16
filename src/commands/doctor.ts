import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import { enabledAdapters } from "../adapters/index.js";
import { loadConfig } from "../config.js";
import { RelayDB } from "../db/client.js";
import type { LatestSyncRow } from "../db/client.js";
import { CONFIG_PATH, DB_PATH, RELAY_HOME } from "../paths.js";
import { expandHome } from "../paths.js";

type DoctorOptions = {
  strict?: boolean;
};

export const DOCTOR_STRICT_FLAG = "--strict";

export function runDoctor(options: DoctorOptions = {}): void {
  let failures = 0;

  failures += check("relay home", existsSync(RELAY_HOME), RELAY_HOME) ? 0 : 1;
  failures += check("config", existsSync(CONFIG_PATH), CONFIG_PATH) ? 0 : 1;
  failures += check("db", existsSync(DB_PATH), DB_PATH) ? 0 : 1;

  const cfg = loadConfig();
  failures += checkCmd("ripgrep (rg)", "rg", ["--version"]) ? 0 : 1;
  failures += checkCmd("git", "git", ["--version"]) ? 0 : 1;
  failures += checkCmd("gh", "gh", ["--version"]) ? 0 : 1;
  failures += checkCmd(`claude (${cfg.agents.claude_bin})`, cfg.agents.claude_bin, ["--version"], false)
    ? 0
    : 1;

  console.log("");
  for (const root of cfg.scan.roots) {
    const abs = expandHome(root);
    failures += check(`scan root: ${root}`, existsSync(abs), abs) ? 0 : 1;
  }

  const hookInstalled = isHookInstalled();
  console.log(
    `${hookInstalled ? chalk.green("✓") : chalk.yellow("!")} ${"stop hook".padEnd(20)} ${chalk.gray(hookInstalled ? "installed" : "not installed — run `relay hook install`")}`,
  );

  // Pending data backfills
  const backfillEligible = countBackfillEligible();
  if (backfillEligible > 0) {
    console.log(
      `${chalk.yellow("!")} ${"backfill".padEnd(20)} ${chalk.gray(`${backfillEligible} context${backfillEligible === 1 ? "" : "s"} can be backfilled — run \`relay backfill\``)}`,
    );
  } else {
    console.log(
      `${chalk.green("✓")} ${"backfill".padEnd(20)} ${chalk.gray("no pending data fixups")}`,
    );
  }

  console.log("");
  failures += printAdapterHealth(cfg.adapters, options.strict === true);

  console.log("");
  console.log(
    chalk.gray(
      "Tip: `relay watch <repo>` polls the DB on an interval; use --interval >= 10s on battery.",
    ),
  );

  console.log("");
  console.log(failures === 0 ? chalk.green("all green") : chalk.yellow("some checks failed"));

  if (options.strict === true && failures > 0) {
    process.exit(1);
  }
}

function printAdapterHealth(
  flags: Parameters<typeof enabledAdapters>[0],
  strict: boolean,
): number {
  const adapters = enabledAdapters(flags);
  const latestSync = latestSyncRows();
  const latestByAdapter = new Map(latestSync.map((row) => [row.adapter, row]));
  let failures = 0;

  console.log(chalk.bold("Adapter Health:"));

  for (const adapter of adapters) {
    const sync = latestByAdapter.get(adapter.name);
    if (!sync) {
      console.log(`  ${adapter.name.padEnd(20)} ${chalk.gray("—")}  ${chalk.gray("never synced")}`);
      continue;
    }

    if (strict && sync.status === "error") failures += 1;

    const status = formatSyncStatus(sync.status).padEnd(7);
    const age = `${formatAge(sync.started_at)} ago`.padEnd(8);
    const detail =
      sync.status === "ok"
        ? `${String(sync.count).padStart(4)} fetched  ${formatElapsed(sync.started_at, sync.ended_at)}`
        : sync.error ?? `${sync.count} fetched`;
    console.log(`  ${adapter.name.padEnd(20)} ${status}  ${chalk.gray(age)}  ${chalk.gray(detail)}`);
  }

  return failures;
}

function latestSyncRows(): LatestSyncRow[] {
  if (!existsSync(DB_PATH)) return [];
  try {
    const db = new RelayDB();
    const rows = db.latestSyncPerAdapter();
    db.close();
    return rows;
  } catch {
    return [];
  }
}

function formatSyncStatus(status: string): string {
  switch (status) {
    case "ok":
      return chalk.green(status);
    case "error":
      return chalk.red(status);
    case "skipped":
      return chalk.yellow(status);
    default:
      return chalk.gray(status);
  }
}

function formatAge(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatElapsed(startedAt: string, endedAt: string): string {
  const started = Date.parse(startedAt);
  const ended = Date.parse(endedAt);
  if (Number.isNaN(started) || Number.isNaN(ended)) return "unknown";
  return `${Math.max(0, ended - started)}ms`;
}

function countBackfillEligible(): number {
  if (!existsSync(DB_PATH)) return 0;
  try {
    const db = new RelayDB();
    const result = db.runContextSessionBackfill({ dryRun: true });
    db.close();
    return result.eligible;
  } catch {
    return 0;
  }
}

function isHookInstalled(): boolean {
  const path =
    process.env.RELAY_CLAUDE_SETTINGS ?? join(homedir(), ".claude", "settings.json");
  if (!existsSync(path)) return false;
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    const stop = s?.hooks?.Stop;
    if (!Array.isArray(stop)) return false;
    return stop.some((g: { hooks?: Array<{ command?: string }> }) =>
      (g.hooks ?? []).some((h) => h.command === "relay context save --auto"),
    );
  } catch {
    return false;
  }
}

function check(label: string, ok: boolean, detail: string): boolean {
  const mark = ok ? chalk.green("✓") : chalk.red("✗");
  console.log(`${mark} ${label.padEnd(20)} ${chalk.gray(detail)}`);
  return ok;
}

function checkCmd(label: string, bin: string, args: string[], required = true): boolean {
  try {
    const res = spawnSync(bin, args, { encoding: "utf8" });
    if (res.status === 0) {
      const ver = (res.stdout.trim().split("\n")[0] ?? "").slice(0, 60);
      console.log(`${chalk.green("✓")} ${label.padEnd(20)} ${chalk.gray(ver)}`);
      return true;
    }
  } catch {
    // fall through
  }
  const mark = required ? chalk.red("✗") : chalk.yellow("!");
  console.log(`${mark} ${label.padEnd(20)} ${chalk.gray("not found")}`);
  return !required;
}
