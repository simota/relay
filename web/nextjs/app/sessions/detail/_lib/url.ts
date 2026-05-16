import type { SessionType } from "@/lib/api";
import { MAX_TILES, VALID_TYPES } from "../_constants";
import type { TileSpec } from "../_types";

/**
 * Parse `?s=type:id&s=type:id` (new) or `?type=...&id=...` (legacy).
 * Returns at most MAX_TILES specs; excess entries are warned and dropped.
 */
export function parseTileSpecs(params: URLSearchParams): TileSpec[] {
  const sValues = params.getAll("s");

  if (sValues.length > 0) {
    const specs: TileSpec[] = [];
    for (const s of sValues) {
      const colonIdx = s.indexOf(":");
      if (colonIdx === -1) continue;
      const type = s.slice(0, colonIdx) as SessionType;
      const id = decodeURIComponent(s.slice(colonIdx + 1));
      if (!VALID_TYPES.includes(type) || id.length === 0) continue;
      specs.push({ type, id });
    }
    if (specs.length > MAX_TILES) {
      console.warn(
        `[relay] sessions/detail: ${specs.length} tiles requested, capping at ${MAX_TILES}`,
      );
      return specs.slice(0, MAX_TILES);
    }
    return specs;
  }

  // Legacy: ?type=claude&id=xxx
  const typeParam = params.get("type") ?? "";
  const id = params.get("id") ?? "";
  if (VALID_TYPES.includes(typeParam as SessionType) && id.length > 0) {
    return [{ type: typeParam as SessionType, id }];
  }

  return [];
}

export function buildDetailUrl(specs: TileSpec[]): string {
  const parts = specs
    .map((s) => `s=${s.type}:${encodeURIComponent(s.id)}`)
    .join("&");
  return `/sessions/detail${parts.length > 0 ? `?${parts}` : ""}`;
}
