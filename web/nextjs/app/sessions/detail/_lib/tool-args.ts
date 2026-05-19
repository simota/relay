import { truncate, truncatePath } from "./format";

export function parseToolArgs(
  name: string,
  argsJson: string | null,
): { headline: string | null; fields: Array<{ key: string; value: string }> } {
  if (!argsJson) return { headline: null, fields: [] };
  let parsed: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(argsJson);
    if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as Record<string, unknown>;
  } catch {
    return { headline: truncate(argsJson, 120), fields: [] };
  }
  if (!parsed) return { headline: null, fields: [] };

  if (name === "exec_command" || name === "Bash") {
    const cmd = strField(parsed, "cmd") ?? strField(parsed, "command") ?? "";
    const workdir = strField(parsed, "workdir") ?? strField(parsed, "cwd") ?? "";
    return {
      headline: truncate(cmd.split("\n")[0] ?? "", 100),
      fields: dedup([
        ...(workdir ? [{ key: "workdir", value: workdir }] : []),
        ...(cmd ? [{ key: "cmd", value: truncate(cmd, 800) }] : []),
      ]),
    };
  }

  if (name === "apply_patch") {
    const input = strField(parsed, "input") ?? "";
    const files = extractPatchFiles(input);
    return {
      headline: files.length > 0 ? `${files.length} file(s)` : null,
      fields:
        files.length > 0
          ? [{ key: "files", value: files.join("\n") }]
          : [{ key: "patch", value: truncate(input, 800) }],
    };
  }

  if (name === "Read" || name === "Edit" || name === "Write" || name === "NotebookEdit") {
    const file = strField(parsed, "file_path") ?? strField(parsed, "path") ?? "";
    const fields: Array<{ key: string; value: string }> = file
      ? [{ key: "file", value: file }]
      : [];
    const oldStr = strField(parsed, "old_string");
    const newStr = strField(parsed, "new_string");
    if (oldStr) fields.push({ key: "old", value: truncate(oldStr, 300) });
    if (newStr) fields.push({ key: "new", value: truncate(newStr, 300) });
    return { headline: file ? truncatePath(file, 80) : null, fields };
  }

  const entries = Object.entries(parsed)
    .filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
    .slice(0, 3)
    .map(([k, v]) => ({ key: k, value: truncate(String(v), 300) }));
  return {
    headline: entries[0] ? truncate(entries[0].value, 100) : null,
    fields: entries,
  };
}

export function strField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function parseTaskCreateArgs(
  argsJson: string | null,
): { subagent: string | null; description: string | null } | null {
  if (!argsJson) return null;
  let parsed: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(argsJson);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      parsed = v as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  if (!parsed) return null;
  const subagent =
    strField(parsed, "subagent_type") ??
    strField(parsed, "subagent") ??
    strField(parsed, "agent") ??
    strField(parsed, "agent_id");
  const description =
    strField(parsed, "description") ??
    strField(parsed, "prompt") ??
    strField(parsed, "task");
  return { subagent, description };
}

export function dedup(
  items: Array<{ key: string; value: string }>,
): Array<{ key: string; value: string }> {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

export function extractPatchFiles(patch: string): string[] {
  const out: string[] = [];
  const re = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(patch)) !== null) if (m[1]) out.push(m[1]);
  return out;
}
