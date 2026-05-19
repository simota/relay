import type { SessionToolCall } from "@/lib/api";

export interface BashCall {
  command: string;
  runInBackground: boolean;
  timestamp: string;
  count: number;
}

const MAX_ROWS = 8;

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

function boolVal(v: unknown): boolean {
  return v === true;
}

export function extractBashCalls(calls: SessionToolCall[]): BashCall[] {
  const byCommand = new Map<string, BashCall>();
  for (const tc of calls) {
    if (tc.name !== "Bash") continue;
    const obj = parseJson(tc.args_json);
    let command: string | null = null;
    let runInBackground = false;
    if (obj) {
      command = strVal(obj.command) ?? strVal(obj.cmd);
      runInBackground = boolVal(obj.run_in_background);
    }
    if (!command) {
      // Fall back to the server-provided summary so we still surface
      // something when args_json is missing or malformed.
      command = tc.args_summary || null;
    }
    if (!command) continue;
    const key = command.trim();
    if (!key) continue;
    const prev = byCommand.get(key);
    if (prev) {
      prev.count += 1;
      if (Date.parse(tc.timestamp) > Date.parse(prev.timestamp)) {
        prev.timestamp = tc.timestamp;
      }
      prev.runInBackground = prev.runInBackground || runInBackground;
    } else {
      byCommand.set(key, {
        command: key,
        runInBackground,
        timestamp: tc.timestamp,
        count: 1,
      });
    }
  }
  return [...byCommand.values()]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_ROWS);
}
