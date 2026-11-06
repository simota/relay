"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { Eye, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import type { RuleTaskChange, RulesApplyResult, RulesOverview } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Triage rules (`[[rules]]` in ~/.relay/config.toml). Every sync applies
 * them to the tasks it newly ingests; this card shows what each rule
 * matches now, previews a run over every open task, and applies it (one
 * ⌘Z reverts the tag / assign / priority changes).
 */
export function TriageRulesCard() {
  const { data, error, mutate } = useSWR<RulesOverview>("/api/rules", () => api.rules());
  const { mutate: globalMutate } = useSWRConfig();
  const [preview, setPreview] = useState<RulesApplyResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "preview" : "apply");
    setFailure(null);
    setMessage(null);
    try {
      const result = await api.applyRules(dryRun);
      if (dryRun) {
        setPreview(result);
      } else {
        setPreview(null);
        setMessage(
          result.changes.length === 0
            ? "nothing to change — open tasks already match the rules"
            : `changed ${result.changes.length} task(s): ${describeTotals(result.totals)} · ⌘Z reverts`,
        );
        await Promise.all([
          mutate(),
          globalMutate(
            (key) =>
              typeof key === "string" &&
              (key.startsWith("/api/tasks") ||
                key.startsWith("/api/today") ||
                key.startsWith("/api/counts") ||
                key.startsWith("/api/tags") ||
                key.startsWith("/api/queue")),
          ),
        ]);
      }
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "could not apply rules");
    } finally {
      setBusy(null);
    }
  };

  const rules = data?.rules ?? [];
  const errors = data?.errors ?? [];
  const empty = data !== undefined && rules.length === 0 && errors.length === 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Triage rules</CardTitle>
          <p className="mt-1 text-[12px] text-[var(--color-fg-muted)]">
            Auto tag / assign / prioritize / queue every task a sync ingests. Edit them as <code className="font-mono">[[rules]]</code> in{" "}
            <code className="font-mono">~/.relay/config.toml</code>.
          </p>
        </div>
        {rules.length > 0 && (
          <div className="flex flex-shrink-0 gap-2">
            <Button size="sm" onClick={() => { void run(true); }} disabled={busy !== null}>
              <Eye className="h-3 w-3" aria-hidden />
              {busy === "preview" ? "Previewing" : "Preview rules"}
            </Button>
            <Button size="sm" variant="primary" onClick={() => { void run(false); }} disabled={busy !== null}>
              <Wand2 className="h-3 w-3" aria-hidden />
              {busy === "apply" ? "Applying" : "Apply rules to open tasks"}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardBody className="space-y-3 text-[12px]">
        {error && <p role="alert" className="text-[var(--color-critical)]">Could not load rules.</p>}
        {empty && (
          <pre className="overflow-x-auto rounded-[var(--radius)] bg-[var(--color-bg)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--color-fg-muted)]">
            {EXAMPLE}
          </pre>
        )}
        {rules.length > 0 && (
          <ul className="divide-y divide-[var(--color-border)] rounded-[var(--radius)] border border-[var(--color-border)]">
            {rules.map((rule) => (
              <li key={rule.index} className="flex items-start justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--color-fg)]">{rule.name}</div>
                  <div className="truncate font-mono text-[11px] text-[var(--color-fg-dim)]" title={rule.when}>when {rule.when}</div>
                  <div className="truncate font-mono text-[11px] text-[var(--color-fg-muted)]" title={rule.then}>then {rule.then}</div>
                </div>
                <span className="flex-shrink-0 font-mono text-[11px] tabular text-[var(--color-cool)]">{rule.matching} open</span>
              </li>
            ))}
          </ul>
        )}
        {errors.map((err) => (
          <p key={err.index} className="text-[11.5px] text-[var(--color-critical)]">
            #{err.index} {err.name}: {err.message} (skipped)
          </p>
        ))}
        {(data?.disabled ?? 0) > 0 && (
          <p className="text-[11px] text-[var(--color-fg-dim)]">{data?.disabled} rule(s) disabled (enabled = false)</p>
        )}
        {failure && <p role="alert" className="text-[var(--color-critical)]">{failure}</p>}
        {message && <p role="status" className="text-[var(--color-fg-muted)]">{message}</p>}
        {preview && (
          <div role="status" className="space-y-1.5">
            <p className="text-[var(--color-fg-muted)]">
              Preview: {preview.matched} open task(s) match, {preview.changes.length} would change — {describeTotals(preview.totals)}
            </p>
            {preview.changes.length > 0 && (
              <ul className="max-h-64 overflow-y-auto rounded-[var(--radius)] border border-[var(--color-border)] font-mono text-[11px]">
                {preview.changes.slice(0, 100).map((change) => (
                  <li key={change.id} className="flex gap-2 border-b border-[var(--color-border)] px-2 py-1 last:border-b-0">
                    <span className="text-[var(--color-fg-dim)]">#{change.id}</span>
                    <span className="text-[var(--color-cool)]">{change.repo}</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--color-fg)]" title={change.title}>{change.title}</span>
                    <span className="flex-shrink-0 text-[var(--color-accent)]">{describeChange(change)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

const EXAMPLE = `# no rules yet — for example:
[[rules]]
name   = "security fixmes → codex"
repo   = ["billing-*"]
source = "code_todo"
title  = "FIXME|security"
tag    = ["security"]
assign = "codex"
priority = 80
queue  = true`;

function describeTotals(totals: RulesApplyResult["totals"]): string {
  const parts: string[] = [];
  if (totals.tagged) parts.push(`${totals.tagged} tagged`);
  if (totals.assigned) parts.push(`${totals.assigned} assigned`);
  if (totals.reprioritized) parts.push(`${totals.reprioritized} re-prioritized`);
  if (totals.wait_on) parts.push(`${totals.wait_on} wait_on set`);
  if (totals.queued) parts.push(`${totals.queued} queued`);
  return parts.join(", ") || "no changes";
}

function describeChange(change: RuleTaskChange): string {
  const parts: string[] = [];
  if (change.tags_added.length) parts.push(change.tags_added.map((t) => `+${t}`).join(" "));
  if (change.assign) parts.push(`→ ${change.assign.to}`);
  if (change.priority) parts.push(`p${change.priority.from}→${change.priority.to}`);
  if (change.wait_on) parts.push(`wait ${change.wait_on.to}`);
  if (change.queued) parts.push("queued");
  return parts.join(" ");
}
