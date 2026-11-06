// Triage rules: config-driven auto-triage for freshly ingested tasks.
//
// With 40+ repos a single sync can bring in dozens of TODOs, CI failures
// and review requests, and every one of them used to need the same manual
// tag / assign / priority / queue steps. `[[rules]]` in config.toml encode
// those steps once:
//
//   [[rules]]
//   name   = "security fixmes → codex"
//   repo   = ["billing-*", "auth"]      # glob(s) on the repo name
//   source = "code_todo"                # source type(s)
//   title  = "FIXME|security"           # case-insensitive regex
//   tag    = ["security"]
//   assign = "codex"
//   priority = 80
//   queue  = true
//
// runSync applies them to every task it newly inserted; `relay rules apply`
// (and POST /api/rules/apply) re-runs them over all open tasks. Priority /
// wait_on are written as user edits (locked against re-sync, like `relay
// edit`), assignee and tags are user-owned already, so a rule's decision
// survives every later sync.

import type { Config } from "../config.js";
import type { RelayDB } from "../db/client.js";
import { Assignee, SourceType, WaitOn, type Task } from "../types.js";
import { normalizeTags } from "./tags.js";

export type RuleConfig = Config["rules"][number];

export interface CompiledRule {
  /** 1-based position in config.toml — stable id for messages. */
  index: number;
  name: string;
  repo: RegExp[] | null;
  source: Set<string> | null;
  title: RegExp | null;
  body: RegExp | null;
  actions: RuleActions;
  stop: boolean;
}

export interface RuleActions {
  tags: string[];
  assign?: Assignee;
  priority?: number;
  wait_on?: WaitOn;
  queue: boolean;
}

export interface RuleError {
  index: number;
  name: string;
  message: string;
}

export interface CompiledRules {
  rules: CompiledRule[];
  errors: RuleError[];
  /** Rules switched off with `enabled = false`. */
  disabled: number;
}

/** Shell-style glob (`*`, `?`) → anchored, case-insensitive RegExp. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function ruleName(rule: RuleConfig, index: number): string {
  return rule.name?.trim() || `rule ${index}`;
}

/**
 * Validate `[[rules]]` entries. A rule with any problem is reported and
 * skipped as a whole — applying half a rule would be more surprising than
 * not applying it.
 */
export function compileRules(raw: readonly RuleConfig[]): CompiledRules {
  const rules: CompiledRule[] = [];
  const errors: RuleError[] = [];
  let disabled = 0;
  raw.forEach((rule, i) => {
    const index = i + 1;
    const name = ruleName(rule, index);
    if (!rule.enabled) {
      disabled++;
      return;
    }
    const problems: string[] = [];
    const regex = (field: string, pattern: string | undefined): RegExp | null => {
      if (pattern === undefined || pattern === "") return null;
      try {
        return new RegExp(pattern, "i");
      } catch (e) {
        problems.push(`${field}: invalid regex (${(e as Error).message})`);
        return null;
      }
    };
    const title = regex("title", rule.title);
    const body = regex("body", rule.body);

    let source: Set<string> | null = null;
    if (rule.source && rule.source.length > 0) {
      const unknown = rule.source.filter((s) => !SourceType.safeParse(s).success);
      if (unknown.length > 0) problems.push(`source: unknown source type(s) ${unknown.join(", ")}`);
      source = new Set(rule.source);
    }
    const repo = rule.repo && rule.repo.length > 0 ? rule.repo.map(globToRegExp) : null;

    const actions: RuleActions = { tags: [], queue: rule.queue };
    if (rule.tag && rule.tag.length > 0) {
      const { tags, invalid } = normalizeTags(rule.tag);
      if (invalid.length > 0) problems.push(`tag: invalid tag(s) ${invalid.join(", ")}`);
      actions.tags = tags;
    }
    if (rule.assign !== undefined) {
      const parsed = Assignee.safeParse(rule.assign);
      if (parsed.success) actions.assign = parsed.data;
      else problems.push(`assign: must be one of ${Assignee.options.join(" | ")}`);
    }
    if (rule.priority !== undefined) actions.priority = rule.priority;
    if (rule.wait_on !== undefined) {
      const parsed = WaitOn.safeParse(rule.wait_on);
      if (parsed.success) actions.wait_on = parsed.data;
      else problems.push(`wait_on: must be one of ${WaitOn.options.join(" | ")}`);
    }

    const hasMatch = Boolean(repo || source || title || body);
    const hasAction =
      actions.tags.length > 0 ||
      actions.assign !== undefined ||
      actions.priority !== undefined ||
      actions.wait_on !== undefined ||
      actions.queue;
    // A rule with no match fields would hit every task — almost always a
    // typo (e.g. `titel =`). Require at least one condition.
    if (!hasMatch) problems.push("needs at least one of repo / source / title / body");
    if (!hasAction) problems.push("needs at least one action (tag / assign / priority / wait_on / queue)");

    if (problems.length > 0) {
      errors.push({ index, name, message: problems.join("; ") });
      return;
    }
    rules.push({ index, name, repo, source, title, body, actions, stop: rule.stop });
  });
  return { rules, errors, disabled };
}

