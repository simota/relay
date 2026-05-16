import { Hono } from "hono";

export function createClientErrorsApi() {
  const app = new Hono();

  app.post("/", async (c) => {
    const body = await c.req.text().catch(() => "");
    console.error("client error reported", body ? body.slice(0, 2_000) : "(empty body)");
    return c.body(null, 204);
  });

  return app;
}
