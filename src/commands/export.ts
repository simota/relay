import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import chalk from "chalk";
import { RelayDB } from "../db/client.js";
import type { Task } from "../types.js";

export interface ExportOptions {
  file: string;
}

export interface ExportPayload {
  format: "relay-snapshot";
  version: 1;
  exported_at: string;
  machine_hostname: string;
  task_count: number;
  tasks: Array<Omit<Task, "id">>;
}

export function runExport(opts: ExportOptions): void {
  const db = new RelayDB();
  const tasks = db.listAllTasks();
  db.close();

  const payload: ExportPayload = {
    format: "relay-snapshot",
    version: 1,
    exported_at: new Date().toISOString(),
    machine_hostname: hostname(),
    task_count: tasks.length,
    tasks: tasks.map(({ id: _id, ...rest }) => rest),
  };

  try {
    writeFileSync(opts.file, JSON.stringify(payload, null, 2) + "\n");
  } catch (e) {
    console.log(chalk.red(`could not write ${opts.file}: ${(e as Error).message}`));
    process.exit(1);
  }

  console.log(
    chalk.green(`✓ exported ${tasks.length} task(s) to ${opts.file}`) +
      chalk.gray(`  (host=${payload.machine_hostname})`),
  );
}
