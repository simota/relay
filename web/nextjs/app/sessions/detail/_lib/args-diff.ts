// Compute a compact diff glyph for tool calls so the tools tab can show
// at a glance whether a row added/removed lines. Edit/MultiEdit yield a
// signed line delta; Write yields a positive line count; Read yields a
// neutral marker; everything else yields kind=none and is rendered as
// blank in the row.

export type DiffKind = "edit" | "write" | "read" | "none";

export interface DiffGlyph {
  kind: DiffKind;
  delta?: number;
  label: string;
}

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
  return typeof v === "string" ? v : null;
}

function lineCount(s: string): number {
  if (s.length === 0) return 0;
  return s.split("\n").length;
}

function signedLabel(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `${delta}`;
  return "±0";
}

export function computeDiffGlyph(name: string, argsJson: string | null): DiffGlyph {
  if (name === "Read") {
    return { kind: "read", label: "" };
  }

  if (name === "Edit") {
    const obj = parseJson(argsJson);
    if (!obj) return { kind: "none", label: "" };
    const oldStr = strVal(obj.old_string) ?? "";
    const newStr = strVal(obj.new_string) ?? "";
    const delta = lineCount(newStr) - lineCount(oldStr);
    return { kind: "edit", delta, label: signedLabel(delta) };
  }

  if (name === "MultiEdit") {
    const obj = parseJson(argsJson);
    if (!obj) return { kind: "none", label: "" };
    const edits = obj.edits;
    if (!Array.isArray(edits)) return { kind: "none", label: "" };
    let delta = 0;
    for (const e of edits) {
      if (e && typeof e === "object" && !Array.isArray(e)) {
        const rec = e as Record<string, unknown>;
        const oldStr = strVal(rec.old_string) ?? "";
        const newStr = strVal(rec.new_string) ?? "";
        delta += lineCount(newStr) - lineCount(oldStr);
      }
    }
    return { kind: "edit", delta, label: signedLabel(delta) };
  }

  if (name === "Write") {
    const obj = parseJson(argsJson);
    if (!obj) return { kind: "none", label: "" };
    const content = strVal(obj.content) ?? "";
    const lines = lineCount(content);
    return { kind: "write", delta: lines, label: `+${lines}` };
  }

  return { kind: "none", label: "" };
}
