// Validation for user task edits, shared by `PATCH /api/tasks/:id` and
// `relay edit` so both surfaces accept exactly the same input.

import { EDITABLE_FIELDS, WaitOn, type EditableField, type Task, type TaskEdit } from "../types.js";
import { parseWhenInput, WHEN_INPUT_HINT } from "./due-date.js";
import { normalizeRecurrence, RECURRENCE_HINT } from "./recurrence.js";

export type ParsedTaskEdit =
  | { ok: true; patch: TaskEdit; reset: EditableField[] }
  | { ok: false; error: string };

const MAX_TITLE = 500;
const MAX_FILES = 200;

function isEditableField(value: unknown): value is EditableField {
  return typeof value === "string" && (EDITABLE_FIELDS as readonly string[]).includes(value);
}

/** Split "a, b,,c" or ["a"," b"] into a trimmed, de-duplicated list. */
export function normalizeFiles(value: unknown): string[] | null {
  const raw = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : null;
  if (!raw) return null;
  if (raw.some((f) => typeof f !== "string")) return null;
  return [...new Set((raw as string[]).map((f) => f.trim()).filter(Boolean))];
}

/**
 * Validate an edit request against the task it targets. Unknown keys are
 * rejected (rather than ignored) so a typo such as `{"priorty": 90}` or an
 * attempt to set `status` here fails loudly instead of silently no-oping.
 */
export function parseTaskEdit(
  input: unknown,
  task: Pick<Task, "source_type">,
  now: Date = new Date(),
): ParsedTaskEdit {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const body = input as Record<string, unknown>;
  const patch: TaskEdit = {};

  for (const key of Object.keys(body)) {
    if (key === "reset") continue;
    if (key === "status" || key === "assignee") {
      return {
        ok: false,
        error: `${key} has its own endpoint (POST /api/tasks/:id/${key === "status" ? "close|snooze|reopen" : "assignee"})`,
      };
    }
    if (!isEditableField(key)) {
      return { ok: false, error: `unknown field: ${key} (editable: ${EDITABLE_FIELDS.join(", ")})` };
    }
  }

  if ("title" in body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return { ok: false, error: "title must be a non-empty string" };
    if (title.length > MAX_TITLE) return { ok: false, error: `title must be at most ${MAX_TITLE} characters` };
    patch.title = title;
  }
  if ("body" in body) {
    if (typeof body.body !== "string") return { ok: false, error: "body must be a string" };
    patch.body = body.body.trim();
  }
  if ("priority" in body) {
    const n = typeof body.priority === "number" ? body.priority : Number(body.priority);
    if (body.priority === null || body.priority === "" || !Number.isFinite(n)) {
      return { ok: false, error: "priority must be a number 0-100" };
    }
    patch.priority = Math.min(100, Math.max(0, Math.round(n)));
  }
  if ("prompt" in body) {
    if (body.prompt !== null && typeof body.prompt !== "string") {
      return { ok: false, error: "prompt must be a string or null" };
    }
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    patch.prompt = prompt ? prompt : null;
  }
  if ("files" in body) {
    const files = body.files === null ? [] : normalizeFiles(body.files);
    if (!files) return { ok: false, error: "files must be an array of strings or a comma-separated string" };
    if (files.length > MAX_FILES) return { ok: false, error: `at most ${MAX_FILES} files` };
    patch.files = files;
  }
  if ("due_at" in body) {
    if (body.due_at === null || body.due_at === "") {
      patch.due_at = null;
    } else {
      const due = typeof body.due_at === "string" ? parseWhenInput(body.due_at, now) : null;
      if (!due) return { ok: false, error: `due_at must be ${WHEN_INPUT_HINT}, or null to clear` };
      patch.due_at = due;
    }
  }
  if ("wait_on" in body) {
    const parsed = WaitOn.safeParse(body.wait_on);
    if (!parsed.success) return { ok: false, error: `wait_on must be one of: ${WaitOn.options.join(", ")}` };
    patch.wait_on = parsed.data;
  }
  if ("repo" in body) {
    if (task.source_type !== "manual") {
      return { ok: false, error: "repo can only be changed on manual tasks (adapter tasks follow their source)" };
    }
    const repo = typeof body.repo === "string" ? body.repo.trim() : "";
    if (!repo) return { ok: false, error: "repo must be a non-empty string" };
    patch.repo = repo;
  }

  if ("recurrence" in body) {
    const rule = normalizeRecurrence(body.recurrence);
    if (rule === undefined) return { ok: false, error: `recurrence must be ${RECURRENCE_HINT}, or null to stop repeating` };
    patch.recurrence = rule;
  }

  let reset: EditableField[] = [];
  if ("reset" in body) {
    const raw = typeof body.reset === "string" ? body.reset.split(",").map((s) => s.trim()) : body.reset;
    if (!Array.isArray(raw) || !raw.every(isEditableField)) {
      return { ok: false, error: `reset must list editable fields (${EDITABLE_FIELDS.join(", ")})` };
    }
    reset = [...new Set(raw)];
    const both = reset.filter((f) => f in patch);
    if (both.length) return { ok: false, error: `cannot both set and reset: ${both.join(", ")}` };
  }

  if (Object.keys(patch).length === 0 && reset.length === 0) {
    return { ok: false, error: "nothing to change" };
  }
  return { ok: true, patch, reset };
}
