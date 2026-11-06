import { readFileSync } from "node:fs";
import { extname } from "node:path";
import chalk from "chalk";
import { RelayDB, normalizeNoteBody, type SnapshotRow } from "../db/client.js";
import type { TaskInput } from "../types.js";
import type { SnapshotDependency, SnapshotNote } from "./export.js";

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
    // Excel / Notion CSV exports start with a UTF-8 BOM, which would
    // otherwise become part of the first header ("\uFEFFName") or break
    // JSON.parse.
    raw = readFileSync(opts.file, "utf8").replace(/^\uFEFF/, "");
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
    user_overrides: Array.isArray(t.user_overrides)
      ? (t.user_overrides as unknown[]).filter((f): f is string => typeof f === "string")
      : [],
    tags: Array.isArray(t.tags) ? (t.tags as unknown[]).filter((f): f is string => typeof f === "string") : undefined,
    recurrence: !("recurrence" in t) ? undefined : typeof t.recurrence === "string" ? t.recurrence : null,
  }));
  const dependencies = parseSnapshotDependencies((parsed as Record<string, unknown>).dependencies);
  const notes = parseSnapshotNotes((parsed as Record<string, unknown>).notes);

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
  // Dependencies resolve by (source_type, source_id) after the rows exist.
  // Edges are additive and idempotent; ones that would close a cycle with
  // local edges are skipped rather than failing the whole import.
  let depsAdded = 0;
  let depsSkipped = 0;
  for (const dep of dependencies) {
    const task = db.getTaskBySourceId(dep.task.source_type, dep.task.source_id);
    const on = db.getTaskBySourceId(dep.depends_on.source_type, dep.depends_on.source_id);
    if (!task || !on) {
      depsSkipped++;
      continue;
    }
    const added = db.addDependency(task.id, on.id);
    if (added.ok && added.added) depsAdded++;
    else if (!added.ok) depsSkipped++;
  }
  // Notes (schema v14): idempotent per (task, body, created_at), so
  // re-importing the same snapshot never duplicates them.
  let notesAdded = 0;
  for (const note of notes) {
    const task = db.getTaskBySourceId(note.task.source_type, note.task.source_id);
    if (task && db.importNote(task.id, note.body, note.created_at)) notesAdded++;
  }
  db.close();
  const tag = opts.readOnly ? "read-only " : "";
  console.log(
    chalk.green(`✓ imported ${tag}snapshot from ${env.machine_hostname ?? "?"}: `) +
      chalk.gray(
        `${result.inserted} new, ${result.updated} updated (remote newer), ${result.conflicted} kept (local same-or-newer)` +
          (dependencies.length > 0 ? ` · ${depsAdded} dependencies added${depsSkipped ? `, ${depsSkipped} skipped` : ""}` : "") +
          (notes.length > 0 ? ` · ${notesAdded} note(s) added` : ""),
      ),
  );
}

function parseSnapshotNotes(value: unknown): SnapshotNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    const t = r.task as Record<string, unknown> | undefined;
    if (!t || typeof t.source_type !== "string" || typeof t.source_id !== "string") return [];
    if (typeof r.body !== "string" || typeof r.created_at !== "string") return [];
    const body = normalizeNoteBody(r.body);
    if (!body || !Number.isFinite(Date.parse(r.created_at))) return [];
    return [{ task: { source_type: t.source_type, source_id: t.source_id }, body, created_at: r.created_at }];
  });
}

function parseSnapshotDependencies(value: unknown): SnapshotDependency[] {
  if (!Array.isArray(value)) return [];
  const key = (v: unknown): { source_type: string; source_id: string } | null => {
    if (!v || typeof v !== "object") return null;
    const r = v as Record<string, unknown>;
    return typeof r.source_type === "string" && typeof r.source_id === "string"
      ? { source_type: r.source_type, source_id: r.source_id }
      : null;
  };
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    const task = key(r.task);
    const on = key(r.depends_on);
    return task && on ? [{ task, depends_on: on }] : [];
  });
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
  const rows = parseCsv(raw).filter((cells) => cells.some((cell) => cell.length > 0));
  if (rows.length < 2) return [];
  const header = rows[0]!;
  const records: Array<Record<string, unknown>> = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i]!;
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

// Minimal CSV parser — handles double-quote quoting, escaped quotes ("")
// and newlines inside quoted fields (Notion/Things notes regularly contain
// them). Parses the whole document so a quoted multi-line cell never splits
// a record. Not a full RFC 4180; sufficient for spreadsheet exports.
function parseCsv(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inQuote) {
      if (c === '"' && raw[i + 1] === '"') {
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
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      rows.push(row);
      row = [];
    } else {
      cur += c;
    }
  }
  // An unterminated quote means the export was truncated mid-field; keep
  // whatever was collected rather than dropping the trailing record.
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
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
