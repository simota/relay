// Cross-process lock for `relay queue run` / the Web queue runner.
//
// Two queue runners working the same `queue_items` would both pick the head
// item and launch the same agent twice in the same repo. The lock is a JSON
// file under RELAY_HOME created with O_EXCL; a lock left behind by a dead
// process (crash, SIGKILL) is detected by pid and taken over.

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { RELAY_HOME } from "../paths.js";

export interface QueueLockInfo {
  pid: number;
  owner: string;
  started_at: string;
}

export function queueLockPath(): string {
  return join(RELAY_HOME, "queue-run.lock");
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The live holder of the lock, or null when it is free (stale locks count as free). */
export function readQueueLock(): QueueLockInfo | null {
  const path = queueLockPath();
  if (!existsSync(path)) return null;
  try {
    const info = JSON.parse(readFileSync(path, "utf8")) as QueueLockInfo;
    return pidAlive(info.pid) ? info : null;
  } catch {
    return null;
  }
}

export type QueueLockResult = { ok: true; release: () => void } | { ok: false; heldBy: QueueLockInfo };

export function acquireQueueLock(owner: string): QueueLockResult {
  const path = queueLockPath();
  mkdirSync(RELAY_HOME, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      const info: QueueLockInfo = { pid: process.pid, owner, started_at: new Date().toISOString() };
      writeSync(fd, JSON.stringify(info));
      closeSync(fd);
      let released = false;
      return {
        ok: true,
        release: () => {
          if (released) return;
          released = true;
          try {
            const current = JSON.parse(readFileSync(path, "utf8")) as QueueLockInfo;
            if (current.pid === process.pid) unlinkSync(path);
          } catch {
            // already gone
          }
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = readQueueLock();
      if (holder) return { ok: false, heldBy: holder };
      // Stale (dead pid or unreadable): remove and try once more.
      try {
        unlinkSync(path);
      } catch {
        // someone else removed it first
      }
    }
  }
  const holder = readQueueLock();
  return { ok: false, heldBy: holder ?? { pid: 0, owner: "unknown", started_at: "" } };
}
