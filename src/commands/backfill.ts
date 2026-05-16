import chalk from "chalk";
import { RelayDB } from "../db/client.js";

interface BackfillEntry {
  name: string;
  description: string;
  run: (db: RelayDB, dryRun: boolean) => BackfillResult;
}

interface BackfillResult {
  total: number;
  eligible: number;
  updated: number;
}

const REGISTRY: BackfillEntry[] = [
  {
    name: "context-sessions",
    description: "Fill contexts.session_id from each context's linked tasks (for DBs predating v0.2).",
    run: (db, dryRun) => db.runContextSessionBackfill({ dryRun }),
  },
];

export interface BackfillOptions {
  dryRun?: boolean;
  only?: string;
  list?: boolean;
}

export function runBackfill(opts: BackfillOptions = {}): void {
  if (opts.list) {
    console.log(chalk.bold("available backfills:"));
    for (const b of REGISTRY) {
      console.log(`  ${chalk.cyan(b.name.padEnd(20))} ${chalk.gray(b.description)}`);
    }
    return;
  }

  const entries = opts.only ? REGISTRY.filter((b) => b.name === opts.only) : REGISTRY;
  if (entries.length === 0) {
    console.log(chalk.red(`unknown backfill: ${opts.only}. run \`relay backfill --list\``));
    process.exit(1);
  }

  const db = new RelayDB();
  try {
    for (const entry of entries) {
      console.log(chalk.cyan(`▶ ${entry.name}`));
      console.log(chalk.gray(`  ${entry.description}`));

      const result = entry.run(db, Boolean(opts.dryRun));
      const remaining = result.total - result.eligible;

      console.log(
        `  ${pad("candidates")}  ${chalk.bold(result.total)} (rows with NULL)\n` +
        `  ${pad("eligible")}    ${chalk.green(result.eligible)} (matching task found)\n` +
        `  ${pad("unlinked")}    ${chalk.gray(remaining)} (no source — left as-is)`,
      );

      if (opts.dryRun) {
        console.log(chalk.yellow(`  - dry-run: no writes`));
      } else if (result.updated === 0) {
        console.log(chalk.gray(`  - nothing to do`));
      } else {
        console.log(chalk.green(`  ✓ updated ${result.updated} row${result.updated === 1 ? "" : "s"}`));
      }
    }
  } finally {
    db.close();
  }
}

function pad(s: string): string {
  return s.padEnd(12);
}
