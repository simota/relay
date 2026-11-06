import { Hono, type Context } from "hono";
import { getConnInfo } from "hono/bun";
import { QueueBusyError } from "../commands/queue.js";
import { RelayDB } from "../db/client.js";
import { readQueueLock } from "../lib/queue-lock.js";
import { queueRunner, type QueueRunner } from "../lib/queue-runner.js";

// Matches MAX_BULK_IDS in tasks.ts: "queue all visible" always fits.
const MAX_QUEUE_IDS = 2000;

export interface QueueApiOptions {
  runner?: QueueRunner;
  /**
   * Whether a request may start agent runs. Default: the TCP peer is a
   * loopback address. `relay web --host 0.0.0.0` exposes the API to the LAN,
   * and starting a headless agent (which edits code with the permissions in
   * [agents].*_headless_args) must stay a same-machine action.
   */
  isLocalRequest?: (c: Context) => boolean;
}

export function isLoopbackPeer(c: Context): boolean {
  try {
    const address = getConnInfo(c).remote.address ?? "";
    return address === "::1" || address.startsWith("127.") || address === "::ffff:127.0.0.1" || /^::ffff:127\./.test(address);
  } catch {
    // No Bun server in env (e.g. app.request in tests): not provably local.
    return false;
  }
}

export function createQueueApi(opts: QueueApiOptions = {}) {
  const app = new Hono();
  const runner = opts.runner ?? queueRunner;
  const isLocal = opts.isLocalRequest ?? isLoopbackPeer;

  // --- Headless runner (`relay queue run --headless` from the Web tray) ---
  // GET reports this server's runner plus any other process holding the
  // queue lock (a terminal `relay queue run`), so the tray can say why the
  // run button is disabled.
  app.get("/runner", (c) => {
    const state = runner.snapshot();
    const holder = runner.running ? null : readQueueLock();
    return c.json({ ...state, external: holder, can_start: isLocal(c) });
  });

  app.post("/runner", async (c) => {
    if (!isLocal(c)) {
      return c.json({ error: "agent runs can only be started from this machine (loopback)" }, 403);
    }
    const body = ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    const retries = body.retries === undefined ? undefined : Number(body.retries);
    if (retries !== undefined && (!Number.isInteger(retries) || retries < 0 || retries > 5)) {
      return c.json({ error: "retries must be an integer 0-5" }, 400);
    }
    const limit = body.limit === undefined || body.limit === null ? undefined : Number(body.limit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      return c.json({ error: "limit must be a positive integer" }, 400);
    }
    {
      using db = new RelayDB();
      if (db.listQueueItems().length === 0) return c.json({ error: "queue is empty" }, 409);
    }
    try {
      const state = runner.start({
        verify: typeof body.verify === "boolean" ? body.verify : undefined,
        retries,
        closeOnSuccess: body.close_on_success === true,
        continueOnError: body.continue_on_error !== false,
        limit,
      });
      return c.json(state, 202);
    } catch (e) {
      if (e instanceof QueueBusyError) return c.json({ error: e.message, holder: e.holder }, 409);
      throw e;
    }
  });

  // Graceful stop: the agent that is running finishes, nothing new starts.
  app.post("/runner/stop", (c) => {
    if (!isLocal(c)) return c.json({ error: "only from this machine (loopback)" }, 403);
    const stopped = runner.stop();
    return c.json({ ok: stopped, ...runner.snapshot() });
  });

  app.get("/", (c) => {
    using db = new RelayDB();
    const items = db.listQueueItems();
    return c.json(items);
  });

  // `{ task_id }` queues one task; `{ task_ids: [...] }` queues several in
  // order. `front: true` puts them at the head. Re-queuing an already
  // queued task returns its existing item instead of duplicating it.
  app.post("/items", async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const front = body?.front === true;
    if (Array.isArray(body?.task_ids)) {
      const ids = parseTaskIds(body.task_ids);
      if (!ids) return c.json({ error: "task_ids must be positive integers" }, 400);
      using db = new RelayDB();
      const ordered = front ? [...ids].reverse() : ids;
      const added: number[] = [];
      const missing: number[] = [];
      for (const taskId of ordered) {
        const itemId = db.addQueueItem(taskId, { front });
        if (itemId === null) missing.push(taskId);
        else added.push(taskId);
      }
      return c.json({ ok: true, count: added.length, missing }, 201);
    }
    const taskId = typeof body?.task_id === "number" ? body.task_id : Number(body?.task_id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return c.json({ error: "task_id required" }, 400);
    }

    using db = new RelayDB();
    const id = db.addQueueItem(taskId, { front });
    if (id === null) return c.json({ error: "task not found" }, 404);
    return c.json({ id }, 201);
  });

  // Retry what broke: queue every not-done task whose latest run failed or
  // was interrupted (`relay queue add --failed` parity). Already-queued
  // tasks are not duplicated. `{ front: true }` puts them at the head.
  app.post("/retry-failed", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { front?: unknown } | null;
    const front = body?.front === true;
    using db = new RelayDB();
    const queued = new Set(db.listQueueItems().map((item) => item.task_id));
    const ids = db.failedTaskIds().filter((id) => !queued.has(id));
    for (const taskId of front ? [...ids].reverse() : ids) db.addQueueItem(taskId, { front });
    return c.json({ ok: true, count: ids.length, task_ids: ids });
  });

  // How many failed runs could be retried (drives the tray's retry button).
  app.get("/retry-failed", (c) => {
    using db = new RelayDB();
    const queued = new Set(db.listQueueItems().map((item) => item.task_id));
    const ids = db.failedTaskIds().filter((id) => !queued.has(id));
    return c.json({ count: ids.length, task_ids: ids });
  });

  // Re-order: `{ direction: "up" | "down" | "front" }`.
  app.post("/items/:id/move", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad id" }, 400);
    const body = (await c.req.json().catch(() => null)) as { direction?: unknown } | null;
    const direction = body?.direction;
    if (direction !== "up" && direction !== "down" && direction !== "front") {
      return c.json({ error: "direction must be up, down or front" }, 400);
    }
    using db = new RelayDB();
    if (!db.listQueueItems().some((item) => item.id === id)) return c.json({ error: "not found" }, 404);
    const moved = direction === "front" ? db.moveQueueItemToFront(id) : db.moveQueueItem(id, direction);
    return c.json({ ok: true, moved });
  });

  app.delete("/items/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "bad id" }, 400);
    using db = new RelayDB();
    db.deleteQueueItem(id);
    return c.json({ ok: true });
  });

  app.delete("/", (c) => {
    using db = new RelayDB();
    db.clearQueue();
    return c.json({ ok: true });
  });

  return app;
}

function parseTaskIds(value: unknown[]): number[] | null {
  if (value.length === 0 || value.length > MAX_QUEUE_IDS) return null;
  const ids = value.map((id) => (typeof id === "number" ? id : Number(id)));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return null;
  return Array.from(new Set(ids));
}
