"use client";

// Promise Ledger panel — audits assistant claims ("I've added X", "Fixed
// Y.ts") against the tool_calls the model actually made in the same turn.
// The honesty score at the top is the single most-read number; everything
// below it is per-claim evidence so the reader can verify the verdict.
//
// #TODO(agent): surface the honesty score on Hamlet residents as a tiny
// hand-held scroll whose color reflects the score (green ≥80, amber 50–79,
// red <50, omitted when null). Plea persona requested this as a Hamlet
// flourish; deferred from V1 to keep the killer-feature flag rollout tight.

import { useMemo } from "react";
import { Check, CircleDashed, FileEdit, FileMinus, FilePlus, FlaskConical, GitCommit, HelpCircle, Minus, Play, X } from "lucide-react";
import type {
  PromiseClaimType,
  PromiseEntry,
  PromiseStatus,
  SessionPromiseLedger,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortTime } from "../_lib/format";

const STATUS_LABEL: Record<PromiseStatus, string> = {
  verified: "verified",
  partial: "partial",
  unmet: "unmet",
  unverifiable: "vague",
};

const STATUS_GLYPH: Record<PromiseStatus, typeof Check> = {
  verified: Check,
  partial: CircleDashed,
  unmet: X,
  unverifiable: Minus,
};

// Inline color tokens so the badge stands out from the rest of the panel
// without depending on a project-wide critical/success palette.
const STATUS_STYLE: Record<PromiseStatus, { bg: string; fg: string; border: string }> = {
  verified: {
    bg: "color-mix(in srgb, hsl(140, 60%, 45%) 16%, transparent)",
    fg: "hsl(140, 60%, 38%)",
    border: "color-mix(in srgb, hsl(140, 60%, 45%) 36%, transparent)",
  },
  partial: {
    bg: "color-mix(in srgb, hsl(38, 90%, 55%) 16%, transparent)",
    fg: "hsl(38, 90%, 40%)",
    border: "color-mix(in srgb, hsl(38, 90%, 55%) 36%, transparent)",
  },
  unmet: {
    bg: "color-mix(in srgb, var(--color-critical) 14%, transparent)",
    fg: "var(--color-critical)",
    border: "color-mix(in srgb, var(--color-critical) 30%, transparent)",
  },
  unverifiable: {
    bg: "color-mix(in srgb, var(--color-fg-dim) 10%, transparent)",
    fg: "var(--color-fg-dim)",
    border: "var(--color-border)",
  },
};

const TYPE_LABEL: Record<PromiseClaimType, string> = {
  write_file: "write",
  edit_file: "edit",
  delete_file: "delete",
  add_test: "test+",
  run_test: "test▶",
  commit: "commit",
  generic: "claim",
};

const TYPE_GLYPH: Record<PromiseClaimType, typeof FilePlus> = {
  write_file: FilePlus,
  edit_file: FileEdit,
  delete_file: FileMinus,
  add_test: FlaskConical,
  run_test: Play,
  commit: GitCommit,
  generic: HelpCircle,
};

export function PromiseLedgerPanel({
  ledger,
  compact,
}: {
  ledger: SessionPromiseLedger;
  compact: boolean;
}) {
  // Default sort: unmet first (the user wants to see what was claimed but
  // not done before scrolling through the verified ones), then unverifiable,
  // then verified. Within each bucket, chronological.
  const sorted = useMemo(() => sortEntries(ledger.entries), [ledger.entries]);

  if (ledger.total_claims === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)] py-6 text-center">
        no audited claims in this session
      </p>
    );
  }

  return (
    <div className="pt-3 space-y-3">
      <ScoreHeader ledger={ledger} compact={compact} />
      <ul className={cn("space-y-1.5", compact && "space-y-1")}>
        {sorted.map((entry, i) => (
          <ClaimRow key={`${entry.message_index}-${i}`} entry={entry} compact={compact} />
        ))}
      </ul>
      <Caveat compact={compact} />
    </div>
  );
}

function sortEntries(entries: readonly PromiseEntry[]): PromiseEntry[] {
  const order: Record<PromiseStatus, number> = {
    unmet: 0,
    partial: 1,
    unverifiable: 2,
    verified: 3,
  };
  return [...entries].sort((a, b) => {
    const ao = order[a.status] - order[b.status];
    if (ao !== 0) return ao;
    return a.timestamp.localeCompare(b.timestamp);
  });
}

