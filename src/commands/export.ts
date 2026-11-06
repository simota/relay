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
  /**
   * Task dependencies (schema v12), keyed by the stable (source_type,
   * source_id) pair because numeric ids differ between machines.
   */
  dependencies?: SnapshotDependency[];
  /** Task notes (schema v14), keyed like dependencies. */
  notes?: SnapshotNote[];
}

export interface SnapshotNote {
  task: { source_type: string; source_id: string };
  body: string;
  created_at: string;
}

export interface SnapshotDependency {
  task: { source_type: string; source_id: string };
  depends_on: { source_type: string; source_id: string };
}

export function runExport(opts: ExportOptions): void {
  const db = new RelayDB();
  const tasks = db.listAllTasks();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dependencies: SnapshotDependency[] = db.listAllDependencies().flatMap((edge) => {
    const task = byId.get(edge.task_id);
    const on = byId.get(edge.depends_on_id);
    return task && on
      ? [{
          task: { source_type: task.source_type, source_id: task.source_id },
          depends_on: { source_type: on.source_type, source_id: on.source_id },
        }]
      : [];
  });
  const notes: SnapshotNote[] = db.listAllNotes().flatMap((note) => {
    const task = byId.get(note.task_id);
    return task
      ? [{ task: { source_type: task.source_type, source_id: task.source_id }, body: note.body, created_at: note.created_at }]
      : [];
  });
  db.close();

  const payload: ExportPayload = {
    format: "relay-snapshot",
    version: 1,
    exported_at: new Date().toISOString(),
    machine_hostname: hostname(),
    task_count: tasks.length,
    tasks: tasks.map(({ id: _id, ...rest }) => rest),
    dependencies,
    notes,
  };

  try {
    writeFileSync(opts.file, JSON.stringify(payload, null, 2) + "\n");
  } catch (e) {
    console.log(chalk.red(`could not write ${opts.file}: ${(e as Error).message}`));
    process.exit(1);
  }

  console.log(
    chalk.green(`✓ exported ${tasks.length} task(s)${notes.length ? ` + ${notes.length} note(s)` : ""} to ${opts.file}`) +
      chalk.gray(`  (host=${payload.machine_hostname})`),
  );
}
