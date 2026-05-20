"use client";

import {
  Activity,
  Bot,
  FileText,
  ListChecks,
  MessageSquare,
  Network,
  Wrench,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type SessionDetail,
  type SessionSummary,
  type SessionType,
} from "@/lib/api";
import { formatNumber } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { MAX_TILES } from "../_constants";
import { useSubagents } from "../_hooks/use-subagents";
import { formatDuration, truncatePath } from "../_lib/format";
import { computeStats } from "../_lib/stats";
import type { RoleFilter, StreamStatus, TileSpec } from "../_types";
import { extractFileTouches } from "../_lib/file-touch";
import { SessionTitle } from "@/components/session-title";
import { RelativeTime, TypeBadge } from "./badges";
import { BashCommandPanel } from "./bash-command-panel";
import { CadenceHeatmap } from "./cadence-heatmap";
import { FilesTouchList } from "./files-touch-list";
import { MessageLengthStrip } from "./message-length-strip";
import { MessagesList } from "./messages-list";
import { SequenceLane } from "./sequence-lane";
import { SessionTasksPanel } from "./session-tasks-panel";
import { StreamStatusBadge, WaitingForUserBadge } from "./session-tile";
import { StatusRibbon } from "./status-ribbon";
import { SubagentDag } from "./subagent-dag";
import { SubagentFlockView } from "./subagent-flock-view";
import { SubagentTree } from "./subagent-tree";
import { TabButton } from "./tab-button";
import { TodosList } from "./todos-list";
import { ToolCallsList } from "./tool-calls-list";
import { ToolPie } from "./tool-pie";
import { ToolTransitionMatrix } from "./tool-transition-matrix";

