"use client";

// Fleet Hamlet — Relationships Panel.
//
// Shared compact / full list used by SimCard and the House Plan Reception
// Room. Pure presentational — caller passes the resident, peer cards, and
// the current tick.

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import {
  computeRelationships,
  type Relationship,
  relationshipKindLabel,
} from "../_lib/fleet-hamlet-relations";

interface Props {
  card: SimCardModel;
  allCards: readonly SimCardModel[];
  now: number;
  variant: "compact" | "full";
  limit?: number;
  /** When provided, the row becomes a button that jumps to the peer's House. */
  onEnterHouse?: (target: SimCardModel) => void;
}

export function RelationshipsPanel({
  card,
  allCards,
  now,
  variant,
  limit = 3,
  onEnterHouse,
}: Props) {
  const rels = useMemo(
    () => computeRelationships(card, allCards, now),
    [card, allCards, now],
  );
  const list = variant === "compact" ? rels.slice(0, limit) : rels;

  if (list.length === 0) {
    return (
      <div className="text-[10px] font-mono text-[var(--color-fg-dim)]">
        no relationships yet — needs a peer or spawn edge
      </div>
    );
  }

  return (
    <ul className={cn("flex flex-col", variant === "compact" ? "gap-0.5" : "gap-1")}>
      {list.map((r) => (
        <RelationshipRow
          key={r.target.key}
          rel={r}
          compact={variant === "compact"}
          onEnterHouse={onEnterHouse}
        />
      ))}
    </ul>
  );
}

function RelationshipRow({
  rel,
  compact,
  onEnterHouse,
}: {
  rel: Relationship;
  compact: boolean;
  onEnterHouse?: (target: SimCardModel) => void;
}) {
  const target = rel.target;
  const kindLabel = relationshipKindLabel(rel.kind);
  const targetLabel = `${target.sessionType[0]}/${target.repo ?? "—"}${
    target.agentId ? ` · ${target.agentId.slice(0, 6)}` : ""
  }`;
  const tooltip = `${rel.label} (${kindLabel}) · ${target.sessionType}@${target.sessionId.slice(0, 10)} · score ${rel.score}`;

  const inner = (
    <>
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: scoreColor(rel.score) }}
      />
      <span
        className={cn(
          "truncate text-[var(--color-fg)]",
          compact ? "max-w-[110px]" : "max-w-[180px]",
        )}
      >
        {targetLabel}
      </span>
      <span className="text-[var(--color-fg-dim)] shrink-0 text-[9px]">
        {kindLabel}
      </span>
      <span
        className={cn(
          "ml-auto shrink-0",
          compact ? "text-[9px]" : "text-[10px]",
          "text-[var(--color-fg-muted)]",
        )}
        style={{ color: scoreColor(rel.score) }}
      >
        {rel.label}
      </span>
      {!compact && (
        <span className="ml-1 text-[9px] text-[var(--color-fg-dim)] tabular shrink-0 w-[28px] text-right">
          {rel.score}
        </span>
      )}
    </>
  );

  if (onEnterHouse) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onEnterHouse(target)}
          title={tooltip}
          className={cn(
            "w-full flex items-center gap-1.5 text-left font-mono",
            compact ? "text-[9.5px]" : "text-[10px]",
            "hover:text-[var(--color-accent)] focus:text-[var(--color-accent)]",
          )}
        >
          {inner}
        </button>
      </li>
    );
  }
  return (
    <li
      className={cn(
        "flex items-center gap-1.5 font-mono",
        compact ? "text-[9.5px]" : "text-[10px]",
      )}
      title={tooltip}
    >
      {inner}
    </li>
  );
}

function scoreColor(score: number): string {
  if (score >= 85) return "hsl(0, 70%, 60%)"; // family heart-red
  if (score >= 65) return "hsl(45, 80%, 55%)"; // best friend gold
  if (score >= 45) return "hsl(140, 55%, 50%)"; // friend green
  if (score >= 25) return "hsl(220, 25%, 60%)"; // acquaintance blue-gray
  return "var(--color-fg-dim)";
}
