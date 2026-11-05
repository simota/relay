"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/badge";
import { c, formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type { StandupReport, StandupTaskCue, Task } from "@/lib/types";

type StandupWindow = "24h" | "7d";

interface StandupPanelProps {
  onSelectTask?: (id: number) => void;
}

/** SWR key for the standup report; shared with the Today page's load gate. */
export function standupKey(window: StandupWindow): string {
  return `/api/standup?since=${window}`;
}

export function StandupPanel({ onSelectTask }: StandupPanelProps) {
  const [window, setWindow] = useState<StandupWindow>("24h");
  const { data } = useSWR<StandupReport>(
    standupKey(window),
    () => api.standup(window),
    // keepPreviousData: switching 24h <-> 7d changes the key; without it
    // `data` is undefined mid-fetch and the whole panel unmounts and
    // re-mounts, shifting everything below it.
    { refreshInterval: 5 * 60_000, keepPreviousData: true },
  );

  // SWR is loading or fetch errored — render nothing rather than flashing
  // an empty bar above Today (this panel is auxiliary, not critical).
  if (!data) return null;

  const totalItems = data.yesterday.length + data.today.length + data.blockers.length;
  // Spec: hide the panel when all three sections are empty so morning view
  // stays clean if there is genuinely nothing to report.
  if (totalItems === 0) return null;

  return (
    <Card className="overflow-hidden">
      <details open className="group relative">
        <summary className="flex cursor-pointer list-none items-center gap-3 border-b border-[var(--color-border)] pl-5 pr-28 h-10 hover:bg-[var(--color-bg-elev)]/60 ring-focus">
          <ChevronRight
            className="w-3 h-3 text-[var(--color-fg-dim)] transition-transform group-open:rotate-90 shrink-0"
            aria-hidden
          />
          <span className="text-[10.5px] uppercase tracking-wider font-medium text-[var(--color-fg-dim)]">
            {c("standup.title")}
          </span>
          <span className="text-[10.5px] tabular text-[var(--color-fg-dim)]">
            {formatNumber(totalItems)}
          </span>
        </summary>
        {/* Kept outside <summary>: interactive content inside a summary
            is invalid (axe nested-interactive) and toggled the panel. */}
        <div className="absolute right-5 top-0 h-10 flex items-center">
          <WindowToggle current={window} onChange={setWindow} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--color-border)]">
          <Section
            heading={c("standup.yesterday")}
            hint={c("standup.yesterday.hint")}
            empty={c("standup.yesterday.empty")}
            kind="yesterday"
            tasks={data.yesterday}
            cues={data.cues}
            onSelectTask={onSelectTask}
          />
          <Section
            heading={c("standup.today")}
            hint={c("standup.today.hint")}
            empty={c("standup.today.empty")}
            kind="today"
            tasks={data.today}
            cues={data.cues}
            onSelectTask={onSelectTask}
          />
          <Section
            heading={c("standup.blockers")}
            hint={c("standup.blockers.hint")}
            empty={c("standup.blockers.empty")}
            kind="blockers"
            tasks={data.blockers}
            cues={data.cues}
            onSelectTask={onSelectTask}
          />
        </div>
      </details>
    </Card>
  );
}

function WindowToggle({
  current,
  onChange,
}: {
  current: StandupWindow;
  onChange: (next: StandupWindow) => void;
}) {
  return (
    <div
      role="group"
      aria-label="standup window"
      className="flex items-center rounded border border-[var(--color-border)] overflow-hidden"
    >
      {(["24h", "7d"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={current === value}
          onClick={() => onChange(value)}
          className={cn(
            "px-2 py-0.5 text-[10.5px] tabular transition-colors ring-focus",
            current === value
              ? "bg-[var(--color-bg-elev)] text-[var(--color-fg)]"
              : "text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]",
          )}
        >
          {c(value === "24h" ? "standup.switchTo24h" : "standup.switchTo7d")}
        </button>
      ))}
    </div>
  );
}

function Section({
  heading,
  hint,
  empty,
  kind,
  tasks,
  cues,
  onSelectTask,
}: {
  heading: string;
  hint: string;
  empty: string;
  kind: "yesterday" | "today" | "blockers";
  tasks: Task[];
  cues: Record<number, StandupTaskCue>;
  onSelectTask?: (id: number) => void;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-center gap-2 px-5 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-bg)]/40">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--color-fg)]">
          {heading}
        </span>
        <span className="text-[10.5px] tabular text-[var(--color-fg-dim)]">
          {formatNumber(tasks.length)}
        </span>
        <span className="ml-auto text-[10.5px] text-[var(--color-fg-dim)]">{hint}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="px-5 py-4 text-[12px] text-[var(--color-fg-dim)]">{empty}</div>
      ) : (
        <ul className="divide-y divide-[var(--color-border)]/60">
          {tasks.slice(0, 8).map((task) => (
            <StandupRow
              key={task.id}
              task={task}
              cue={cues[task.id]}
              kind={kind}
              onSelect={onSelectTask}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function StandupRow({
  task,
  cue,
  kind,
  onSelect,
}: {
  task: Task;
  cue?: StandupTaskCue;
  kind: "yesterday" | "today" | "blockers";
  onSelect?: (id: number) => void;
}) {
  const runSummary = cue?.run?.output_summary?.trim() ?? "";
  const ctxSummary = cue?.context_summary?.trim() ?? "";
  // Yesterday rows lead with the agent's output summary if we have one —
  // it's the concrete "what got shipped" cue. Other sections lean on the
  // saved context summary.
  const primaryCue =
    kind === "yesterday" && runSummary ? runSummary : ctxSummary || runSummary;
  const showAgentBadge = kind === "yesterday" && cue?.run?.agent;

  return (
    // Stretched-button row: the title <button> covers the whole row via
    // ::after, and the repo <Link> sits above it (relative z-10). This keeps
    // the one-click row target without nesting a link inside a button.
    <li className="relative flex flex-col gap-0.5 px-5 py-2 transition-colors hover:bg-[var(--color-bg-elev)]/60 has-[button:focus-visible]:bg-[var(--color-bg-elev)]/80">
      <span className="flex items-center gap-2 text-[12px]">
        <StatusDot status={task.status} className="shrink-0" />
        <span className="tabular text-[10.5px] text-[var(--color-fg-dim)] w-9 shrink-0">
          #{task.id}
        </span>
        <Link
          href={`/tasks?status=open&repo=${encodeURIComponent(task.repo)}`}
          className="relative z-10 font-mono text-[11px] text-[var(--color-cool)] truncate max-w-[140px] shrink-0 hover:underline ring-focus"
        >
          {task.repo}
        </Link>
        <span className="font-mono text-[10.5px] text-[var(--color-fg-dim)] truncate max-w-[100px] shrink-0">
          {task.assignee}
        </span>
        <button
          type="button"
          onClick={() => onSelect?.(task.id)}
          className={cn(
            "flex-1 truncate text-left text-[var(--color-fg)] min-w-0",
            "after:absolute after:inset-0 after:content-['']",
            "focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[var(--color-ring)]",
          )}
        >
          {task.title}
        </button>
      </span>
      {(primaryCue || showAgentBadge) && (
        <span className="pl-[78px] text-[10.5px] text-[var(--color-fg-dim)] truncate">
          {showAgentBadge && cue?.run ? (
            <span className="mr-1.5 text-[var(--color-fg-muted)]">
              {c("standup.via", { agent: cue.run.agent })}
            </span>
          ) : null}
          {primaryCue}
        </span>
      )}
    </li>
  );
}
