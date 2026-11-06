// `relay rules` — inspect and apply `[[rules]]` triage rules (src/lib/rules.ts).
//
//   relay rules                 list rules, problems, and how many open tasks each matches
//   relay rules apply --dry-run preview what applying them to every open task would change
//   relay rules apply           apply (undoable with `relay undo`, one entry per kind)

import chalk from "chalk";
import { loadConfig } from "../config.js";
import { RelayDB } from "../db/client.js";
import {
  applyRules,
  compileRules,
  describeTotals,
  ruleMatches,
  type ApplyRulesResult,
  type CompiledRule,
  type RuleError,
} from "../lib/rules.js";

export interface RuleSummary {
  index: number;
  name: string;
  when: string;
  then: string;
  /** Open (not done) tasks this rule matches right now. */
  matching: number;
}

export interface RulesOverview {
  rules: RuleSummary[];
  errors: RuleError[];
  disabled: number;
}

export function describeConditions(rule: CompiledRule, raw: { repo?: string[]; source?: string[]; title?: string; body?: string }): string {
  const parts: string[] = [];
  if (raw.repo?.length) parts.push(`repo ${raw.repo.join("|")}`);
  if (raw.source?.length) parts.push(`source ${raw.source.join("|")}`);
  if (raw.title) parts.push(`title /${raw.title}/i`);
  if (raw.body) parts.push(`body /${raw.body}/i`);
  return parts.join(" & ") || "(any)";
}

export function describeActions(rule: CompiledRule): string {
  const a = rule.actions;
  const parts: string[] = [];
  if (a.tags.length) parts.push(`tag ${a.tags.join(",")}`);
  if (a.assign) parts.push(`assign ${a.assign}`);
  if (a.priority !== undefined) parts.push(`priority ${a.priority}`);
  if (a.wait_on) parts.push(`wait_on ${a.wait_on}`);
  if (a.queue) parts.push("queue");
  if (rule.stop) parts.push("stop");
  return parts.join(", ");
}

/** Shared by `relay rules` and GET /api/rules. */
export function rulesOverview(db: RelayDB): RulesOverview {
  const cfg = loadConfig();
  const compiled = compileRules(cfg.rules);
  const open = compiled.rules.length > 0 ? db.listNotDoneTasks() : [];
  return {
    rules: compiled.rules.map((rule) => {
      const raw = cfg.rules[rule.index - 1] ?? {};
      return {
        index: rule.index,
        name: rule.name,
        when: describeConditions(rule, raw),
        then: describeActions(rule),
        matching: open.reduce((n, task) => n + (ruleMatches(rule, task) ? 1 : 0), 0),
      };
    }),
    errors: compiled.errors,
    disabled: compiled.disabled,
  };
}

/** Apply every valid rule to every open task. Shared by CLI and API. */
export function applyRulesToOpenTasks(db: RelayDB, dryRun: boolean): ApplyRulesResult & { errors: RuleError[] } {
  const compiled = compileRules(loadConfig().rules);
  const result = applyRules(db, compiled.rules, db.listNotDoneTasks(), { dryRun, recordUndo: true });
  return { ...result, errors: compiled.errors };
}

export function runRulesList(opts: { json?: boolean } = {}): void {
  using db = new RelayDB();
  const overview = rulesOverview(db);
  if (opts.json) {
    console.log(JSON.stringify(overview, null, 2));
    return;
  }
  if (overview.rules.length === 0 && overview.errors.length === 0) {
    console.log(chalk.gray("no triage rules — add [[rules]] to ~/.relay/config.toml, e.g.:"));
    console.log(
      chalk.gray(
        [
          "",
          "  [[rules]]",
          '  name   = "security fixmes → codex"',
          '  source = "code_todo"',
          '  title  = "FIXME|security"',
          '  tag    = ["security"]',
          '  assign = "codex"',
          "  priority = 80",
          "",
        ].join("\n"),
      ),
    );
    return;
  }
  for (const rule of overview.rules) {
    console.log(`${chalk.gray(`#${rule.index}`)} ${chalk.bold(rule.name)}  ${chalk.cyan(`${rule.matching} open`)}`);
    console.log(chalk.gray(`   when ${rule.when}`));
    console.log(chalk.gray(`   then ${rule.then}`));
  }
  for (const err of overview.errors) {
    console.log(chalk.red(`#${err.index} ${err.name}: ${err.message}`) + chalk.gray("  (skipped)"));
  }
  if (overview.disabled > 0) console.log(chalk.gray(`${overview.disabled} rule(s) disabled (enabled = false)`));
  console.log(chalk.gray("\nnew tasks are triaged on every sync · relay rules apply [--dry-run] runs them over open tasks"));
}

export function runRulesApply(opts: { dryRun?: boolean; json?: boolean } = {}): void {
  using db = new RelayDB();
  const result = applyRulesToOpenTasks(db, Boolean(opts.dryRun));
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  for (const err of result.errors) {
    console.log(chalk.yellow(`⚠ skipped #${err.index} ${err.name}: ${err.message}`));
  }
  const verb = opts.dryRun ? "would change" : "changed";
  for (const change of result.changes.slice(0, 50)) {
    const what: string[] = [];
    if (change.tags_added.length) what.push(`+${change.tags_added.join(" +")}`);
    if (change.assign) what.push(`→ ${change.assign.to}`);
    if (change.priority) what.push(`p${change.priority.from}→${change.priority.to}`);
    if (change.wait_on) what.push(`wait ${change.wait_on.to}`);
    if (change.queued) what.push("queued");
    console.log(
      `${chalk.gray(`#${change.id}`)} ${chalk.cyan(change.repo)}  ${change.title.slice(0, 50)}  ${chalk.green(what.join(" "))}` +
        chalk.gray(`  (${change.rules.join(", ")})`),
    );
  }
  if (result.changes.length > 50) console.log(chalk.gray(`… ${result.changes.length - 50} more`));
  console.log(
    (opts.dryRun ? chalk.yellow("dry run: ") : chalk.green("✓ ")) +
      `${result.matched} open task(s) matched, ${verb} ${result.changes.length} — ${describeTotals(result.totals)}` +
      (!opts.dryRun && result.changes.length > 0 ? chalk.gray("  (one `relay undo` / ⌘Z reverts it; queue additions stay)") : ""),
  );
}
