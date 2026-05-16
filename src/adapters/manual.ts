import type { Adapter } from "../types.js";

// `manual` tasks are inserted directly by `relay add` (see
// `src/commands/add.ts`) — they never originate from a remote sweep. The
// registry still wants a placeholder so `allAdapters` is the single source of
// truth for every `SourceType` (see SPEC.md §6) and `findAdapter("manual")`
// returns something concrete instead of `undefined`.
//
// The adapter always precheck-skips with a human-readable reason so
// `relay sync --source manual` surfaces "SKIPPED" in the health view rather
// than pretending it ran. `fetch` is a defensive `[]` for callers that bypass
// precheck (none today, but the interface allows it).
export const manualAdapter: Adapter = {
  name: "manual",

  precheck() {
    return {
      skip: true,
      reason: "manual entries are created via 'relay add' — no sync ingest",
    };
  },

  async fetch() {
    return [];
  },
};
