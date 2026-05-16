import { Database } from "bun:sqlite";
import chalk from "chalk";
import { spawn } from "node:child_process";
import { DB_PATH } from "../paths.js";
import { buildApp } from "../web/server.js";

export interface WebOptions {
  port?: number;
  host?: string;
  noOpen?: boolean;
}

export async function runWeb(opts: WebOptions = {}): Promise<void> {
  const port = opts.port ?? 7340;
  const host = opts.host ?? "127.0.0.1";
  preflightDatabase();
  const app = buildApp();

  // Bun.serve directly when available; Hono provides `fetch` adapter.
  const server = Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
  });

  const url = `http://${host}:${server.port}`;
  console.log(chalk.green(`✓ relay web running at ${chalk.cyan(url)}`));
  console.log(chalk.gray(`  Ctrl-C to stop`));

  if (!opts.noOpen) {
    openInBrowser(url);
  }

  // Stay alive until interrupted.
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      server.stop();
      console.log(chalk.gray("\nstopped."));
      resolve();
    });
  });
}

function preflightDatabase(): void {
  let db: Database | null = null;
  try {
    db = new Database(DB_PATH, { readonly: true });
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('tasks', 'schema_version')
         LIMIT 2`,
      )
      .all() as Array<{ name: string }>;
    const hasTasks = rows.some((row) => row.name === "tasks");
    const hasSchemaVersion = rows.some((row) => row.name === "schema_version");
    if (!hasTasks || !hasSchemaVersion) {
      throw new Error("schema missing");
    }
  } catch {
    console.log(chalk.red(`relay: db not initialized at ${DB_PATH}. Run \`relay init\` first.`));
    process.exit(1);
  } finally {
    db?.close();
  }
}

function openInBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Browser opening is non-critical; ignore failures.
  }
}
