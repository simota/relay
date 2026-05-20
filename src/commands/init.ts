import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { migrateLegacyConfig } from "../config.js";
import { RelayDB } from "../db/client.js";
import { CONFIG_PATH, DB_PATH, RELAY_HOME } from "../paths.js";

const DEFAULT_CONFIG = `# relay configuration

[scan]
roots = ["~/repos/github.com"]
exclude = ["node_modules", "vendor", ".next", "dist", "target", ".git"]
max_depth = 2

[github]
# user = "your-github-username"
orgs = []

[agents]
default = "claude-code"
claude_bin = "claude"
codex_bin = "codex"
antigravity_bin = "agy"

[ui]
default_view = "today"
today_limit = 5
priority_decay_days = 14

[daemon]
enabled = false
interval_sec = 300

[adapters]
code_todo = true
github_issue = true
github_pr = true
claude_session = true
codex_session = true
antigravity_session = true
# Cursor adapter is OFF by default — Cursor chats can carry private prompts
# and credentials. Enable explicitly after reading SPEC.md §6 \`cursor-session\`.
cursor_session = false
agents_note = true
`;

export function runInit(opts: { force?: boolean } = {}): void {
  if (!existsSync(RELAY_HOME)) {
    mkdirSync(RELAY_HOME, { recursive: true });
    console.log(chalk.green(`✓ created ${RELAY_HOME}`));
  }

  if (!existsSync(CONFIG_PATH) || opts.force) {
    writeFileSync(CONFIG_PATH, DEFAULT_CONFIG, "utf8");
    console.log(chalk.green(`✓ wrote ${CONFIG_PATH}`));
  } else {
    // Upgrade existing config in place: rename legacy gemini_session keys
    // to antigravity_session so users keep their opt-out / lookback overrides.
    if (migrateLegacyConfig(CONFIG_PATH)) {
      console.log(chalk.green(`✓ migrated legacy gemini_session keys in ${CONFIG_PATH}`));
    } else {
      console.log(chalk.gray(`- config exists: ${CONFIG_PATH} (use --force to overwrite)`));
    }
  }

  const db = new RelayDB(DB_PATH);
  db.applySchema();
  db.close();
  console.log(chalk.green(`✓ schema applied at ${DB_PATH}`));

  console.log(chalk.cyan("\nNext: edit config, then run `relay sync`."));
}
