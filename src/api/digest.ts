import { Hono } from "hono";
import { RelayDB } from "../db/client.js";
import { buildDigest, formatJson, formatMarkdown } from "../lib/digest.js";

// GET /api/digest?since=7d&format=md|json
// Returns the same payload as `relay digest`. content-type is chosen by
// format (text/markdown vs application/json) so a browser "Save as…" or a
// `curl -O` produces a usable file directly.
export function createDigestApi() {
  const app = new Hono();

  app.get("/", (c) => {
    const since = c.req.query("since") ?? undefined;
    const formatRaw = (c.req.query("format") ?? "md").toLowerCase();
    if (formatRaw !== "md" && formatRaw !== "markdown" && formatRaw !== "json") {
      return c.json({ error: "format must be md or json" }, 400);
    }
    const db = new RelayDB();
    let body: string;
    try {
      const report = buildDigest(db, { since });
      body = formatRaw === "json" ? formatJson(report) : formatMarkdown(report);
    } finally {
      db.close();
    }
    if (formatRaw === "json") {
      c.header("content-type", "application/json; charset=utf-8");
      return c.body(body);
    }
    c.header("content-type", "text/markdown; charset=utf-8");
    return c.body(body);
  });

  return app;
}
