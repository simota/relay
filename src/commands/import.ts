import { readFileSync } from "node:fs";
import { extname } from "node:path";
import chalk from "chalk";
import { RelayDB, type SnapshotRow } from "../db/client.js";
import type { TaskInput } from "../types.js";

export type ImportKind = "linear" | "things" | "notion" | "generic" | "relay";

export interface ImportOptions {
  from: ImportKind;
  file: string;
  repo?: string;
  dryRun?: boolean;
  readOnly?: boolean;
}

interface NormalizedRow {
  externalId: string;
  title: string;
  body?: string;
  url?: string;
  repo?: string;
  status?: string;
}

const SUPPORTED: ImportKind[] = ["linear", "things", "notion", "generic", "relay"];

export function runImport(opts: ImportOptions): void {
  if (!SUPPORTED.includes(opts.from)) {
    console.log(
      chalk.red(`unsupported --from: ${opts.from}`) +
        chalk.gray(`  (choose: ${SUPPORTED.join(" | ")})`),
    );
    process.exit(1);
  }

  let raw: string;
  try {
    raw = readFileSync(opts.file, "utf8");
  } catch (e) {
    console.log(chalk.red(`could not read ${opts.file}: ${(e as Error).message}`));
    process.exit(1);
  }

  if (opts.from === "relay") {
    runRelaySnapshotImport(raw, opts);
    return;
  }

  const ext = extname(opts.file).toLowerCase();
  const rows = parseAndMap(raw, ext, opts.from);
  if (rows.length === 0) {
    console.log(chalk.yellow(`no importable rows found in ${opts.file}`));
    return;
  }

  const tasks: TaskInput[] = rows.map((r) => toTaskInput(r, opts.from, opts.repo ?? "imported"));

  if (opts.dryRun) {
    console.log(chalk.yellow(`DRY RUN — ${tasks.length} task(s) would be ingested from ${opts.from}:`));
    const preview = tasks.slice(0, 5);
    for (const t of preview) {
      console.log(chalk.gray(`  · ${t.repo}  ${t.title.slice(0, 60)}  (source_id=${t.source_id})`));
    }
    if (tasks.length > preview.length) {
      console.log(chalk.gray(`  … and ${tasks.length - preview.length} more`));
    }
    return;
  }

  const db = new RelayDB();
  const result = db.upsertTasks(tasks);
  db.close();
  console.log(
    chalk.green(`✓ imported from ${opts.from}: `) +
      chalk.gray(
        `${result.inserted} new, ${result.updated} updated, ${result.unchanged} unchanged`,
      ),
  );
}

function runRelaySnapshotImport(raw: string, opts: ImportOptions): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.log(chalk.red(`invalid JSON: ${(e as Error).message}`));
    process.exit(1);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).format !== "relay-snapshot"
  ) {
    console.log(
      chalk.red(`not a relay-snapshot file`) +
        chalk.gray(`  (expected { "format": "relay-snapshot", "version": 1, ... })`),
    );
    process.exit(1);
  }
  const env = parsed as { version: number; tasks?: unknown; machine_hostname?: string };
  if (env.version !== 1) {
    console.log(chalk.red(`unsupported snapshot version: ${env.version}`));
    process.exit(1);
  }
  if (!Array.isArray(env.tasks)) {
    console.log(chalk.red(`snapshot has no 'tasks' array`));
    process.exit(1);
  }

  const rows: SnapshotRow[] = (env.tasks as Array<Record<string, unknown>>).map((t) => ({
    source_type: String(t.source_type ?? "manual"),
    source_id: String(t.source_id),
    repo: String(t.repo ?? "imported"),
    title: String(t.title ?? "(no title)"),
    body: String(t.body ?? ""),
    status: String(t.status ?? "open"),
    assignee: String(t.assignee ?? "self"),
    priority: Number(t.priority ?? 50),
    prompt: (t.prompt as string | null) ?? null,
    files: Array.isArray(t.files) ? (t.files as string[]) : [],
    context_hash: (t.context_hash as string | null) ?? null,
    session_id: (t.session_id as string | null) ?? null,
    due_at: (t.due_at as string | null) ?? null,
    wait_on: typeof t.wait_on === "string" ? t.wait_on : "self",
    created_at: String(t.created_at ?? new Date().toISOString()),
    updated_at: String(t.updated_at ?? new Date().toISOString()),
    closed_at: (t.closed_at as string | null) ?? null,
  }));

  if (opts.dryRun) {
    const db = new RelayDB();
    let wouldInsert = 0;
    let wouldUpdate = 0;
    let wouldConflict = 0;
    const conflictPreview: Array<{ source_id: string; localAt: string; remoteAt: string }> = [];
    for (const r of rows) {
      const existing = db.getTaskBySourceId(r.source_type, r.source_id);
      if (!existing) {
        wouldInsert++;
        continue;
      }
      if (Date.parse(r.updated_at) > Date.parse(existing.updated_at)) {
        wouldUpdate++;
      } else {
        wouldConflict++;
        if (conflictPreview.length < 5) {
          conflictPreview.push({
            source_id: r.source_id,
            localAt: existing.updated_at,
            remoteAt: r.updated_at,
          });
        }
      }
    }
    db.close();
    const tag = opts.readOnly ? "read-only " : "";
    console.log(
      chalk.yellow(
        `DRY RUN — ${rows.length} task(s) from ${tag}snapshot (host=${env.machine_hostname ?? "?"})`,
      ),
    );
    console.log(
      chalk.gray(
        `  would: ${wouldInsert} new, ${wouldUpdate} updated (remote newer), ${wouldConflict} kept (local same-or-newer)`,
      ),
    );
    if (conflictPreview.length > 0) {
      console.log(chalk.gray(`  detail (local kept, last-writer-wins):`));
      for (const c of conflictPreview) {
        console.log(
          chalk.gray(`    · ${c.source_id}  local=${c.localAt}  remote=${c.remoteAt}`),
        );
      }
      if (wouldConflict > conflictPreview.length) {
        console.log(chalk.gray(`    … and ${wouldConflict - conflictPreview.length} more`));
      }
    }
    return;
  }

  const db = new RelayDB();
  const result = db.upsertSnapshot(rows);
  db.close();
  const tag = opts.readOnly ? "read-only " : "";
  console.log(
    chalk.green(`✓ imported ${tag}snapshot from ${env.machine_hostname ?? "?"}: `) +
      chalk.gray(
        `${result.inserted} new, ${result.updated} updated (remote newer), ${result.conflicted} kept (local same-or-newer)`,
      ),
  );
}

