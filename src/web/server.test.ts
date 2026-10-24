// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { beforeAll, describe, expect, test } from "bun:test";
import { RelayDB } from "../db/client.js";
import { buildApp } from "./server.js";

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
