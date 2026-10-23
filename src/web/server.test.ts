// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { beforeAll, describe, expect, test } from "bun:test";
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
