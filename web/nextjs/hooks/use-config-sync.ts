"use client";

import { useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";

interface Health {
  status: string;
  version: string;
  frontend: string;
  config_hash: string;
}

/**
 * Poll /api/health every 15s and revalidate /api/config whenever
 * the server reports a different config_hash. Lets edits to
 * ~/.relay/config.toml propagate to the UI without restarting
 * `relay web` or refreshing the page.
 */
export function useConfigSync() {
  const { mutate } = useSWRConfig();
  const lastHash = useRef<string | null>(null);

  useSWR<Health>(
    "/api/health",
    async () => {
      const r = await fetch("/api/health");
      const d = (await r.json()) as Health;
      if (lastHash.current && lastHash.current !== d.config_hash) {
        // Revalidate any config-bound SWR caches.
        mutate("/api/config");
        mutate((key) => typeof key === "string" && key.startsWith("/api/repos/"));
      }
      lastHash.current = d.config_hash;
      return d;
    },
    {
      refreshInterval: 15_000,
      revalidateOnFocus: true,
    },
  );
}
