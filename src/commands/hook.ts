import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";

const CLAUDE_SETTINGS_PATH =
  process.env.RELAY_CLAUDE_SETTINGS ?? join(homedir(), ".claude", "settings.json");

const HOOK_COMMAND = "relay context save --auto";

interface ClaudeHookEntry {
  type: "command";
  command: string;
}

interface ClaudeHookMatcher {
  matcher?: string;
  hooks: ClaudeHookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    Stop?: ClaudeHookMatcher[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export function runHookInstall(): void {
  const settings = readSettings();
  settings.hooks ??= {};
  settings.hooks.Stop ??= [];

  // Find a matcher group without `matcher` (catch-all) and ensure our command is in it.
  let group = settings.hooks.Stop.find((g) => !g.matcher);
  if (!group) {
    group = { hooks: [] };
    settings.hooks.Stop.push(group);
  }
  group.hooks ??= [];

  const exists = group.hooks.some((h) => h.command === HOOK_COMMAND);
  if (exists) {
    console.log(chalk.gray(`- already installed: ${CLAUDE_SETTINGS_PATH}`));
    return;
  }

  group.hooks.push({ type: "command", command: HOOK_COMMAND });
  writeSettings(settings);
  console.log(chalk.green(`✓ installed Stop hook in ${CLAUDE_SETTINGS_PATH}`));
  console.log(chalk.gray(`  command: ${HOOK_COMMAND}`));
}

export function runHookUninstall(): void {
  const settings = readSettings();
  const stop = settings.hooks?.Stop;
  if (!stop) {
    console.log(chalk.gray("nothing installed."));
    return;
  }

  let removed = 0;
  for (const group of stop) {
    if (!group.hooks) continue;
    const before = group.hooks.length;
    group.hooks = group.hooks.filter((h) => h.command !== HOOK_COMMAND);
    removed += before - group.hooks.length;
  }

  // Drop empty groups
  settings.hooks!.Stop = stop.filter((g) => (g.hooks ?? []).length > 0);
  if (settings.hooks!.Stop!.length === 0) delete settings.hooks!.Stop;

  if (removed === 0) {
    console.log(chalk.gray("nothing to remove."));
    return;
  }
  writeSettings(settings);
  console.log(chalk.green(`✓ removed ${removed} hook entry from ${CLAUDE_SETTINGS_PATH}`));
}

export function runHookStatus(): void {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) {
    console.log(chalk.gray(`no settings at ${CLAUDE_SETTINGS_PATH}`));
    return;
  }
  const settings = readSettings();
  const stop = settings.hooks?.Stop ?? [];
  const installed = stop.some((g) => (g.hooks ?? []).some((h) => h.command === HOOK_COMMAND));
  if (installed) {
    console.log(chalk.green(`✓ Stop hook installed (${HOOK_COMMAND})`));
  } else {
    console.log(chalk.yellow("- Stop hook not installed"));
    console.log(chalk.gray(`  run \`relay hook install\` to enable auto context save.`));
  }
}

function readSettings(): ClaudeSettings {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, "utf8"));
  } catch (e) {
    console.log(chalk.red(`failed to parse ${CLAUDE_SETTINGS_PATH}: ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
}

function writeSettings(s: ClaudeSettings): void {
  mkdirSync(dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(s, null, 2) + "\n", "utf8");
}
