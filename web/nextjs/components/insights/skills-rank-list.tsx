"use client";

import Link from "next/link";
import useSWR from "swr";

import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { SkillRankEntry, SkillRankResponse } from "@/lib/types";

const WINDOW_DAYS = 30;

export function SkillsRankList() {
  const online = useOnlineStatus();
  const { data, error, isLoading, mutate } = useSWR<SkillRankResponse>(
    `insights.skills.${WINDOW_DAYS}`,
    () => api.insights.skills(WINDOW_DAYS),
    { refreshInterval: 300_000, revalidateOnFocus: false },
  );
  const variant = stateVariantFromError(error, online);
  const entries = data?.entries ?? [];
  const top = entries.slice(0, 12);

  return (
    <Card>
      <CardHeader className="flex items-baseline justify-between gap-2">
        <CardTitle>Skill usage · last {WINDOW_DAYS}d</CardTitle>
        {!isLoading && !variant && data && (
          <span className="text-[11px] tabular font-mono text-[var(--color-fg-dim)]">
            {entries.length} skills · {data.total_sessions} sessions
          </span>
        )}
      </CardHeader>
      <CardBody>
        {isLoading && <RowsSkeleton />}
        {variant && (
          <PageState
            variant={variant}
            hint="Could not load skill ranking."
            action={() => mutate()}
          />
        )}
        {!variant && !isLoading && entries.length === 0 && (
          <p className="text-[12px] text-[var(--color-fg-dim)]">
            No skill invocations detected in the last {WINDOW_DAYS} days.
          </p>
        )}
        {!variant && top.length > 0 && (
          <ul className="flex flex-col">
            {top.map((entry) => (
              <SkillRow key={entry.name} entry={entry} max={top[0]?.sessions_count ?? 1} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function SkillRow({ entry, max }: { entry: SkillRankEntry; max: number }) {
  const pct = max > 0 ? Math.round((entry.sessions_count / max) * 100) : 0;
  const delta = entry.sessions_count - entry.prev_sessions_count;
  const deltaTone =
    delta > 0
      ? "text-[var(--color-cool)]"
      : delta < 0
        ? "text-[var(--color-warm)]"
        : "text-[var(--color-fg-dim)]";
  const deltaSign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return (
    <li className="grid grid-cols-[100px_1fr_auto_auto] items-center gap-3 py-1 text-[12px] font-mono">
      <span className="truncate text-[var(--color-fg)]" title={entry.name}>
        {entry.name}
      </span>
      <div
        className="h-2 rounded-[2px] bg-[var(--color-border)]"
        title={`${entry.sessions_count} sessions in window`}
      >
        <div
          className="h-2 rounded-[2px]"
          style={{
            width: `${pct}%`,
            background: "hsl(280, 60%, 60%)",
          }}
        />
      </div>
      <span className="tabular text-[var(--color-fg-muted)] text-right w-[40px]">
        {entry.sessions_count}
      </span>
      <span className={`tabular text-[11px] w-[40px] text-right ${deltaTone}`} title="vs previous window">
        {deltaSign}
        {Math.abs(delta)}
      </span>
      <span className="col-span-4 -mt-0.5 mb-1 text-[10px] text-[var(--color-fg-dim)]">
        {entry.latest_session ? (
          <Link
            href={`/sessions/detail?s=${entry.latest_session.type}:${encodeURIComponent(entry.latest_session.id)}`}
            className="hover:text-[var(--color-accent)] hover:underline"
            title={entry.latest_session.last_active}
          >
            latest → {entry.latest_session.type}:{entry.latest_session.id.slice(0, 8)}
          </Link>
        ) : (
          <span>no session pointer</span>
        )}
      </span>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-6 rounded-[var(--radius)] bg-[var(--color-bg-elev)] opacity-50" />
      ))}
    </div>
  );
}
