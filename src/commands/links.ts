// `relay tag` / `relay tags` / `relay block` / `relay unblock` — the CLI side
// of schema v12 tags and task dependencies. Every change records one undo
// entry, so `relay undo` and the Web UI's ⌘Z revert it like any other edit.

import chalk from "chalk";
import { recordDepsUndo } from "../api/tasks.js";
import { RelayDB } from "../db/client.js";
import { MAX_TAGS_PER_TASK, normalizeTag } from "../lib/tags.js";

export interface TagArgs {
  /** Tokens: `foo` / `+foo` add, `-foo` remove. */
  tokens: string[];
  clear?: boolean;
}

/**
 * Parse `relay tag` tokens into add / remove sets. `-` can't start a
 * commander positional, so `-foo` usually arrives via `--` or as `^foo`;
 * both `-foo` and `^foo` mean remove.
 */
export function parseTagTokens(tokens: readonly string[]): { add: string[]; remove: string[]; invalid: string[] } {
  const add: string[] = [];
  const remove: string[] = [];
  const invalid: string[] = [];
  for (const raw of tokens.flatMap((t) => t.split(","))) {
    const token = raw.trim();
    if (!token) continue;
    const removing = token.startsWith("-") || token.startsWith("^");
    const body = removing || token.startsWith("+") ? token.slice(1) : token;
    const tag = normalizeTag(body);
    if (!tag) {
      invalid.push(token);
      continue;
    }
    (removing ? remove : add).push(tag);
  }
  return { add, remove, invalid };
}

export function runTag(ids: number[], args: TagArgs): void {
  const { add, remove, invalid } = parseTagTokens(args.tokens);
  if (invalid.length > 0) {
    console.log(chalk.red(`invalid tag(s): ${invalid.join(", ")}`) + chalk.gray("  (letters, digits, . _ / : - · max 40 chars)"));
    process.exit(1);
  }
  using db = new RelayDB();
  const tasks = db.getTasksByIds(ids);
  const missing = ids.filter((id) => !tasks.some((t) => t.id === id));
  if (missing.length > 0) {
    console.log(chalk.red(`task(s) not found: ${missing.map((id) => `#${id}`).join(" ")}`));
    process.exit(1);
  }

  if (!args.clear && add.length === 0 && remove.length === 0) {
    for (const task of tasks) {
      const tags = task.tags ?? [];
      console.log(
        `${chalk.gray(`#${task.id}`)} ${tags.length ? tags.map((t) => chalk.magenta(`#${t}`)).join(" ") : chalk.gray("(no tags)")}`,
      );
    }
    return;
  }

  const removeAll = args.clear ? [...new Set(tasks.flatMap((t) => t.tags ?? []))] : remove;
  const changes = db.bulkEditTags(ids, { add, remove: removeAll });
  const overflow = tasks.some((t) => new Set([...(t.tags ?? []), ...add]).size > MAX_TAGS_PER_TASK);
  if (changes.length === 0) {
    console.log(chalk.gray("tags unchanged"));
    return;
  }
  db.recordUndo({
    op_kind: "tags",
    payload: { tasks: changes.map((c) => ({ id: c.id, tags: c.after })) },
    inverse: { tasks: changes.map((c) => ({ id: c.id, tags: c.before })) },
  });
  for (const change of changes) {
    console.log(
      chalk.green(`✓ #${change.id} `) +
        (change.after.length ? change.after.map((t) => chalk.magenta(`#${t}`)).join(" ") : chalk.gray("(no tags)")),
    );
  }
  if (overflow) console.log(chalk.yellow(`  note: tasks keep at most ${MAX_TAGS_PER_TASK} tags; extras were dropped`));
  console.log(chalk.gray("  undo: relay undo"));
}

export function runTags(opts: { json?: boolean } = {}): void {
  using db = new RelayDB();
  const counts = db.listTagCounts();
  if (opts.json) {
    console.log(JSON.stringify(counts, null, 2));
    return;
  }
  if (counts.length === 0) {
    console.log(chalk.gray("no tags yet — add some with `relay tag <id> <tag...>`"));
    return;
  }
  const width = Math.max(...counts.map((c) => c.tag.length)) + 1;
  for (const c of counts) {
    console.log(`${chalk.magenta(`#${c.tag}`.padEnd(width + 1))} ${String(c.open).padStart(4)} open ${chalk.gray(`/ ${c.total} total`)}`);
  }
  console.log(chalk.gray("\nfilter: relay ls --tag <tag>   (Web: tag:<tag> in the filter bar)"));
}

export function runBlock(taskId: number, blockerIds: number[]): void {
  using db = new RelayDB();
  const task = db.getTask(taskId);
  if (!task) {
    console.log(chalk.red(`task #${taskId} not found`));
    process.exit(1);
  }
  const added: Array<{ task_id: number; depends_on_id: number }> = [];
  let failed = false;
  for (const blocker of blockerIds) {
    const result = db.addDependency(taskId, blocker);
    if (!result.ok) {
      console.log(chalk.red(`✗ ${result.message}`));
      failed = true;
      continue;
    }
    if (result.added) added.push({ task_id: taskId, depends_on_id: blocker });
    else console.log(chalk.gray(`– #${taskId} already waits on #${blocker}`));
  }
  if (added.length > 0) {
    recordDepsUndo(db, added, []);
    const info = db.dependencyInfo(taskId);
    console.log(
      chalk.green(`✓ #${taskId} is now blocked by ${added.map((e) => `#${e.depends_on_id}`).join(" ")}`) +
        chalk.gray(
          info.open_blocker_ids.length > 0
            ? ` — hidden from today until ${info.open_blocker_ids.map((id) => `#${id}`).join(" ")} ${info.open_blocker_ids.length === 1 ? "is" : "are"} done`
            : " — every blocker is already done",
        ),
    );
    console.log(chalk.gray("  undo: relay undo"));
  }
  if (failed) process.exitCode = 1;
}

export function runUnblock(taskId: number, blockerIds: number[]): void {
  using db = new RelayDB();
  if (!db.getTask(taskId)) {
    console.log(chalk.red(`task #${taskId} not found`));
    process.exit(1);
  }
  const targets = blockerIds.length > 0 ? blockerIds : db.blockerIdsOf(taskId);
  const removed: Array<{ task_id: number; depends_on_id: number }> = [];
  for (const blocker of targets) {
    if (db.removeDependency(taskId, blocker)) removed.push({ task_id: taskId, depends_on_id: blocker });
  }
  if (removed.length === 0) {
    console.log(chalk.gray(blockerIds.length > 0 ? "no matching dependency" : `#${taskId} has no dependencies`));
    return;
  }
  recordDepsUndo(db, [], removed);
  console.log(chalk.green(`✓ #${taskId} no longer waits on ${removed.map((e) => `#${e.depends_on_id}`).join(" ")}`));
  console.log(chalk.gray("  undo: relay undo"));
}
