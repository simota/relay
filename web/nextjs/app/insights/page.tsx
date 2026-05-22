"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { AgeHistogram } from "@/components/insights/age-histogram";
import { BurndownChart } from "@/components/insights/burndown";
import { ContextFreshness } from "@/components/insights/context-freshness";
import { DuplicatesList } from "@/components/insights/duplicates-list";
import { FlowBar } from "@/components/insights/flow-bar";
import { NewlyActiveList } from "@/components/insights/newly-active-list";
import { OrphansTable } from "@/components/insights/orphans-table";
import { ReviewerBlockedList } from "@/components/insights/reviewer-blocked-list";
import { RunsByAgent } from "@/components/insights/runs-by-agent";
import { SourceInflow } from "@/components/insights/source-inflow";
import { StaleCloseButton } from "@/components/insights/stale-close-button";
import { StalledList } from "@/components/insights/stalled-list";
import { StatTile } from "@/components/insights/stat-tile";
import { SyncReliability } from "@/components/insights/sync-reliability";
import { VelocityTable } from "@/components/insights/velocity-table";
import { WaitDonut } from "@/components/insights/wait-donut";
import { Wfr12wLine } from "@/components/insights/wfr-12w-line";
import { Heatmap } from "@/components/heatmap";
import { PageState, stateVariantFromError, useOnlineStatus } from "@/components/page-state";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkline } from "@/components/ui/sparkline";
import { api } from "@/lib/api";
import { c, formatNumber } from "@/lib/copy";
import type { HeatmapData } from "@/lib/api";
import type {
  SourceType,
  StaleResponse,
  ThroughputResponse,
  TouchedResponse,
  WaitAgeResponse,
  WfrResponse,
} from "@/lib/types";

const PERIODS = ["7d", "30d", "90d"] as const;
type Period = (typeof PERIODS)[number];
const ALL_SOURCES: SourceType[] = [
  "code_todo",
  "github_issue",
  "github_pr",
  "claude_session_todo",
  "cursor_session_todo",
  "agents_note",
  "manual",
];

const SWR_OPTS = { refreshInterval: 60_000, revalidateOnFocus: false } as const;

function formatDelta(value: number): { value: string; tone: "positive" | "negative" | "neutral" } {
  if (Math.abs(value) < 0.005) return { value: "±0.00", tone: "neutral" };
  const sign = value > 0 ? "+" : "−";
  return {
    value: `${sign}${Math.abs(value).toFixed(2)}`,
    tone: value > 0 ? "positive" : "negative",
  };
}

