"use client";

// Skills Used panel — surfaces the SKILL.md agents (nexus / guardian /
// vision / …) that this session invoked. Distinct from the Hamlet
// "skills" gamification view (tool-usage RPG levels) — this one is the
// literal Claude/Codex/Antigravity skill invocation feed.

import { useMemo } from "react";
import { Hash, Sparkles, Terminal, Workflow } from "lucide-react";
import type {
  SessionSkillChainEdge,
  SessionSkillSource,
  SessionSkillUse,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { shortTime } from "../_lib/format";

const SOURCE_LABEL: Record<SessionSkillSource, string> = {
  slash_command: "slash",
  skill_tool: "tool",
  subagent: "spawn",
  session_meta: "session",
};

const SOURCE_DESC: Record<SessionSkillSource, string> = {
  slash_command: "user typed /<name>",
  skill_tool: "assistant called Skill(skill=…)",
  subagent: "spawned via Agent / spawn_agent",
  session_meta: "session_meta.source.subagent",
};

const SOURCE_ICON: Record<SessionSkillSource, typeof Hash> = {
  slash_command: Hash,
  skill_tool: Sparkles,
  subagent: Workflow,
  session_meta: Terminal,
};

const SOURCE_COLOR: Record<SessionSkillSource, string> = {
  slash_command: "var(--color-accent)",
  skill_tool: "hsl(280, 60%, 60%)",
  subagent: "hsl(200, 60%, 55%)",
  session_meta: "hsl(140, 55%, 50%)",
};

export function SkillsUsedPanel({
  skills,
  skillChains,
  compact,
}: {
  skills: SessionSkillUse[];
  skillChains: SessionSkillChainEdge[];
  compact: boolean;
}) {
  // Roll up by skill name first, then list per-source rows underneath.
  // Surfaces "nexus was invoked 16 times across slash + spawn" without
  // forcing the reader to mentally fold three rows of the same name.
  const grouped = useMemo(() => groupByName(skills), [skills]);
  const chainsByParent = useMemo(() => groupChainsByParent(skillChains), [skillChains]);

  if (grouped.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)] py-6 text-center">
        no skill invocations
      </p>
    );
  }

  return (
    <div className="pt-3 space-y-3">
      <ul className={cn("space-y-2", compact && "space-y-1.5")}>
        {grouped.map((g) => (
          <SkillGroupRow key={g.name} group={g} compact={compact} />
        ))}
      </ul>
      {chainsByParent.length > 0 && (
        <ChainsBlock chains={chainsByParent} compact={compact} />
      )}
    </div>
  );
}

interface ChainGroup {
  parent: string;
  children: Array<{ name: string; count: number }>;
}

