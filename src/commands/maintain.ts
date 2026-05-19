import { existsSync, statSync } from "node:fs";
import chalk from "chalk";
import { RelayDB } from "../db/client.js";
import { DB_PATH } from "../paths.js";

/**
 * Format a byte count as a short human-readable string (KB / MB / GB).
 * Mirrors the rough style used elsewhere (chalk.gray hints), avoiding any
 * extra dependency.
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const fixed = value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1);
  return `${fixed} ${units[unit]}`;
}

function dbSizeBytes(): number {
  if (!existsSync(DB_PATH)) return 0;
  try {
    return statSync(DB_PATH).size;
  } catch {
    return 0;
  }
}

/**
 * CLI entry point for `relay maintain` — runs `VACUUM` to reclaim free pages
 * after large prune operations (e.g. undo_log trimming during sync). Prints
 * Before/After sizes so the operator can confirm the reclaim worked.
 */
export function runMaintain(): void {
  const before = dbSizeBytes();
  console.log(
    chalk.gray(`db: ${DB_PATH}`) +
      chalk.gray(`  size before: ${formatBytes(before)}`),
  );

  const db = new RelayDB();
  try {
    // Prune first so VACUUM actually has free pages to reclaim. The
    // 7-day window matches the auto-prune step in `runSync` — anything
    // older is well past the practical undo horizon.
    const pruned = db.pruneUndoOlderThan(7);
    if (pruned > 0) {
      console.log(chalk.gray(`· pruned ${pruned} undo_log row(s) older than 7 days`));
    }
    db.vacuum();
  } finally {
    db.close();
  }

  const after = dbSizeBytes();
  const delta = before - after;
  console.log(
    chalk.green("✓ VACUUM complete") +
      chalk.gray(`  size after: ${formatBytes(after)}`) +
      (delta > 0 ? chalk.gray(`  reclaimed: ${formatBytes(delta)}`) : ""),
  );
}
