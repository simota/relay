"use client";

import { Clipboard, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ResumeBriefResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ResumeBriefProps {
  data: ResumeBriefResponse | undefined;
  onSelectTask: (id: number) => void;
}

export function ResumeBrief({ data, onSelectTask }: ResumeBriefProps) {
  if (!data) return null;
  if (!data.flag_enabled) return <ResumeBriefFlagOff />;
  if (!data.candidate) return null;

  const candidate = data.candidate;
  const task = candidate.task;

  const copyRunCommand = async () => {
    try {
      await navigator.clipboard.writeText(candidate.run_command);
    } catch {
      // Browser permission denied; the command remains visible below.
    }
  };

  return (
    <section
      aria-label="Daily Resume Brief"
      className={cn(
        "mx-6 mb-3 rounded-[var(--radius)] border border-[var(--color-accent)]/35",
        "bg-[var(--color-accent)]/[0.045] px-4 py-3",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <RotateCcw className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            <h2 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-accent)]">
              Daily Resume Brief
            </h2>
            <Badge source={task.source_type}>{task.source_type.replace(/_/g, " ")}</Badge>
            <span className="text-[10.5px] font-mono text-[var(--color-fg-dim)]">
              confidence {candidate.confidence} · score {candidate.score}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onSelectTask(task.id)}
            className="mt-2 block min-w-0 text-left ring-focus rounded-[var(--radius-sm)]"
          >
            <span className="font-mono text-[13px] text-[var(--color-cool)]">
              #{task.id} {task.repo}
            </span>
            <span className="ml-2 text-[13px] font-medium text-[var(--color-fg)]">
              {task.title}
            </span>
          </button>
          <p className="mt-1 text-[12px] text-[var(--color-fg-muted)] leading-snug">
            {candidate.next_action}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="default"
            onClick={copyRunCommand}
            title="Copy run command"
          >
            <Clipboard className="w-3.5 h-3.5" />
            Copy
          </Button>
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => onSelectTask(task.id)}
            title="Focus recommended task"
          >
            <Play className="w-3.5 h-3.5" />
            Focus
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {candidate.reasons.slice(0, 3).map((reason) => (
          <div
            key={`${reason.label}-${reason.detail}`}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-elev)]/45 px-2.5 py-2"
          >
            <div className="text-[10.5px] font-mono uppercase tracking-wider text-[var(--color-fg-dim)]">
              {reason.label}
            </div>
            <div className="mt-0.5 text-[11.5px] text-[var(--color-fg-muted)] leading-snug">
              {reason.detail}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] font-mono text-[var(--color-fg-dim)]">
        <span>{candidate.run_command}</span>
        {candidate.context && <span>context {candidate.context.hash.slice(0, 10)} · {candidate.context.age}</span>}
        {candidate.reliability.resume_ready && <span>resume ready</span>}
        {candidate.reliability.dirty_state_known && <span>dirty state known</span>}
      </div>
    </section>
  );
}

function ResumeBriefFlagOff() {
  return (
    <section
      aria-label="Daily Resume Brief opt-in"
      className="mx-6 mb-3 rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <RotateCcw className="w-3.5 h-3.5 text-[var(--color-fg-dim)]" />
        <h2 className="text-[12px] font-semibold tracking-tight">
          Daily Resume Brief is behind a feature flag
        </h2>
      </div>
      <p className="mt-1 text-[11.5px] text-[var(--color-fg-muted)] leading-snug">
        Add <code className="font-mono text-[10.5px]">[features]</code> and{" "}
        <code className="font-mono text-[10.5px]">daily_resume_brief = true</code> to{" "}
        <code className="font-mono text-[10.5px]">~/.relay/config.toml</code> to show the recommended first resume task.
      </p>
    </section>
  );
}
