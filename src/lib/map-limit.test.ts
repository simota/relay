import { describe, expect, test } from "bun:test";
import { mapLimit } from "./map-limit.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapLimit", () => {
  test("keeps input order regardless of completion order", async () => {
    const delays = [30, 5, 20, 1, 10];
    const out = await mapLimit(delays, 3, async (d, i) => {
      await sleep(d);
      return `${i}:${d}`;
    });
    expect(out).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10"]);
  });

  test("never runs more than `limit` calls at once", async () => {
    let running = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running++;
      peak = Math.max(peak, running);
      await sleep(2);
      running--;
    });
    expect(peak).toBe(4);
  });

  test("empty input and limit larger than input", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
    expect(await mapLimit([1, 2], 10, async (x) => x * 2)).toEqual([2, 4]);
    expect(await mapLimit([1, 2], 0, async (x) => x)).toEqual([1, 2]);
  });

  test("rejects with the lowest-index failure, like a sequential loop", async () => {
    // Index 4 fails first in time, index 2 fails later: a sequential loop
    // would have thrown index 2's error.
    const started: number[] = [];
    const err = await mapLimit([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5, async (i) => {
      started.push(i);
      if (i === 4) throw new Error("fail 4");
      if (i === 2) {
        await sleep(20);
        throw new Error("fail 2");
      }
      await sleep(5);
      return i;
    }).catch((e: Error) => e);
    expect((err as Error).message).toBe("fail 2");
    // No new work starts after the first failure.
    expect(started.length).toBeLessThan(10);
  });
});