// ---------------------------------------------------------------------------
// SessionTileView — the main content view for one session tile
// (previously SessionDetailView; adapted for tile context)
// ---------------------------------------------------------------------------
export function SessionTileView({
  data,
  streamStatus,
  freshMessageKeys,
  onClose,
  tileIndex,
  onReplaceTile,
  onAddSubagents,
  currentTileCount,
  forceCompact,
}: {
  data: SessionDetail;
  streamStatus: StreamStatus;
  freshMessageKeys?: ReadonlySet<string>;
  onClose?: () => void;
  tileIndex: number;
  onReplaceTile: (index: number, spec: TileSpec) => void;
  onAddSubagents: (agentIds: string[], type: SessionType) => void;
  currentTileCount: number;
  forceCompact: boolean;
}) {
  const [tab, setTab] = useState<
    | "messages"
    | "todos"
    | "tools"
    | "agents"
    | "files"
    | "dag"
    | "lane"
    | "flock"
  >("messages");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [search, setSearch] = useState("");
  // When the timeline jumps to a message, we set this so the next render
  // (after switching to the messages tab) can locate the row and scroll
  // it into view. Cleared once the scroll has been attempted.
  const [pendingJumpKey, setPendingJumpKey] = useState<string | null>(null);

  // Compact layout is resolved in SessionsBoard from a tri-state preference
  // (explicit user toggle wins; otherwise auto-on at the 4-tile / 3×2-grid
  // threshold). By this point it's a flat boolean.
  const compact = forceCompact;

  const stats = useMemo(() => computeStats(data.messages), [data.messages]);
  const duration = useMemo(
    () => formatDuration(data.started_at, data.last_active),
    [data.started_at, data.last_active],
  );

  const isSubagent = !!data.parent_session_id;
  const hasSubagents = (data.subagent_count ?? 0) > 0;
  const [addingSubagents, setAddingSubagents] = useState(false);

  // Fetch the subagent list only for parent tiles that actually have
  // children. The hook itself short-circuits when hasSubagents is false,
  // but gating from the call site makes the intent explicit and avoids
  // running the effect dance for every leaf session.
  const subagents = useSubagents(
    data.type,
    data.id,
    !isSubagent && hasSubagents,
    data.last_active,
  );

  const handleOpenChild = useCallback(
    (child: SessionSummary) => {
      onReplaceTile(tileIndex, { type: data.type, id: child.id });
    },
    [data.type, onReplaceTile, tileIndex],
  );

  const fileTouchCount = useMemo(
    () => extractFileTouches(data.tool_calls).length,
    [data.tool_calls],
  );
  const laneEligible = data.messages.length + data.tool_calls.length >= 2;
  const dagEligible = !isSubagent && hasSubagents;

  // Drop the user back to `messages` if the active tab disappears (e.g. they
  // open a subagent tile while parked on the agents tab of the parent, or
  // file-touch entries get filtered out by an upstream snapshot).
  useEffect(() => {
    if (tab === "agents" && !dagEligible) {
      setTab("messages");
    }
    if (tab === "files" && fileTouchCount === 0) {
      setTab("messages");
    }
    if (tab === "dag" && !dagEligible) {
      setTab("messages");
    }
    if (tab === "lane" && !laneEligible) {
      setTab("messages");
    }
  }, [tab, dagEligible, fileTouchCount, laneEligible]);

  const handleAddAllSubagents = useCallback(async () => {
    if (addingSubagents) return;
    setAddingSubagents(true);
    try {
      const subagents: SessionSummary[] = await api.sessions({
        type: data.type,
        parent: data.id,
        includeSubagents: true,
      });
      const agentIds = subagents
        .filter((s) => s.agent_id)
        .map((s) => s.id);
      onAddSubagents(agentIds, data.type);
    } catch (e) {
      console.warn("[relay] failed to fetch subagents:", e);
    } finally {
      setAddingSubagents(false);
    }
  }, [addingSubagents, data.id, data.type, onAddSubagents]);

  const handleGoToParent = useCallback(() => {
    if (!data.parent_session_id) return;
    onReplaceTile(tileIndex, { type: data.type, id: data.parent_session_id });
  }, [data.parent_session_id, data.type, tileIndex, onReplaceTile]);

  const handleJumpToMessage = useCallback((key: string) => {
    setTab("messages");
    setPendingJumpKey(key);
  }, []);

  const handleJumpToToolByQuery = useCallback((q: string) => {
    setTab("tools");
    setSearch(q);
  }, []);

  // After a lane jump, locate the message row by its data-message-key
  // attribute and scroll it into view. We retry once on the next animation
  // frame in case the messages list hasn't mounted yet.
  useEffect(() => {
    if (!pendingJumpKey || tab !== "messages") return;
    const key = pendingJumpKey;
    const attempt = () => {
      const el = document.querySelector(
        `[data-message-key="${CSS.escape(key)}"]`,
      );
      if (el && "scrollIntoView" in el) {
        (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
        setPendingJumpKey(null);
        return true;
      }
      return false;
    };
    if (!attempt()) {
      const handle = requestAnimationFrame(() => {
        attempt();
        setPendingJumpKey(null);
      });
      return () => cancelAnimationFrame(handle);
    }
  }, [pendingJumpKey, tab]);

  // Clicking a ToolPie slice routes the user to the tools tab and prefills
  // the filter input. Re-clicking the same slice clears the filter (toggle);
  // clicking a different slice overwrites the previous one. The "other"
  // bucket is synthetic — it would match nothing literally — so we treat
  // it as a pure toggle that just clears the filter when active.
  const toolPieSelection = useMemo(() => {
    if (tab !== "tools") return null;
    const q = search.trim();
    if (!q) return null;
    return q;
  }, [tab, search]);

  const handleToolPieSelect = useCallback(
    (name: string) => {
      setTab("tools");
      const current = search.trim();
      if (current.toLowerCase() === name.toLowerCase()) {
        setSearch("");
        return;
      }
      if (name === "other") {
        setSearch("");
        return;
      }
      setSearch(name);
    },
    [search],
  );

  const filteredMessages = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = data.messages.filter((m) => {
      if (roleFilter !== "all" && m.role !== roleFilter) return false;
      if (q && !m.text.toLowerCase().includes(q)) return false;
      return true;
    });
    return matched.slice().reverse();
  }, [data.messages, roleFilter, search]);

  const filteredTools = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = !q
      ? data.tool_calls
      : data.tool_calls.filter(
          (tc) =>
            tc.name.toLowerCase().includes(q) ||
            tc.args_summary.toLowerCase().includes(q) ||
            (tc.args_json?.toLowerCase().includes(q) ?? false),
        );
    return matched.slice().reverse();
  }, [data.tool_calls, search]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Tile header */}
      <div className={cn("flex-shrink-0 space-y-1.5", compact ? "px-3 pt-2 pb-1" : "px-4 pt-3 pb-2")}>
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={data.type} />
          {data.repo ? (
            <Link
              href="/repos"
              className={cn(
                "font-mono text-[var(--color-fg)] hover:text-[var(--color-accent)] hover:underline",
                compact ? "text-[12px]" : "text-[13px]",
              )}
            >
              {data.repo}
            </Link>
          ) : (
            <span
              className={cn("font-mono text-[var(--color-fg-dim)]", compact ? "text-[12px]" : "text-[13px]")}
            >
              —
            </span>
          )}
          <span className="text-[var(--color-fg-dim)]">·</span>
          <RelativeTime iso={data.last_active} />
          {!compact && (
            <>
              <span className="text-[var(--color-fg-dim)]">·</span>
              <StreamStatusBadge status={streamStatus} />
            </>
          )}
          {/* Waiting badge is non-null only when the SSE-delivered detail
              classifies this session as needing user action. Placed before
              the spacer so it sits next to the stream/type chips and
              dominates the user's attention. */}
          <WaitingForUserBadge status={data.status} compact={compact} />
          <div className="flex-1" />
          {compact && <StreamStatusBadge status={streamStatus} />}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close tile"
              className="text-[11px] font-mono text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] px-1.5 py-0.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] hover:border-[var(--color-fg-muted)] transition-colors"
            >
              ✕
            </button>
          )}
        </div>
        <h2
          className={cn(
            "font-semibold tracking-tight leading-snug",
            compact ? "text-[13px] line-clamp-1" : "text-[15px]",
          )}
          title={compact ? data.title : undefined}
        >
          <SessionTitle raw={data.title} />
        </h2>
        {isSubagent && data.parent_session_id && (
          <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-[var(--color-fg-dim)]">
            <span>↑ Parent:</span>
            <span className="font-mono">{data.parent_session_id.slice(0, 8)}…</span>
            <button
              type="button"
              onClick={handleGoToParent}
              className="text-[var(--color-accent)] hover:underline"
            >
              (open)
            </button>
          </div>
        )}
        {!isSubagent && hasSubagents && (
          <div className="flex items-center gap-2 text-[10.5px] font-mono text-[var(--color-fg-dim)]">
            <span>Subagents: {data.subagent_count}</span>
            {currentTileCount < MAX_TILES && (
              <button
                type="button"
                onClick={() => void handleAddAllSubagents()}
                disabled={addingSubagents}
                className="text-[var(--color-accent)] hover:underline disabled:opacity-50 disabled:cursor-wait"
              >
                {addingSubagents ? "loading…" : "+ Add all subagents"}
              </button>
            )}
          </div>
        )}
        {!compact && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[10.5px] text-[var(--color-fg-dim)] font-mono">
            <span title={data.cwd ?? ""}>cwd: {truncatePath(data.cwd ?? "—", 50)}</span>
            <span>session: {data.id.slice(0, 8)}</span>
            {stats.user > 0 && <span>user: {formatNumber(stats.user)}</span>}
            {stats.assistant > 0 && <span>assistant: {formatNumber(stats.assistant)}</span>}
            {stats.tool > 0 && <span>tool: {formatNumber(stats.tool)}</span>}
            <span>duration: {duration}</span>
            {stats.tool > 0 && (
              <span className="ml-auto inline-flex items-center">
                <ToolPie
                  toolCalls={data.tool_calls}
                  compact={false}
                  onSelect={handleToolPieSelect}
                  selected={toolPieSelection}
                />
              </span>
            )}
          </div>
        )}
        {compact && (
          <div className="flex items-center gap-3 text-[10.5px] text-[var(--color-fg-dim)] font-mono">
            <span title={data.cwd ?? ""} className="truncate max-w-[40%]">
              {truncatePath(data.cwd ?? "—", 32)}
            </span>
            {stats.user + stats.assistant > 0 && (
              <span>
                {formatNumber(stats.user)}u/{formatNumber(stats.assistant)}a
                {stats.tool > 0 ? `/${formatNumber(stats.tool)}t` : ""}
              </span>
            )}
            <span>{duration}</span>
            {stats.tool > 0 && (
              <span className="ml-auto inline-flex items-center">
                <ToolPie
                  toolCalls={data.tool_calls}
                  compact
                  onSelect={handleToolPieSelect}
                  selected={toolPieSelection}
                />
              </span>
            )}
          </div>
        )}
        {!compact && data.messages.length > 1 && (
          <CadenceHeatmap data={data} compact={compact} />
        )}
        {!compact && (data.messages.length > 1 || data.tool_calls.length > 0) && (
          <StatusRibbon data={data} compact={compact} />
        )}
      </div>

      {/* F-4: tasks ingested from this session. Fetched once on mount —
          the SSE stream updates `data` repeatedly, but the task↔session
          mapping changes only after a `relay sync`, so re-fetching on every
          message append would be wasted DB work. */}
      <SessionTasksPanel type={data.type} sessionId={data.id} compact={compact} />

      {/* Sticky tab bar — sticky within the tile's scroll container */}
      <div
        className={cn(
          "flex-shrink-0 sticky top-0 z-10 bg-[var(--color-bg)] border-b border-[var(--color-border)] space-y-1.5",
          compact ? "px-3 pt-0.5 pb-1.5" : "px-4 pt-1 pb-2",
        )}
      >
        <div className="flex gap-2 items-start">
          <div className="flex gap-1 items-center flex-wrap min-w-0 flex-1">
            <TabButton
              active={tab === "messages"}
              onClick={() => setTab("messages")}
              compact={compact}
              title={`messages · ${formatNumber(filteredMessages.length)}`}
            >
              <MessageSquare className="w-3.5 h-3.5" aria-hidden />
              <span className="tabular">{formatNumber(filteredMessages.length)}</span>
            </TabButton>
            {data.todos.length > 0 && (
              <TabButton
                active={tab === "todos"}
                onClick={() => setTab("todos")}
                compact={compact}
                title={`todos · ${formatNumber(data.todos.length)}`}
              >
                <ListChecks className="w-3.5 h-3.5" aria-hidden />
                <span className="tabular">{formatNumber(data.todos.length)}</span>
              </TabButton>
            )}
            <TabButton
              active={tab === "tools"}
              onClick={() => setTab("tools")}
              compact={compact}
              title={`tools · ${formatNumber(filteredTools.length)}`}
            >
              <Wrench className="w-3.5 h-3.5" aria-hidden />
              <span className="tabular">{formatNumber(filteredTools.length)}</span>
            </TabButton>
            {fileTouchCount > 0 && (
              <TabButton
                active={tab === "files"}
                onClick={() => setTab("files")}
                compact={compact}
                title={`files · ${formatNumber(fileTouchCount)}`}
              >
                <FileText className="w-3.5 h-3.5" aria-hidden />
                <span className="tabular">{formatNumber(fileTouchCount)}</span>
              </TabButton>
            )}
            {laneEligible && (
              <TabButton
                active={tab === "lane"}
                onClick={() => setTab("lane")}
                compact={compact}
                title={`lane · ${formatNumber(data.messages.length + data.tool_calls.length)}`}
              >
                <Activity className="w-3.5 h-3.5" aria-hidden />
                <span className="tabular">{formatNumber(data.messages.length + data.tool_calls.length)}</span>
              </TabButton>
            )}
            {dagEligible && (
              <TabButton
                active={tab === "agents"}
                onClick={() => setTab("agents")}
                compact={compact}
                title={`agents · ${formatNumber(data.subagent_count ?? 0)}`}
              >
                <Bot className="w-3.5 h-3.5" aria-hidden />
                <span className="tabular">{formatNumber(data.subagent_count ?? 0)}</span>
              </TabButton>
            )}
            {dagEligible && (
              <TabButton
                active={tab === "dag"}
                onClick={() => setTab("dag")}
                compact={compact}
                title={`dag · ${formatNumber(data.subagent_count ?? 0)}`}
              >
                <Network className="w-3.5 h-3.5" aria-hidden />
                <span className="tabular">{formatNumber(data.subagent_count ?? 0)}</span>
              </TabButton>
            )}
            <TabButton
              active={tab === "flock"}
              onClick={() => setTab("flock")}
              compact={compact}
              title={`flock · ${formatNumber(data.subagent_count ?? 0)}`}
            >
              <Workflow className="w-3.5 h-3.5" aria-hidden />
              <span className="tabular">{formatNumber(data.subagent_count ?? 0)}</span>
            </TabButton>
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter…"
            className={cn(
              "shrink-0 font-mono text-[12px] px-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-accent)]",
              compact ? "w-[120px] h-6" : "w-[180px] h-7",
            )}
          />
        </div>
        {tab === "messages" && (
          <div className="flex gap-1 flex-wrap">
            {(["all", "user", "assistant", "tool", "system"] as const).map((r) => {
              const count =
                r === "all"
                  ? data.messages.length
                  : data.messages.filter((m) => m.role === r).length;
              if (r !== "all" && count === 0) return null;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleFilter(r)}
                  aria-pressed={roleFilter === r}
                  className={cn(
                    "rounded-[var(--radius-sm)] border font-mono transition-colors",
                    compact ? "px-1.5 h-5 text-[10px]" : "px-2 h-6 text-[11px]",
                    roleFilter === r
                      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]",
                  )}
                >
                  {r} · {formatNumber(count)}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className={cn("flex-1 min-h-0 overflow-y-auto", compact ? "px-3" : "px-4")}>
        {tab === "messages" && (
          <>
            {!compact && data.messages.length > 1 && (
              <div className="pt-3">
                <MessageLengthStrip messages={data.messages} compact={compact} />
              </div>
            )}
            <MessagesList
              messages={filteredMessages}
              freshKeys={freshMessageKeys}
              compact={compact}
            />
          </>
        )}
        {tab === "todos" && <TodosList todos={data.todos} />}
        {tab === "tools" && (
          <>
            <BashCommandPanel toolCalls={data.tool_calls} compact={compact} />
            <ToolTransitionMatrix toolCalls={data.tool_calls} compact={compact} />
            <ToolCallsList calls={filteredTools} />
          </>
        )}
        {tab === "files" && (
          <FilesTouchList toolCalls={data.tool_calls} compact={compact} />
        )}
        {tab === "lane" && (
          <SequenceLane
            data={data}
            compact={compact}
            onJumpToMessage={handleJumpToMessage}
            onJumpToToolByQuery={handleJumpToToolByQuery}
          />
        )}
        {tab === "agents" && dagEligible && (
          <SubagentTree
            childrenSessions={subagents.children}
            onOpenChild={handleOpenChild}
            loading={subagents.loading}
            error={subagents.error}
            compact={compact}
          />
        )}
        {tab === "dag" && dagEligible && (
          <SubagentDag
            childrenSessions={subagents.children}
            toolCalls={data.tool_calls}
            parentId={data.id}
            onOpenChild={handleOpenChild}
            loading={subagents.loading}
            error={subagents.error}
            compact={compact}
          />
        )}
        {tab === "flock" && (
          <SubagentFlockView
            childrenSessions={subagents.children}
            onOpenChild={handleOpenChild}
            loading={subagents.loading}
            error={subagents.error}
            compact={compact}
          />
        )}
      </div>
    </div>
  );
}
