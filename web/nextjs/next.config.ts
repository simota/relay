import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RELAY_API = process.env.RELAY_API ?? "http://127.0.0.1:7340";
const __dirname = dirname(fileURLToPath(import.meta.url));

// Static export mode for `next build` — Hono serves the resulting out/ directory.
// For dev (`next dev`), rewrites proxy /api to Hono on 7340.
const exportMode = process.env.NEXT_EXPORT !== "0";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  output: exportMode ? "export" : undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  ...(exportMode
    ? {}
    : {
        async rewrites() {
          return [
            { source: "/api/:path*", destination: `${RELAY_API}/api/:path*` },
          ];
        },
      }),
};

export default nextConfig;