function ScoreHeader({
  ledger,
  compact,
}: {
  ledger: SessionPromiseLedger;
  compact: boolean;
}) {
  const score = ledger.honesty_score;
  // Score color mirrors STATUS_STYLE so the eye correlates "high score" ↔
  // "lots of verified ✓" without needing a legend.
  const scoreColor =
    score === null
      ? "var(--color-fg-dim)"
      : score >= 80
      ? "hsl(140, 60%, 38%)"
      : score >= 50
      ? "hsl(38, 90%, 40%)"
      : "var(--color-critical)";
  return (
    <section
      className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2"
      aria-label="promise ledger score"
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-center justify-center min-w-[56px]">
          <div
            className={cn("font-mono font-semibold tabular leading-none", compact ? "text-[20px]" : "text-[24px]")}
            style={{ color: scoreColor }}
            title={score === null ? "no scorable claims" : `${score}% honesty`}
          >
            {score === null ? "—" : `${score}`}
          </div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)] mt-0.5">
            honesty
          </div>
        </div>
        <div className="flex-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono">
          <Stat label="verified" count={ledger.verified} status="verified" />
          {ledger.partial > 0 && (
            <Stat label="partial" count={ledger.partial} status="partial" />
          )}
          <Stat label="unmet" count={ledger.unmet} status="unmet" />
          <Stat label="vague" count={ledger.unverifiable} status="unverifiable" />
          <span className="text-[var(--color-fg-dim)]">
            · total {ledger.total_claims}
          </span>
        </div>
      </div>
    </section>
  );
}

function Stat({
  label,
  count,
  status,
}: {
  label: string;
  count: number;
  status: PromiseStatus;
}) {
  const style = STATUS_STYLE[status];
  return (
    <span className="inline-flex items-baseline gap-1" style={{ color: style.fg }}>
      <span className="tabular">{count}</span>
      <span className="text-[9.5px] uppercase tracking-wider opacity-80">{label}</span>
    </span>
  );
}

function ClaimRow({ entry, compact }: { entry: PromiseEntry; compact: boolean }) {
  const style = STATUS_STYLE[entry.status];
  const StatusIcon = STATUS_GLYPH[entry.status];
  const TypeIcon = TYPE_GLYPH[entry.claim_type];
  return (
    <li
      className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2"
      style={{ borderLeft: `3px solid ${style.fg}` }}
    >
      <div className={cn("flex items-baseline gap-2 flex-wrap", compact ? "text-[11.5px]" : "text-[12px]")}>
        <span
          className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full font-mono text-[9.5px] uppercase tracking-wider"
          style={{ background: style.bg, color: style.fg, border: `1px solid ${style.border}` }}
          title={statusTooltip(entry.status)}
        >
          <StatusIcon className="w-3 h-3" aria-hidden />
          {STATUS_LABEL[entry.status]}
        </span>
        <span
          className="inline-flex items-center gap-1 text-[9.5px] font-mono uppercase tracking-wider text-[var(--color-fg-muted)]"
          title={`claim type: ${entry.claim_type}`}
        >
          <TypeIcon className="w-3 h-3" aria-hidden />
          {TYPE_LABEL[entry.claim_type]}
        </span>
        <span className="font-mono text-[var(--color-fg)] flex-1 min-w-0 break-words">
          {entry.claim_text}
        </span>
        {entry.timestamp && (
          <span className="font-mono tabular text-[10.5px] text-[var(--color-fg-dim)]">
            {shortTime(entry.timestamp)}
          </span>
        )}
      </div>
      {(entry.evidence || entry.reason) && (
        <div className={cn("mt-1 ml-1 font-mono text-[var(--color-fg-dim)]", compact ? "text-[10.5px]" : "text-[11px]")}>
          {entry.evidence ? (
            <span>
              <span className="text-[var(--color-fg-muted)]">↳ evidence:</span>{" "}
              {entry.evidence}
            </span>
          ) : (
            <span>
              <span className="text-[var(--color-fg-muted)]">↳ why:</span> {entry.reason}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function statusTooltip(status: PromiseStatus): string {
  switch (status) {
    case "verified":
      return "tool_call matched the claim in the same turn";
    case "partial":
      return "claim is multi-part; only some pieces have evidence";
    case "unmet":
      return "claim has a specific target but no matching tool_call was observed";
    case "unverifiable":
      return "claim is too vague to audit (no specific file / test / commit named)";
  }
}

function Caveat({ compact }: { compact: boolean }) {
  return (
    <p className={cn("font-mono text-[var(--color-fg-dim)] px-1", compact ? "text-[9.5px]" : "text-[10px]")}>
      heuristic audit · regex claim detection paired with same-turn tool_call evidence · false
      &quot;unmet&quot; possible when the agent edits via piped stdin or `cat &gt;`.
    </p>
  );
}
