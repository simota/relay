/**
 * Map `items` through async `fn` with at most `limit` calls in flight,
 * resolving to the results in input order.
 *
 * Failure behaves like the equivalent sequential `for … await` loop: once a
 * call rejects no further items are started, the calls already in flight
 * are awaited, and the promise rejects with the error of the lowest-index
 * failure. Items are started in input order, so that is the same error the
 * sequential loop would have thrown (every lower index was started and
 * succeeded). At most `limit - 1` extra calls past that item may have run.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failedAt = -1;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (failedAt === -1 && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        if (failedAt === -1 || i < failedAt) {
          failedAt = i;
          failure = e;
        }
      }
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failedAt !== -1) throw failure;
  return results;
}
