// Per-sync memo for adapters whose `fetch()` and `fetchResolved()` both
// derive from one full scan (walk repos, run git / gh, parse files).
// `runSync` calls `fetch()` and, once the open sweep succeeded, the
// resolved sweep in the same run; without the memo every such adapter
// re-ran its whole scan (all subprocesses and file reads) a second time
// moments later. With it, both views come from the same snapshot, so the
// tasks ingested and the tasks auto-closed in one run are consistent.
//
// `runSync` owns the Map (AdapterContext.scanMemo) and drops it when the
// run ends, so results never leak into the next sync. Callers that don't
// pass a memo (unit tests, previews) get a fresh scan on every call, as
// before.

import type { AdapterContext } from "../types.js";

export function memoizedScan<T>(ctx: AdapterContext, key: string, scan: () => Promise<T>): Promise<T> {
  const memo = ctx.scanMemo;
  if (!memo) return scan();
  const cached = memo.get(key) as Promise<T> | undefined;
  if (cached) return cached;
  const promise = scan();
  memo.set(key, promise);
  // A failed scan is not reused: the next caller scans again, as it
  // would have without the memo.
  promise.catch(() => {
    if (memo.get(key) === promise) memo.delete(key);
  });
  return promise;
}