type MatchableTask = Pick<Task, "repo" | "source_type" | "title" | "body">;

export function ruleMatches(rule: CompiledRule, task: MatchableTask): boolean {
  if (rule.source && !rule.source.has(task.source_type)) return false;
  if (rule.repo && !rule.repo.some((re) => re.test(task.repo))) return false;
  if (rule.title && !rule.title.test(task.title)) return false;
  if (rule.body && !rule.body.test(task.body ?? "")) return false;
  return true;
}

/** The merged effect of every rule that matches `task`, in config order. */
export function resolveActions(
  rules: readonly CompiledRule[],
  task: MatchableTask,
): { matched: CompiledRule[]; actions: RuleActions } {
  const matched: CompiledRule[] = [];
  const actions: RuleActions = { tags: [], queue: false };
  for (const rule of rules) {
    if (!ruleMatches(rule, task)) continue;
    matched.push(rule);
    for (const tag of rule.actions.tags) if (!actions.tags.includes(tag)) actions.tags.push(tag);
    if (rule.actions.assign !== undefined) actions.assign = rule.actions.assign;
    if (rule.actions.priority !== undefined) actions.priority = rule.actions.priority;
    if (rule.actions.wait_on !== undefined) actions.wait_on = rule.actions.wait_on;
    if (rule.actions.queue) actions.queue = true;
    if (rule.stop) break;
  }
  return { matched, actions };
}

/** What applying the rules did (or, in a dry run, would do) to one task. */
export interface RuleTaskChange {
  id: number;
  repo: string;
  title: string;
  rules: string[];
  tags_added: string[];
  assign?: { from: string; to: string };
  priority?: { from: number; to: number };
  wait_on?: { from: string; to: string };
  queued: boolean;
}

export interface ApplyRulesResult {
  /** Tasks at least one rule matched. */
  matched: number;
  /** Tasks whose state actually changed (or would change). */
  changes: RuleTaskChange[];
  totals: { tagged: number; assigned: number; reprioritized: number; wait_on: number; queued: number };
}

export interface ApplyRulesOptions {
  dryRun?: boolean;
  /**
   * Write one `rules_apply` undo_log entry so the whole application is
   * reversible with a single ⌘Z / `relay undo` (queue additions excepted —
   * the queue has no undo). Off for the
   * automatic post-sync pass — ingest itself is not undoable either.
   */
  recordUndo?: boolean;
}

/**
 * Apply compiled rules to `tasks`. Done tasks are skipped. Changes that are
 * already in place (tag present, same assignee, ...) are no-ops, so running
 * this twice is idempotent.
 */
