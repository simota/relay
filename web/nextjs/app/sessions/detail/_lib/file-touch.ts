import type { SessionToolCall } from "@/lib/api";

export interface FileTouch {
  path: string;
  reads: number;
  writes: number;
  edits: number;
  total: number;
}

const MAX_ROWS = 20;

function parseJson(argsJson: string | null): Record<string, unknown> | null {
  if (!argsJson) return null;
  try {
    const v = JSON.parse(argsJson);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function strVal(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function extractFileTouches(calls: SessionToolCall[]): FileTouch[] {
  const byPath = new Map<string, FileTouch>();
  for (const tc of calls) {
    const name = tc.name;
    if (name !== "Read" && name !== "Write" && name !== "Edit" && name !== "MultiEdit") {
      continue;
    }
    const obj = parseJson(tc.args_json);
    if (!obj) continue;
    const path = strVal(obj.file_path) ?? strVal(obj.path);
    if (!path) continue;

    const entry = byPath.get(path) ?? {
      path,
      reads: 0,
      writes: 0,
      edits: 0,
      total: 0,
    };

    if (name === "Read") {
      entry.reads += 1;
      entry.total += 1;
    } else if (name === "Write") {
      entry.writes += 1;
      entry.total += 1;
    } else if (name === "Edit") {
      entry.edits += 1;
      entry.total += 1;
    } else {
      // MultiEdit — count each edit inside the call.
      const edits = obj.edits;
      const n = Array.isArray(edits) ? edits.length : 1;
      entry.edits += n;
      entry.total += n;
    }
    byPath.set(path, entry);
  }
  return [...byPath.values()]
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_ROWS);
}