export default function InsightsPage() {
  const online = useOnlineStatus();
  const [activeOnly, setActiveOnly] = useState(true);
  const [period, setPeriod] = useState<Period>("30d");
  const [activeSources, setActiveSources] = useState<SourceType[]>(ALL_SOURCES);
  const [wfr12wExpanded, setWfr12wExpanded] = useState(false);
  const sourceParam =
    activeSources.length === ALL_SOURCES.length ? undefined : activeSources.join(",");

  const heatmapKey = `/api/insights/heatmap?period=${period}${sourceParam ? `&source=${sourceParam}` : ""}`;
  const heatmap = useSWR<HeatmapData>(
    heatmapKey,
    () => api.heatmap({ period, source: sourceParam }),
    SWR_OPTS,
  );

  const wfr = useSWR<WfrResponse>("insights.wfr.8w", () => api.insights.wfr("8w"), SWR_OPTS);
  const touched = useSWR<TouchedResponse>(
    "insights.touched.7d",
    () => api.insights.touched("7d"),
    SWR_OPTS,
  );
  const throughput = useSWR<ThroughputResponse>(
    "insights.throughput.7d",
    () => api.insights.throughput("7d"),
    SWR_OPTS,
  );
  const stale = useSWR<StaleResponse>(
    "insights.stale.14",
    () => api.insights.stale(14),
    SWR_OPTS,
  );
  const waitAge = useSWR<WaitAgeResponse>(
    "insights.waitAge",
    () => api.insights.waitAge(),
    SWR_OPTS,
  );

  const heatmapVariant = stateVariantFromError(heatmap.error, online);
  const heatmapEmpty = Boolean(heatmap.data && heatmap.data.repos.length === 0);

  const activeRepos = useMemo(
    () => heatmap.data?.open?.filter((row) => row.some((count) => count > 0)).length ?? 0,
    [heatmap.data?.open],
  );

  const toggleSource = (source: SourceType) => {
    setActiveSources((current) => {
      if (!current.includes(source)) {
        return ALL_SOURCES.filter((item) => item === source || current.includes(item));
      }
      return current.length === 1 ? current : current.filter((item) => item !== source);
    });
  };

  const wfrWeeks = wfr.data?.weeks ?? [];
  const wfrValues = wfrWeeks.map((w) => w.wfr);
  const latestWfr = wfrWeeks[wfrWeeks.length - 1];
  const prevWfr = wfrWeeks[wfrWeeks.length - 2];
  const wfrDelta = latestWfr && prevWfr ? formatDelta(latestWfr.wfr - prevWfr.wfr) : undefined;
  const wfrSparkline =
    wfrValues.length >= 3 ? (
      <Sparkline values={wfrValues} ariaLabel="Weekly flow ratio 8 week trend" />
    ) : (
      <span className="text-[11px] text-[var(--color-fg-dim)]">
        {c("page.insights.w01.empty")}
      </span>
    );

  const wfrValue =
    latestWfr && wfrValues.length >= 1 ? latestWfr.wfr.toFixed(2) : "—";

  const touchedValue = touched.data ? formatNumber(touched.data.active) : "—";
  const touchedHint = touched.data
    ? c("page.insights.w02.hint", { total: touched.data.total })
    : undefined;

  const throughputValue = throughput.data ? throughput.data.ratio.toFixed(2) : "—";
  const throughputHint = throughput.data
    ? c("page.insights.w03.hint", {
        closed: throughput.data.closed,
        opened: throughput.data.opened,
      })
    : undefined;
  const throughputTone: "default" | "accent" | "warm" =
    throughput.data && throughput.data.ratio >= 1
      ? "accent"
      : throughput.data && throughput.data.ratio < 0.8
        ? "warm"
        : "default";

  const staleValue = stale.data ? `${Math.round(stale.data.ratio * 100)}%` : "—";
  const staleHint = stale.data
    ? c("page.insights.w04.hint", { stale: stale.data.stale, total: stale.data.open_total })
    : undefined;
  const staleTone: "default" | "warm" | "critical" =
    stale.data && stale.data.ratio >= 0.5
      ? "critical"
      : stale.data && stale.data.ratio >= 0.25
        ? "warm"
        : "default";

  const waitValue = waitAge.data
    ? `${waitAge.data.median_days.toFixed(1)}${c("page.insights.w05.unit")}`
    : "—";
  const waitHint = waitAge.data
    ? c("page.insights.w05.hint", { n: waitAge.data.sample_n })
    : undefined;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">{c("page.insights.title")}</h1>
          <p className="mt-0.5 text-[12px] text-[var(--color-fg-muted)]">
            {c("page.insights.subtitle", { repos: activeRepos })}
          </p>
        </div>

        {/* Section 1: Pulse Strip — 3 + 2 + 2 + 2 + 3 = 12 */}
        <div className="grid grid-cols-12 gap-4">
          <StatTile
            className="col-span-12 sm:col-span-6 md:col-span-3"
            label={c("page.insights.w01.label")}
            value={wfrValue}
            hint={c("page.insights.w01.hint")}
            delta={wfrDelta}
            sparkline={wfrSparkline}
            isLoading={wfr.isLoading}
            error={wfr.error}
            online={online}
            onRetry={() => wfr.mutate()}
            onToggle={() => setWfr12wExpanded((v) => !v)}
            expanded={wfr12wExpanded}
            expandedLabel={
              wfr12wExpanded ? c("page.insights.w18.collapse") : c("page.insights.w18.expand")
            }
            trailing={<Wfr12wLine enabled={wfr12wExpanded} />}
          />
          <StatTile
            className="col-span-6 sm:col-span-3 md:col-span-2"
            label={c("page.insights.w02.label")}
            value={touchedValue}
            hint={touchedHint}
            isLoading={touched.isLoading}
            error={touched.error}
            online={online}
            onRetry={() => touched.mutate()}
          />
          <StatTile
            className="col-span-6 sm:col-span-3 md:col-span-2"
            label={c("page.insights.w03.label")}
            value={throughputValue}
            hint={throughputHint}
            tone={throughputTone}
            isLoading={throughput.isLoading}
            error={throughput.error}
            online={online}
            onRetry={() => throughput.mutate()}
          />
          <StatTile
            className="col-span-6 sm:col-span-3 md:col-span-2"
            label={c("page.insights.w04.label")}
            value={staleValue}
            hint={staleHint}
            tone={staleTone}
            isLoading={stale.isLoading}
            error={stale.error}
            online={online}
            onRetry={() => stale.mutate()}
            trailing={
              !stale.isLoading && !stale.error ? (
                <div className="mt-1.5 flex justify-end">
                  <StaleCloseButton threshold={14} onClosed={() => stale.mutate()} />
                </div>
              ) : undefined
            }
          />
          <StatTile
            className="col-span-6 sm:col-span-3 md:col-span-3"
            label={c("page.insights.w05.label")}
            value={waitValue}
            hint={waitHint}
            isLoading={waitAge.isLoading}
            error={waitAge.error}
            online={online}
            onRetry={() => waitAge.mutate()}
          />
        </div>

        {/* Section 2: Flow Map (8 col) + Where it's stuck (4 col) */}
        <div className="grid grid-cols-12 gap-4">
          <Card className="col-span-12 md:col-span-8">
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>{c("page.insights.w06.title")}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-0.5">
                  {PERIODS.map((item) => (
                    <Button
                      key={item}
                      type="button"
                      size="sm"
                      variant={period === item ? "primary" : "ghost"}
                      aria-pressed={period === item}
                      onClick={() => setPeriod(item)}
                    >
                      {item}
                    </Button>
                  ))}
                </div>
                <div className="flex rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-0.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={activeOnly ? "primary" : "ghost"}
                    onClick={() => setActiveOnly(true)}
                  >
                    active only
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={activeOnly ? "ghost" : "primary"}
                    onClick={() => setActiveOnly(false)}
                  >
                    all
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              {heatmap.isLoading && (
                <div className="py-12 text-center text-[13px] text-[var(--color-fg-dim)]">
                  {c("common.loading.plain")}
                </div>
              )}
              {heatmapVariant && (
                <PageState
                  variant={heatmapVariant}
                  hint={
                    heatmapVariant === "unauthorized"
                      ? "Insights require reconnecting a source."
                      : c("page.insights.error.hint")
                  }
                  action={() => heatmap.mutate()}
                />
              )}
              {!heatmapVariant && !heatmap.isLoading && heatmapEmpty && (
                <PageState
                  variant="empty"
                  hint="No repositories have insight data for the selected filters."
                />
              )}
              {!heatmapVariant && !heatmapEmpty && heatmap.data && (
                <Heatmap
                  data={heatmap.data}
                  activeOnly={activeOnly}
                  activeSources={activeSources}
                  onToggleSource={toggleSource}
                />
              )}
            </CardBody>
          </Card>
          <div className="col-span-12 md:col-span-4 flex flex-col gap-4">
            <StalledList />
            <NewlyActiveList />
          </div>
        </div>

        {/* Section 3: Throughput (8 col) + Wait Mix (4 col) */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-8">
            <FlowBar days={30} />
          </div>
          <div className="col-span-12 md:col-span-4 flex flex-col gap-4">
            <WaitDonut />
            <ReviewerBlockedList />
          </div>
        </div>

        {/* Section 4: Source & Agent Mix */}
        <div>
          <h2 className="mb-2 text-[12px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
            {c("page.insights.section4Title")}
          </h2>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-6">
              <SourceInflow />
            </div>
            <div className="col-span-12 md:col-span-6">
              <RunsByAgent />
            </div>
          </div>
        </div>

        {/* Section 4b: Sync Reliability */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12">
            <SyncReliability />
          </div>
        </div>

        {/* Section 5: Aging + Context Freshness */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-6">
            <AgeHistogram />
          </div>
          <div className="col-span-12 md:col-span-6">
            <ContextFreshness />
          </div>
        </div>

        {/* Section 6: Orphan Open Tasks */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12">
            <OrphansTable />
          </div>
        </div>

        {/* Section 7: Burndown + Velocity */}
        <div>
          <h2 className="mb-2 text-[12px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
            Pace &amp; Velocity
          </h2>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-8">
              <BurndownChart days={30} />
            </div>
            <div className="col-span-12 md:col-span-4">
              <VelocityTable weeks={4} />
            </div>
          </div>
        </div>

        {/* Section 8: Duplicate Detection */}
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12">
            <DuplicatesList />
          </div>
        </div>
      </div>
    </div>
  );
}
