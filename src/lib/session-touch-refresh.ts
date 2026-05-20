import { stat } from "node:fs/promises";
import type { RelayDB } from "../db/client.js";
import type { SessionRow, SessionType } from "../types.js";

const REFRESH_LIMIT = 200;
const DEFAULT_MIN_DELTA_MS = 500;

export interface RefreshOpts {
  types: readonly SessionType[];
  sinceLastActive?: string;
  includeSubagents?: boolean;
  /**
   * Smallest mtime delta (ms) that triggers an upsert. Below this we treat
   * the file as effectively unchanged, which prevents hot-looping when one
   * append flushes 100s of lines within a few ms.
   */
  minDeltaMs?: number;
}

/**
 * Touch the `last_active` column for sessions whose on-disk source file has
 * been modified since the cached value. Designed for the SSE poll loop:
 * stats are cheap, and bumping `last_active` alone is enough for the fleet
 * view to register a "still alive" signal without re-parsing the JSONL.
 * Full message_count / status / last_message_text refresh still flows
 * through the adapter path during `relay sync`.
 */
export async function refreshLastActiveByMtime(
  db: RelayDB,
  opts: RefreshOpts,
): Promise<number> {
  const minDeltaMs = opts.minDeltaMs ?? DEFAULT_MIN_DELTA_MS;
  const rowsAll: SessionRow[] = [];
  for (const t of opts.types) {
    rowsAll.push(
      ...db.getSessions({
        type: t,
        sinceLastActive: opts.sinceLastActive,
        limit: REFRESH_LIMIT,
        includeSubagents: opts.includeSubagents,
      }),
    );
  }

  let updated = 0;
  await Promise.all(
    rowsAll.map(async (row) => {
      if (!row.source_path) return;
      try {
        const s = await stat(row.source_path);
        const cachedMs = Date.parse(row.last_active);
        if (!Number.isFinite(cachedMs)) return;
        if (s.mtimeMs <= cachedMs + minDeltaMs) return;
        db.upsertSession({
          ...row,
          last_active: new Date(s.mtimeMs).toISOString(),
        });
        updated += 1;
      } catch {
        // Missing or unreadable file — skip; the next `relay sync` will
        // reconcile or evict the row.
      }
    }),
  );
  return updated;
}
