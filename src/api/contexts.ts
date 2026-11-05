import { Hono } from "hono";
import { RelayDB } from "../db/client.js";

export function createContextsApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const repo = c.req.query("repo");
    const limit = parseLimit(c.req.query("limit"), 50);
    using db = new RelayDB();
    const contexts = db.listContexts(repo, limit);
    return c.json(contexts);
  });

  app.get("/graph", (c) => {
    const repo = c.req.query("repo");
    const limit = parseLimit(c.req.query("limit"), 200);
    using db = new RelayDB();
    const graph = db.contextGraph({ repo, limit });
    return c.json(graph);
  });

  app.get("/:hash", (c) => {
    using db = new RelayDB();
    const ctx = db.getContext(c.req.param("hash"));
    if (!ctx) return c.json({ error: "not found" }, 404);
    return c.json(ctx);
  });

  return app;
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const limit = Number(value);
  if (!Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), 500);
}
