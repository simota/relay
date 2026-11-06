import { describe, expect, test } from "bun:test";
import type { AdapterContext } from "../types.js";
import { memoizedScan } from "./scan-memo.js";

function ctxWith(scanMemo?: Map<string, Promise<unknown>>): AdapterContext {
  return { roots: [], scanMemo } as unknown as AdapterContext;
}

describe("memoizedScan", () => {
  test("without a run memo every call scans (pre-memo behavior)", async () => {
    let calls = 0;
    const ctx = ctxWith();
    await memoizedScan(ctx, "k", async () => ++calls);
    await memoizedScan(ctx, "k", async () => ++calls);
    expect(calls).toBe(2);
  });

  test("fetch + fetchResolved in one run share a single scan", async () => {
    let calls = 0;
    const memo = new Map<string, Promise<unknown>>();
    // runSync shallow-clones ctx per adapter / for the resolved sweep; the
    // Map reference is shared across those clones.
    const fetchCtx = { ...ctxWith(memo), lastSyncCursor: "a" };
    const resolvedCtx = { ...ctxWith(memo), lastSyncCursor: "b" };
    const first = await memoizedScan(fetchCtx, "git_stash", async () => ({ n: ++calls }));
    const second = await memoizedScan(resolvedCtx, "git_stash", async () => ({ n: ++calls }));
    expect(calls).toBe(1);
    expect(second).toBe(first);
  });

  test("keys are per adapter", async () => {
    const memo = new Map<string, Promise<unknown>>();
    const a = await memoizedScan(ctxWith(memo), "agents_note", async () => "a");
    const b = await memoizedScan(ctxWith(memo), "docs_checklist", async () => "b");
    expect([a, b]).toEqual(["a", "b"]);
  });

  test("a failed scan is not reused", async () => {
    const memo = new Map<string, Promise<unknown>>();
    const ctx = ctxWith(memo);
    await expect(memoizedScan(ctx, "k", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(memo.has("k")).toBe(false);
    expect(await memoizedScan(ctx, "k", async () => "ok")).toBe("ok");
  });
});
