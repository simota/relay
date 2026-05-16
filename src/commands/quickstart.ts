import { existsSync } from "node:fs";
import chalk from "chalk";
import { RELAY_HOME } from "../paths.js";
import { runInit } from "./init.js";
import { runToday } from "./list.js";
import { runSync, type SyncEvent } from "./sync.js";

interface QuickstartOptions {
  noSync?: boolean;
}

interface AdapterSummary {
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

export async function runQuickstart(opts: QuickstartOptions = {}): Promise<void> {
  try {
    if (!existsSync(RELAY_HOME)) {
      runInit({});
    }

    const adapterSummaries = new Map<string, AdapterSummary>();
    if (opts.noSync !== true) {
      const report = await runSync({
        silent: true,
        onEvent: (event: SyncEvent) => {
          if (event.type !== "adapter_done") return;
          adapterSummaries.set(event.adapter, {
            fetched: event.fetched,
            inserted: event.inserted,
            updated: event.updated,
            unchanged: event.unchanged,
          });
        },
      });

      console.log(chalk.bold("quickstart"));
      if (adapterSummaries.size === 0) {
        console.log(chalk.gray("sync: no adapters ran"));
      } else {
        console.log(chalk.cyan("sync by adapter:"));
        for (const [adapter, counts] of adapterSummaries) {
          console.log(
            `  ${adapter}: fetched=${counts.fetched} created=${counts.inserted} updated=${counts.updated} unchanged=${counts.unchanged}`,
          );
        }
      }
      if (report.errors.length > 0) {
        console.log(chalk.yellow(`sync completed with ${report.errors.length} adapter error(s)`));
      }
    } else {
      console.log(chalk.bold("quickstart"));
      console.log(chalk.gray("sync skipped (--no-sync)"));
    }

    console.log("");
    console.log(chalk.cyan("today:"));
    runToday({ limit: 5 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(chalk.red(`quickstart failed: ${message}. Next: run \`relay init\`, then \`relay sync\`.`));
    process.exit(1);
  }
}
