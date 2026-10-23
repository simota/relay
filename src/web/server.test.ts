import { beforeAll, describe, expect, test } from "bun:test";
import { buildApp } from "./server.js";

// RELAY_HOME points at a throwaway directory (src/test-setup.ts).
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

  test("allows same-origin requests when served on a non-loopback --host", async () => {
    const res = await app.request("http://192.168.1.20:7340/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json", host: "192.168.1.20:7340", origin: "http://192.168.1.20:7340" },
      body: JSON.stringify({ repo: "demo", title: "lan" }),
    });
    expect(res.status).toBe(201);
  });

  test("does not block cross-site reads of safe methods (CORS governs those)", async () => {
    const res = await app.request("http://127.0.0.1:7340/api/health", {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