export function applyRules(
  db: RelayDB,
  rules: readonly CompiledRule[],
  tasks: readonly Task[],
  opts: ApplyRulesOptions = {},
): ApplyRulesResult {
  const result: ApplyRulesResult = {
    matched: 0,
    changes: [],
    totals: { tagged: 0, assigned: 0, reprioritized: 0, wait_on: 0, queued: 0 },
  };
  if (rules.length === 0) return result;
  // addQueueItem returns the existing row for an already-queued task, so
  // "newly queued" has to be decided against the queue as it was.
  const queued = new Set(db.listQueueItems().map((q) => q.task_id));

  const tagUndo: { before: Array<{ id: number; tags: string[] }>; after: Array<{ id: number; tags: string[] }> } = {
    before: [],
    after: [],
  };
  const assignUndo: { before: Array<{ id: number; assignee: string }>; after: Array<{ id: number; assignee: string }> } = {
    before: [],
    after: [],
  };
  const editUndo: { before: unknown[]; after: unknown[] } = { before: [], after: [] };

  for (const task of tasks) {
    if (task.status === "done") continue;
    const { matched, actions } = resolveActions(rules, task);
    if (matched.length === 0) continue;
    result.matched++;

    const change: RuleTaskChange = {
      id: task.id,
      repo: task.repo,
      title: task.title,
      rules: matched.map((r) => r.name),
      tags_added: [],
      queued: false,
    };

    const currentTags = task.tags ?? [];
    const newTags = actions.tags.filter((t) => !currentTags.includes(t));
    if (newTags.length > 0) {
      change.tags_added = newTags;
      if (!opts.dryRun) {
        const tagChange = db.setTags(task.id, [...currentTags, ...newTags]);
        if (tagChange) {
          tagUndo.before.push({ id: task.id, tags: tagChange.before });
          tagUndo.after.push({ id: task.id, tags: tagChange.after });
        }
      }
    }

    if (actions.assign !== undefined && actions.assign !== task.assignee) {
      change.assign = { from: task.assignee, to: actions.assign };
      if (!opts.dryRun) {
        db.setAssignee(task.id, actions.assign);
        assignUndo.before.push({ id: task.id, assignee: task.assignee });
        assignUndo.after.push({ id: task.id, assignee: actions.assign });
      }
    }

    const patch: { priority?: number; wait_on?: WaitOn } = {};
    if (actions.priority !== undefined && actions.priority !== task.priority) {
      change.priority = { from: task.priority, to: actions.priority };
      patch.priority = actions.priority;
    }
    if (actions.wait_on !== undefined && actions.wait_on !== task.wait_on) {
      change.wait_on = { from: task.wait_on, to: actions.wait_on };
      patch.wait_on = actions.wait_on;
    }
    if (!opts.dryRun && Object.keys(patch).length > 0) {
      const edited = db.editTask(task.id, patch);
      if (edited && (edited.changed.length > 0 || edited.overridesChanged)) {
        editUndo.before.push(edited.before);
        editUndo.after.push(edited.after);
      }
    }

    if (actions.queue && !queued.has(task.id)) {
      if (opts.dryRun || db.addQueueItem(task.id) !== null) {
        change.queued = true;
        queued.add(task.id);
      }
    }

    const changed =
      change.tags_added.length > 0 || change.assign || change.priority || change.wait_on || change.queued;
    if (!changed) continue;
    result.changes.push(change);
    if (change.tags_added.length > 0) result.totals.tagged++;
    if (change.assign) result.totals.assigned++;
    if (change.priority) result.totals.reprioritized++;
    if (change.wait_on) result.totals.wait_on++;
    if (change.queued) result.totals.queued++;
  }

  if (!opts.dryRun && opts.recordUndo) {
    const any = tagUndo.after.length + assignUndo.after.length + editUndo.after.length > 0;
    // One entry for the whole application, so a single ⌘Z / `relay undo`
    // reverts everything the rules did (api/undo.ts "rules_apply").
    if (any) {
      db.recordUndo({
        op_kind: "rules_apply",
        payload: { tags: tagUndo.after, reassign: assignUndo.after, edit: editUndo.after },
        inverse: { tags: tagUndo.before, reassign: assignUndo.before, edit: editUndo.before },
      });
    }
  }
  return result;
}

/** One-line summary, e.g. "4 tagged, 2 assigned, 1 queued". */
export function describeTotals(totals: ApplyRulesResult["totals"]): string {
  const parts: string[] = [];
  if (totals.tagged) parts.push(`${totals.tagged} tagged`);
  if (totals.assigned) parts.push(`${totals.assigned} assigned`);
  if (totals.reprioritized) parts.push(`${totals.reprioritized} re-prioritized`);
  if (totals.wait_on) parts.push(`${totals.wait_on} wait_on set`);
  if (totals.queued) parts.push(`${totals.queued} queued`);
  return parts.join(", ") || "no changes";
}