function groupChainsByParent(edges: SessionSkillChainEdge[]): ChainGroup[] {
  const map = new Map<string, Map<string, number>>();
  for (const e of edges) {
    const inner = map.get(e.parent) ?? new Map<string, number>();
    inner.set(e.child, (inner.get(e.child) ?? 0) + 1);
    map.set(e.parent, inner);
  }
  const out: ChainGroup[] = [];
  for (const [parent, counts] of map) {
    const children = [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    out.push({ parent, children });
  }
  return out.sort((a, b) => {
    // Sort by total fan-out size descending — the most-orchestrated
    // parent floats to the top.
    const at = a.children.reduce((s, c) => s + c.count, 0);
    const bt = b.children.reduce((s, c) => s + c.count, 0);
    return bt - at || a.parent.localeCompare(b.parent);
  });
}

function ChainsBlock({ chains, compact }: { chains: ChainGroup[]; compact: boolean }) {
  return (
    <section
      className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2"
      aria-label="skill chains"
    >
      <div className={cn("font-mono text-[var(--color-fg-muted)] uppercase tracking-wider", compact ? "text-[9.5px]" : "text-[10px]")}>
        ↳ Chains
      </div>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {chains.map((c) => (
          <li key={c.parent} className={cn("font-mono leading-snug", compact ? "text-[11px]" : "text-[11.5px]")}>
            <span className="text-[var(--color-accent)]">{c.parent}</span>
            <span className="text-[var(--color-fg-dim)] mx-1">→</span>
            <span className="text-[var(--color-fg)]">
              {c.children.map((child, i) => (
                <span key={child.name}>
                  {i > 0 && <span className="text-[var(--color-fg-dim)]">, </span>}
                  <span style={{ color: "hsl(280, 50%, 60%)" }}>{child.name}</span>
                  {child.count > 1 && (
                    <span className="text-[var(--color-fg-dim)] text-[10px]">×{child.count}</span>
                  )}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface GroupedSkill {
  name: string;
  totalCount: number;
  firstTs: string;
  lastTs: string;
  sources: SessionSkillUse[];
}

function groupByName(skills: SessionSkillUse[]): GroupedSkill[] {
  const map = new Map<string, GroupedSkill>();
  for (const s of skills) {
    const existing = map.get(s.name);
    if (existing) {
      existing.totalCount += s.count;
      if (s.first_ts && (!existing.firstTs || s.first_ts < existing.firstTs)) {
        existing.firstTs = s.first_ts;
      }
      if (s.last_ts && s.last_ts > existing.lastTs) existing.lastTs = s.last_ts;
      existing.sources.push(s);
    } else {
      map.set(s.name, {
        name: s.name,
        totalCount: s.count,
        firstTs: s.first_ts,
        lastTs: s.last_ts,
        sources: [s],
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
    return a.name.localeCompare(b.name);
  });
}

function SkillGroupRow({ group, compact }: { group: GroupedSkill; compact: boolean }) {
  // Latest recipe wins across sources — Skill tool calls supply recipes
  // most often (`Skill(skill="nexus", args="apex")`), so prefer that.
  const recipe =
    group.sources.find((s) => s.recipe)?.recipe ?? null;
  // First-use surfaces when ANY source for this name carries the flag;
  // markFirstUse picks the chronologically-earliest source so this is
  // single-source per name.
  const isFirstUse = group.sources.some((s) => s.is_first_use_in_session);
  // Failure status: any source observed a `failed` recent invocation.
  const hasFailure = group.sources.some((s) => s.last_status === "failed");
  return (
    <li className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 font-mono">
      <div className={cn("flex items-baseline gap-2", compact ? "text-[12px]" : "text-[13px]")}>
        <span className="text-[var(--color-accent)] font-medium">{group.name}</span>
        {recipe && (
          <span
            className="text-[10.5px] font-mono px-1 py-[1px] rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-fg-muted)]"
            title={`recipe: ${recipe}`}
          >
            {recipe}
          </span>
        )}
        {isFirstUse && (
          <span
            className="text-[9px] font-mono px-1 py-[1px] rounded-full"
            style={{
              background: "linear-gradient(180deg, hsl(45,100%,72%), hsl(38,90%,58%))",
              color: "hsl(45, 90%, 22%)",
              letterSpacing: 0.5,
            }}
            title="first time this session"
          >
            ✦ NEW
          </span>
        )}
        {hasFailure && (
          <span
            className="text-[9px] font-mono px-1 py-[1px] rounded-full"
            style={{
              background: "color-mix(in srgb, var(--color-critical) 14%, transparent)",
              color: "var(--color-critical)",
              border: "1px solid color-mix(in srgb, var(--color-critical) 30%, transparent)",
            }}
            title="most recent invocation returned an error"
          >
            ✕ failed
          </span>
        )}
        <span className="text-[var(--color-fg-dim)] tabular text-[11px]">
          ×{group.totalCount}
        </span>
        <span className="flex-1" />
        {group.lastTs && (
          <span
            className="text-[var(--color-fg-dim)] tabular text-[10.5px]"
            title={`first: ${group.firstTs}\nlast: ${group.lastTs}`}
          >
            {shortTime(group.lastTs)}
          </span>
        )}
      </div>
      <ul className="mt-1 grid gap-y-0.5 grid-cols-[auto_auto_1fr_auto]">
        {group.sources.map((s) => (
          <SourceRow key={s.source} use={s} compact={compact} />
        ))}
      </ul>
    </li>
  );
}

function SourceRow({ use, compact }: { use: SessionSkillUse; compact: boolean }) {
  const Icon = SOURCE_ICON[use.source];
  const txt = compact ? "text-[10.5px]" : "text-[11px]";
  return (
    <>
      <span
        className={cn("flex items-center gap-1 pr-2", txt)}
        style={{ color: SOURCE_COLOR[use.source] }}
        title={SOURCE_DESC[use.source]}
      >
        <Icon className="w-3 h-3" aria-hidden />
        <span>{SOURCE_LABEL[use.source]}</span>
      </span>
      <span className={cn("tabular text-[var(--color-fg-dim)] pr-3", txt)}>
        ×{use.count}
      </span>
      <span className={cn("truncate text-[var(--color-fg-muted)]", txt)} title={use.last_args ?? ""}>
        {use.last_args ?? ""}
      </span>
      <span className={cn("tabular text-[var(--color-fg-dim)] pl-2", txt)}>
        {use.last_ts ? shortTime(use.last_ts) : ""}
      </span>
    </>
  );
}
