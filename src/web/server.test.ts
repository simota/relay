// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { CONFIG_PATH } from "../paths.js";
import { RelayDB } from "../db/client.js";
import { INSIGHTS_CACHE_MAX_ENTRIES, insightsCacheSize } from "../api/insights.js";
import { join } from "node:path";
import { buildApp, cacheControlFor } from "./server.js";

let app: ReturnType<typeof buildApp>;
beforeAll(() => {
  app = buildApp();
});

function createTask(headers: Record<string, string>) {
  return app.request("http://127.0.0.1:7340/api/tasks", {
    method: "POST",
    headers,
    body: JSON.stringify({ repo: "demo", title: "from test" }),
  });
}

describe("cross-site request guard", () => {
  test("rejects a cross-site simple POST (no CORS preflight)", async () => {
    const res = await createTask({ "content-type": "text/plain", origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  test("rejects an opaque `null` origin", async () => {
    const res = await createTask({ "content-type": "text/plain", origin: "null" });
    expect(res.status).toBe(403);
  });

  test("rejects a cross-site request flagged only by Sec-Fetch-Site", async () => {
    const res = await createTask({ "content-type": "text/plain", "sec-fetch-site": "cross-site" });
    expect(res.status).toBe(403);
  });

  test("allows same-origin, localhost dev-server, and non-browser clients", async () => {
    const sameOrigin = await createTask({ "content-type": "application/json", origin: "http://127.0.0.1:7340" });
    expect(sameOrigin.status).toBe(201);
    const devServer = await createTask({ "content-type": "application/json", origin: "http://localhost:3340" });
    expect(devServer.status).toBe(201);
    const curl = await createTask({ "content-type": "application/json" });
    expect(curl.status).toBe(201);
  });

  test("allows [::1] dev origins", async () => {
    const res = await createTask({ "content-type": "application/json", origin: "http://[::1]:3340" });
    expect(res.status).toBe(201);
  });

  test("rejects a cross-site trigger of the writing GET /api/sync/stream", async () => {
    const img = await app.request("http://127.0.0.1:7340/api/sync/stream", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(img.status).toBe(403);
    const eventSource = await app.request("http://127.0.0.1:7340/api/sync/stream", {
      headers: { origin: "https://evil.example" },
    });
    expect(eventSource.status).toBe(403);
  });

  test("allows same-origin requests when served on a non-loopback --host", async () => {
    const lanApp = buildApp({ host: "192.168.1.20" });
    const res = await lanApp.request("http://192.168.1.20:7340/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", host: "192.168.1.20:7340", origin: "http://192.168.1.20:7340" },
      body: JSON.stringify({ repo: "demo", title: "lan" }),
    });
    expect(res.status).toBe(201);
  });

  test("rejects DNS-rebinding hosts for writes and reads", async () => {
    const rebound = { host: "attacker.example:7340", origin: "http://attacker.example:7340" };
    const write = await app.request("http://attacker.example:7340/api/tasks", {
      method: "POST",
      headers: { ...rebound, "content-type": "application/json" },
      body: JSON.stringify({ repo: "demo", title: "rebound" }),
    });
    expect(write.status).toBe(403);
    const read = await app.request("http://attacker.example:7340/api/tasks", { headers: rebound });
    expect(read.status).toBe(403);
  });

  test("a wildcard --host bind accepts IP-literal hosts but not rebound names", async () => {
    const wildcard = buildApp({ host: "0.0.0.0" });
    const lan = await wildcard.request("http://192.168.1.20:7340/api/health");
    expect(lan.status).toBe(200);
    const rebound = await wildcard.request("http://attacker.example:7340/api/tasks", {
      method: "POST",
      headers: { host: "attacker.example:7340", origin: "http://attacker.example:7340", "content-type": "application/json" },
      body: JSON.stringify({ repo: "demo", title: "rebound" }),
    });
    expect(rebound.status).toBe(403);
  });

  test("matches a --host DNS name case-insensitively", async () => {
    const res = await buildApp({ host: "Relay.Local" }).request("http://relay.local:7340/api/health");
    expect(res.status).toBe(200);
  });

  test("rejects cross-site GETs, which can also write (sessions scan, sync stream)", async () => {
    const scan = await app.request("http://127.0.0.1:7340/api/sessions/scan-live", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(scan.status).toBe(403);
    const read = await app.request("http://127.0.0.1:7340/api/health", {
      headers: { origin: "https://evil.example" },
    });
    expect(read.status).toBe(403);
  });

  test("allows same-origin and address-bar GETs", async () => {
    const sameOrigin = await app.request("http://127.0.0.1:7340/api/health", {
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(sameOrigin.status).toBe(200);
    const typed = await app.request("http://127.0.0.1:7340/api/health", {
      headers: { "sec-fetch-site": "none" },
    });
    expect(typed.status).toBe(200);
  });
});

describe("task state writes", () => {
  const base = "http://127.0.0.1:7340";
  const json = { "content-type": "application/json" };

  async function newTask(extra: Record<string, unknown> = {}) {
    const res = await app.request(`${base}/api/tasks`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ repo: "demo", title: "state", ...extra }),
    });
    return { status: res.status, task: (await res.json()) as { id: number; due_at: string | null; status: string; closed_at: string | null } };
  }

  function undoCount() {
    const db = new RelayDB();
    const n = db.listUndo(1000).length;
    db.close();
    return n;
  }

  test("a same-status transition writes no undo entry and keeps closed_at", async () => {
    const { task } = await newTask();
    const first = await app.request(`${base}/api/tasks/${task.id}/close`, { method: "POST" });
    const closed = (await first.json()) as { closed_at: string };
    const before = undoCount();
    await Bun.sleep(5);
    const again = await app.request(`${base}/api/tasks/${task.id}/close`, { method: "POST" });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { closed_at: string }).closed_at).toBe(closed.closed_at);
    expect(undoCount()).toBe(before);
  });

  test("POST /api/tasks rejects an invalid due_at and stores a date as an instant", async () => {
    expect((await newTask({ due_at: "not a date" })).status).toBe(400);
    expect((await newTask({ due_at: "1" })).status).toBe(400);
    const { status, task } = await newTask({ due_at: "2026-10-25" });
    expect(status).toBe(201);
    expect(task.due_at).toBe(new Date(2026, 9, 25).toISOString());
  });

  test("bulk snooze leaves done tasks done and records only changed rows", async () => {
    const { task: done } = await newTask();
    await app.request(`${base}/api/tasks/${done.id}/close`, { method: "POST" });
    const { task: open } = await newTask();
    const before = undoCount();
    const until = "2027-01-01T00:00:00.000Z";
    const snooze = () =>
      app.request(`${base}/api/tasks/bulk/snooze`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ ids: [done.id, open.id], until }),
      });
    expect(await (await snooze()).json()).toEqual({ ok: true, count: 1 });
    expect(undoCount()).toBe(before + 1);
    // Undo / redo must only touch the row that changed, never the done one.
    const latest = (() => {
      const db = new RelayDB();
      const row = db.listUndo(1)[0]!;
      db.close();
      return row;
    })();
    const ids = (side: string) => (JSON.parse(side) as { tasks: Array<{ id: number }> }).tasks.map((t) => t.id);
    expect(latest.op_kind).toBe("bulk_snooze");
    expect(ids(latest.payload)).toEqual([open.id]);
    expect(ids(latest.inverse)).toEqual([open.id]);
    // Re-snoozing to the same until changes nothing.
    expect(await (await snooze()).json()).toEqual({ ok: true, count: 0 });
    expect(undoCount()).toBe(before + 1);

    const db = new RelayDB();
    expect(db.getTask(done.id)?.status).toBe("done");
    expect(db.getTask(open.id)?.status).toBe("snoozed");
    db.close();

    const bad = await app.request(`${base}/api/tasks/bulk/snooze`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ ids: [open.id], until: "1" }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("query parameter lookups", () => {
  test("Object.prototype keys fall back instead of throwing", async () => {
    for (const path of ["/api/digest?since=constructor", "/api/digest?since=__proto__", "/api/standup?since=constructor"]) {
      const res = await app.request(`http://127.0.0.1:7340${path}`);
      expect(res.status).toBe(200);
    }
    const heatmap = await app.request("http://127.0.0.1:7340/api/insights/heatmap?period=constructor");
    expect(heatmap.status).toBe(400);
  });

  test("the insights heatmap rejects multi-year ranges", async () => {
    const huge = await app.request("http://127.0.0.1:7340/api/insights/heatmap?from=0001-01-01&to=9999-12-31");
    expect(huge.status).toBe(400);
    const year = await app.request("http://127.0.0.1:7340/api/insights/heatmap?from=2026-01-01&to=2026-12-31");
    expect(year.status).toBe(200);
  });
});

describe("insights response cache", () => {
  test("stays bounded when every request carries a unique query string", async () => {
    for (let i = 0; i < INSIGHTS_CACHE_MAX_ENTRIES + 40; i++) {
      const res = await app.request(`http://127.0.0.1:7340/api/insights/throughput?window=7d&_=${i}`);
      expect(res.status).toBe(200);
    }
    expect(insightsCacheSize()).toBeLessThanOrEqual(INSIGHTS_CACHE_MAX_ENTRIES);
  });

  test("still serves repeated identical requests", async () => {
    const a = await (await app.request("http://127.0.0.1:7340/api/insights/throughput?window=30d")).json();
    const b = await (await app.request("http://127.0.0.1:7340/api/insights/throughput?window=30d")).json();
    expect(b).toEqual(a);
  });
});

describe("sync SSE streams", () => {
  test("a failure of the whole run is reported as a sync_error event", async () => {
    const original = existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : null;
    writeFileSync(CONFIG_PATH, "[scan\nroots = ");
    try {
      const res = await app.request("http://127.0.0.1:7340/api/sync/preview");
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("event: sync_error");
      expect(body).toContain("message");
    } finally {
      if (original === null) rmSync(CONFIG_PATH, { force: true });
      else writeFileSync(CONFIG_PATH, original);
    }
  });
});

describe("queue, runs, and bulk assign APIs", () => {
  async function newTask(title: string): Promise<number> {
    const res = await app.request("http://127.0.0.1:7340/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "demo", title }),
    });
    return ((await res.json()) as { id: number }).id;
  }
  const json = (method: string, body: unknown) => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  test("bulk queue keeps order, dedupes, and supports front + move", async () => {
    await app.request("http://127.0.0.1:7340/api/queue", { method: "DELETE" });
    const a = await newTask("queue a");
    const b = await newTask("queue b");
    const c = await newTask("queue c");
    const res = await app.request("http://127.0.0.1:7340/api/queue/items", json("POST", { task_ids: [a, b, a] }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { count: number }).count).toBe(2);
    await app.request("http://127.0.0.1:7340/api/queue/items", json("POST", { task_id: c, front: true }));
    let items = (await (await app.request("http://127.0.0.1:7340/api/queue")).json()) as Array<{ id: number; task_id: number; title: string }>;
    expect(items.map((item) => item.task_id)).toEqual([c, a, b]);
    expect(items[0]?.title).toBe("queue c");

    const last = items[2]!;
    const moved = await app.request(`http://127.0.0.1:7340/api/queue/items/${last.id}/move`, json("POST", { direction: "up" }));
    expect(moved.status).toBe(200);
    items = (await (await app.request("http://127.0.0.1:7340/api/queue")).json()) as typeof items;
    expect(items.map((item) => item.task_id)).toEqual([c, b, a]);

    const bad = await app.request(`http://127.0.0.1:7340/api/queue/items/${last.id}/move`, json("POST", { direction: "sideways" }));
    expect(bad.status).toBe(400);
    const missing = await app.request("http://127.0.0.1:7340/api/queue/items", json("POST", { task_ids: ["x"] }));
    expect(missing.status).toBe(400);
  });

  test("bulk assign changes every task and is undoable in one step", async () => {
    const a = await newTask("assign a");
    const b = await newTask("assign b");
    const res = await app.request("http://127.0.0.1:7340/api/tasks/bulk/assign", json("POST", { ids: [a, b], assignee: "codex" }));
    expect(((await res.json()) as { count: number }).count).toBe(2);
    {
      using db = new RelayDB();
      expect(db.getTask(a)?.assignee).toBe("codex");
      expect(db.getTask(b)?.assignee).toBe("codex");
    }
    const undo = await app.request("http://127.0.0.1:7340/api/undo", { method: "POST" });
    expect(((await undo.json()) as { op_kind: string }).op_kind).toBe("reassign");
    using db = new RelayDB();
    expect(db.getTask(a)?.assignee).toBe("self");
    expect(db.getTask(b)?.assignee).toBe("self");

    const invalid = await app.request("http://127.0.0.1:7340/api/tasks/bulk/assign", json("POST", { ids: [a], assignee: "robot" }));
    expect(invalid.status).toBe(400);
  });

  test("runs list joins task info; log 404s when nothing was captured", async () => {
    const id = await newTask("run history");
    let runId: number;
    {
      using db = new RelayDB();
      runId = db.insertRun(id, "codex");
      db.finishRun(runId, "failed", "exit 2");
    }
    const res = await app.request(`http://127.0.0.1:7340/api/runs?task_id=${id}`);
    const rows = (await res.json()) as Array<{ id: number; task_title: string; status: string; has_log: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: runId, task_title: "run history", status: "failed", has_log: false });
    const log = await app.request(`http://127.0.0.1:7340/api/runs/${runId}/log`);
    expect(log.status).toBe(404);
    const badStatus = await app.request("http://127.0.0.1:7340/api/runs?status=weird");
    expect(badStatus.status).toBe(400);
  });
});

describe("static asset caching", () => {
  const root = "/srv/out";
  test("content-hashed Next.js build output is cached as immutable", () => {
    for (const rel of ["_next/static/chunks/app-3f9c1b.js", "_next/static/css/a1b2.css", "_next/static/BUILD_ID/_buildManifest.js"]) {
      expect(cacheControlFor(root, join(root, rel))).toBe("public, max-age=31536000, immutable");
    }
  });

  test("HTML and everything outside _next/static stays no-store", () => {
    for (const rel of ["index.html", "sessions/index.html", "favicon.ico", "_next/staticx/a.js", "_next/data.json", "_next/static"]) {
      expect(cacheControlFor(root, join(root, rel))).toBe("no-store");
    }
    // join() normalizes `..`, so an escape attempt never lands under _next/static.
    expect(cacheControlFor(root, join(root, "_next/static/../../index.html"))).toBe("no-store");
  });

  test("pages are served no-store", async () => {
    const res = await app.request("http://127.0.0.1:7340/", { headers: { host: "127.0.0.1:7340" } });
    expect(res.status).toBe(200);
    // The "frontend not built" placeholder carries no cache-control at all.
    expect(res.headers.get("cache-control") ?? "no-store").toBe("no-store");
  });
});
