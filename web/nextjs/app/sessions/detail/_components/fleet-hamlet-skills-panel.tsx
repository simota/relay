"use client";

// Fleet Hamlet — Skills Panel.
//
// Shared compact / full skill list used by:
//   - SimCard (variant="compact", top 3 only)
//   - House Plan Study Room (variant="full", every skill)
//
// Pure presentational — caller passes already-computed skills.

import { useMemo } from "react";
import type { SessionDetail } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { SimCardModel } from "../_lib/fleet-hamlet";
import {
  computeSkills,
  type Skill,
  topSkills,
} from "../_lib/fleet-hamlet-skills";

interface Props {
  card: SimCardModel;
  detail: SessionDetail | undefined;
  variant: "compact" | "full";
  /** How many skills to show in compact mode. Defaults to 3. */
  limit?: number;
}

export function SkillsPanel({ card, detail, variant, limit = 3 }: Props) {
  const all = useMemo(() => computeSkills(card, detail), [card, detail]);
  const list = variant === "compact" ? topSkills(all, limit) : sortFull(all);

  if (list.length === 0) {
    return (
      <div className="text-[10px] font-mono text-[var(--color-fg-dim)]">
        no skills yet — needs a tool call to earn xp
      </div>
    );
  }

  return (
    <ul className={cn("flex flex-col", variant === "compact" ? "gap-0.5" : "gap-1")}>
      {list.map((s) => (
        <SkillRow key={s.id} skill={s} compact={variant === "compact"} />
      ))}
    </ul>
  );
}

function sortFull(skills: readonly Skill[]): Skill[] {
  // Group order: tool first (most expressive of work), then lang, then repo.
  const order: Record<Skill["kind"], number> = { tool: 0, lang: 1, repo: 2 };
  return [...skills].sort((a, b) => {
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind];
    if (b.level !== a.level) return b.level - a.level;
    return b.xp - a.xp;
  });
}

function SkillRow({ skill, compact }: { skill: Skill; compact: boolean }) {
  const segments = 10;
  const filled = skill.level;
  return (
    <li
      className={cn(
        "flex items-center gap-1.5",
        compact ? "text-[9.5px]" : "text-[10px]",
        "font-mono",
      )}
      title={`${skill.label} · Lv ${skill.level} (${skill.levelLabel}) · ${skill.xp} xp`}
    >
      <span
        className={cn(
          "shrink-0 inline-flex items-center justify-center",
          compact ? "w-4 h-4" : "w-5 h-5",
          "text-[9px] text-[var(--color-fg-muted)]",
        )}
        aria-hidden
      >
        {skill.icon}
      </span>
      <span
        className={cn(
          "truncate text-[var(--color-fg)]",
          compact ? "max-w-[72px]" : "max-w-[120px]",
        )}
      >
        {skill.label}
      </span>
      <span className="text-[var(--color-fg-dim)] tabular shrink-0">
        Lv{skill.level}
      </span>
      <span
        className={cn(
          "ml-auto inline-flex shrink-0 tracking-tight",
          "text-[var(--color-fg-muted)]",
        )}
        aria-hidden
      >
        {Array.from({ length: segments }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "inline-block",
              compact ? "w-[3px] h-[7px] mx-[0.5px]" : "w-[4px] h-[9px] mx-[0.5px]",
              "rounded-[1px]",
            )}
            style={{
              background:
                i < filled
                  ? skillBarColor(skill.level)
                  : "var(--color-border)",
              opacity: i < filled ? 1 : 0.45,
            }}
          />
        ))}
      </span>
      {!compact && (
        <span className="ml-1 text-[9px] text-[var(--color-fg-dim)] shrink-0 w-[40px] text-right">
          {skill.xp} xp
        </span>
      )}
    </li>
  );
}

function skillBarColor(level: number): string {
  if (level >= 9) return "hsl(280, 60%, 60%)"; // Master — purple
  if (level >= 7) return "hsl(45, 80%, 55%)"; // Expert — gold
  if (level >= 5) return "hsl(140, 55%, 50%)"; // Adept — green
  if (level >= 3) return "hsl(200, 60%, 55%)"; // Apprentice — blue
  if (level >= 1) return "hsl(220, 25%, 60%)"; // Novice — gray-blue
  return "var(--color-fg-dim)";
}