function parseAndMap(raw: string, ext: string, kind: ImportKind): NormalizedRow[] {
  if (ext === ".csv") return mapCsv(raw, kind);
  return mapJson(raw, kind);
}

function mapJson(raw: string, kind: ImportKind): NormalizedRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.log(chalk.red(`invalid JSON: ${(e as Error).message}`));
    process.exit(1);
  }
  const records = unwrap(parsed);
  switch (kind) {
    case "linear":
      return records.flatMap((r) => mapLinear(r) ?? []);
    case "things":
      return records.flatMap((r) => mapThings(r) ?? []);
    case "notion":
      return records.flatMap((r) => mapGeneric(r) ?? []);
    default:
      return records.flatMap((r) => mapGeneric(r) ?? []);
  }
}

function unwrap(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["issues", "tasks", "todos", "items", "results"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
    }
  }
  return [];
}

function mapLinear(r: Record<string, unknown>): NormalizedRow | null {
  const id = pick(r, ["identifier", "id"]);
  const title = pick(r, ["title", "name"]);
  if (!id || !title) return null;
  return {
    externalId: id,
    title,
    body: pickOpt(r, ["description", "body"]),
    url: pickOpt(r, ["url"]),
    status: pickOpt(r, ["state", "status"]),
  };
}

function mapThings(r: Record<string, unknown>): NormalizedRow | null {
  const id = pick(r, ["uuid", "id"]);
  const title = pick(r, ["title", "name"]);
  if (!id || !title) return null;
  return {
    externalId: id,
    title,
    body: pickOpt(r, ["notes", "body"]),
    repo: pickOpt(r, ["project", "area"]),
    status: pickOpt(r, ["status"]),
  };
}

function mapGeneric(r: Record<string, unknown>): NormalizedRow | null {
  const title = pick(r, ["title", "name", "Name", "Title"]);
  if (!title) return null;
  const id =
    pick(r, ["id", "ID", "uuid", "externalId"]) ??
    `hash:${hashString(title + JSON.stringify(r))}`;
  return {
    externalId: id,
    title,
    body: pickOpt(r, ["body", "description", "notes", "Description"]),
    url: pickOpt(r, ["url", "URL", "link"]),
    repo: pickOpt(r, ["repo", "project", "Project"]),
    status: pickOpt(r, ["status", "Status"]),
  };
}

function mapCsv(raw: string, kind: ImportKind): NormalizedRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]!);
  const records: Array<Record<string, unknown>> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]!);
    const row: Record<string, unknown> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = values[j] ?? "";
    }
    records.push(row);
  }
  return records.flatMap((r) => {
    switch (kind) {
      case "linear":
        return mapLinear(r) ?? [];
      case "things":
        return mapThings(r) ?? [];
      default:
        return mapGeneric(r) ?? [];
    }
  });
}

// Minimal CSV parser — handles double-quote quoting + escaped quotes ("").
// Not a full RFC 4180; sufficient for Notion / Linear / spreadsheet exports.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuote = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function pick(r: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function pickOpt(r: Record<string, unknown>, keys: string[]): string | undefined {
  return pick(r, keys) ?? undefined;
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function toTaskInput(row: NormalizedRow, kind: ImportKind, fallbackRepo: string): TaskInput {
  const bodyParts = [row.body, row.url ? `Source: ${row.url}` : null]
    .filter((p): p is string => Boolean(p));
  const body =
    bodyParts.length > 0 ? bodyParts.join("\n\n") : `Imported from ${kind}.`;
  return {
    source_type: "manual",
    source_id: `imported:${kind}:${row.externalId}`,
    repo: row.repo ?? fallbackRepo,
    title: row.title,
    body,
    status: "open",
    assignee: "self",
    priority: 50,
    prompt: null,
    files: [],
    context_hash: null,
    session_id: null,
    due_at: null,
    wait_on: "self",
  };
}
