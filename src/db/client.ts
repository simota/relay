// RelayDB facade. Owns the bun:sqlite connection and schema bootstrap; every
// query body lives in `./queries/*` and the surrounding helpers in
// `./internal.ts` / `./migrations.ts`. Public types are re-exported below so
// 22+ existing import sites (`import { RelayDB, type ... } from "../db/client.js"`)
// keep working unchanged after the split.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "../paths.js";
import { SCHEMA_SQL } from "./schema.js";
import type { UndoLogRow } from "./schema.js";
import type { SessionRow, SessionType, SourceType, Task, TaskInput } from "../types.js";
import { runColumnMigrations } from "./migrations.js";
import { smartViews } from "./internal.js";
import {
  classifyTasks as _classifyTasks,
  upsertSnapshot as _upsertSnapshot,
  upsertTasks as _upsertTasks,
} from "./queries/ingest.js";
import {
  FS_BOUND_SOURCES,
  applyTaskStates as _applyTaskStates,
  batchCloseTasks as _batchCloseTasks,
  batchDeleteTasks as _batchDeleteTasks,
  bulkClose as _bulkClose,
  bulkSnooze as _bulkSnooze,
  closeTasksBySourceIds as _closeTasksBySourceIds,
  countSubagentsByParent as _countSubagentsByParent,
  findBySession as _findBySession,
  findDoneTasksInRepos as _findDoneTasksInRepos,
  findOpenTasksInRepos as _findOpenTasksInRepos,
  firstGithubSourceIdPerRepo as _firstGithubSourceIdPerRepo,
  forgetBySession as _forgetBySession,
  getSessionByTypeId as _getSessionByTypeId,
  getSessions as _getSessions,
  getTask as _getTask,
  getTaskBySourceId as _getTaskBySourceId,
  getTasksByIds as _getTasksByIds,
  listAllTasks as _listAllTasks,
  listOpenSourceIdsByType as _listOpenSourceIdsByType,
  listTasks as _listTasks,
  myOpenPrCountPerRepo as _myOpenPrCountPerRepo,
  restoreDeletedTasks as _restoreDeletedTasks,
  setAssignee as _setAssignee,
  setStatus as _setStatus,
  updateTaskState as _updateTaskState,
  upsertSession as _upsertSession,
} from "./queries/tasks.js";
import {
  countForViewFilter as _countForViewFilter,
  createView as _createView,
  deleteView as _deleteView,
  listSavedViews as _listSavedViews,
  smartInboxCounts as _smartInboxCounts,
  viewIdByName as _viewIdByName,
} from "./queries/views.js";
import {
  contextCount as _contextCount,
  contextGraph as _contextGraph,
  contextHighlightsSince as _contextHighlightsSince,
  getContext as _getContext,
  getLatestContextForRepo as _getLatestContextForRepo,
  insertContext as _insertContext,
  linkContextToActiveTasks as _linkContextToActiveTasks,
  listContexts as _listContexts,
  runContextSessionBackfill as _runContextSessionBackfill,
  setTaskContext as _setTaskContext,
  updateContextSummary as _updateContextSummary,
} from "./queries/contexts.js";
import {
  insightsAgeHistogram as _insightsAgeHistogram,
  insightsBurndown as _insightsBurndown,
  insightsContextFreshness as _insightsContextFreshness,
  insightsDuplicates as _insightsDuplicates,
  insightsFlowTimeseries as _insightsFlowTimeseries,
  insightsNewlyActive as _insightsNewlyActive,
  insightsOrphans as _insightsOrphans,
  insightsRunsByAgent as _insightsRunsByAgent,
  insightsSourceInflow as _insightsSourceInflow,
  insightsStale as _insightsStale,
  insightsStaleRepos as _insightsStaleRepos,
  insightsSyncReliabilityRaw as _insightsSyncReliabilityRaw,
  insightsThroughput as _insightsThroughput,
  insightsTouched as _insightsTouched,
  insightsVelocity as _insightsVelocity,
  insightsWaitAgeRaw as _insightsWaitAgeRaw,
  insightsWaitMix as _insightsWaitMix,
  insightsWfr as _insightsWfr,
  closeStaleTasks as _closeStaleTasks,
} from "./queries/insights.js";
import {
  agendaInRange as _agendaInRange,
  blockedTasks as _blockedTasks,
  closedTasksSince as _closedTasksSince,
  heatmap as _heatmap,
  overdueTasks as _overdueTasks,
  repoStats as _repoStats,
  reviewTasks as _reviewTasks,
  scheduledNoDate as _scheduledNoDate,
  selfDrivenTasks as _selfDrivenTasks,
  sourceCounts as _sourceCounts,
  sourceDelta7d as _sourceDelta7d,
  today as _today,
  viewCounts as _viewCounts,
} from "./queries/aggregates.js";
import {
  addQueueItem as _addQueueItem,
  clearQueue as _clearQueue,
  deleteQueueItem as _deleteQueueItem,
  finishRun as _finishRun,
  insertRun as _insertRun,
  lastSuccessfulSyncEndedAt as _lastSuccessfulSyncEndedAt,
  latestSuccessfulRunsForTasks as _latestSuccessfulRunsForTasks,
  latestSyncPerAdapter as _latestSyncPerAdapter,
  latestUndo as _latestUndo,
  listQueueItems as _listQueueItems,
  listSyncHistory as _listSyncHistory,
  listUndo as _listUndo,
  markUndoStatus as _markUndoStatus,
  pruneUndoOlderThan as _pruneUndoOlderThan,
  recordSyncHistory as _recordSyncHistory,
  recordUndo as _recordUndo,
  runsSince as _runsSince,
} from "./queries/runs.js";

import type {
  ContextGraphData,
  HeatmapData,
  LatestSyncRow,
  QueueItem,
  RelayContext,
  ReviewTasks,
  SavedView,
  SnapshotRow,
  SyncHistoryRow,
  TaskStatusSnapshot,
  UpsertResult,
  ViewFilter,
} from "./types.js";

// Re-export public type surface so existing
// `import { RelayDB, type SnapshotRow, type ViewFilter, ... } from "../db/client.js"`
// sites continue to compile unchanged after the split.
export type {
  ContextGraphData,
  ContextGraphNodeType,
  HeatmapData,
  LatestSyncRow,
  QueueItem,
  RelayContext,
  ReviewTasks,
  SavedView,
  SnapshotRow,
  SyncHistoryRow,
  TaskStatusSnapshot,
  UpsertResult,
  ViewFilter,
} from "./types.js";

// Track which DB paths have had schema applied this process so we run the
// idempotent CREATE TABLE / migrate steps once per path instead of on every
// `new RelayDB()` (the server opens+closes a connection per request).
const SCHEMA_APPLIED = new Set<string>();

export class RelayDB {
  private db: Database;

  constructor(path: string = DB_PATH) {
    // bun:sqlite creates the file but not its parent dir — ensure RELAY_HOME
    // exists so callers (web server, hooks) don't fail before `relay init`.
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    if (!SCHEMA_APPLIED.has(path)) {
      const hadTasksTable =
        this.db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks' LIMIT 1")
          .get() !== undefined;
      this.applySchema();
      if (!hadTasksTable) {
        console.warn(`[relay] auto-applied schema (was empty) at ${path}`);
      }
      SCHEMA_APPLIED.add(path);
    }
  }

  applySchema(): void {
    this.db.exec(SCHEMA_SQL);
    runColumnMigrations(this.db);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Reclaim free pages and shrink the on-disk file. `VACUUM` rewrites the
   * entire database, so callers should hold no other transactions open.
   * Used by `relay maintain` after large prune operations.
   */
  vacuum(): void {
    this.db.exec("VACUUM");
  }

  // Filesystem-bound source types — these tasks cannot exist meaningfully
  // when the local repo directory is gone. github_issue/pr live on github.com,
  // manual tasks may target remote-only repos, so we leave those alone.
  static readonly FS_BOUND_SOURCES: readonly string[] = FS_BOUND_SOURCES;

  // --- ingest -------------------------------------------------------------

  classifyTasks(tasks: TaskInput[]): UpsertResult & { sampleSourceIds: string[] } {
    return _classifyTasks(this.db, tasks);
  }

  upsertTasks(tasks: TaskInput[]): UpsertResult {
    return _upsertTasks(this.db, tasks);
  }

  upsertSnapshot(rows: SnapshotRow[]): { inserted: number; updated: number; conflicted: number } {
    return _upsertSnapshot(this.db, rows);
  }

  // --- tasks (CRUD, list, mutate, sessions) ------------------------------

  listAllTasks(): Task[] {
    return _listAllTasks(this.db);
  }

  getTaskBySourceId(sourceType: string, sourceId: string): Task | null {
    return _getTaskBySourceId(this.db, sourceType, sourceId);
  }

  /**
   * Returns every `source_id` for non-done tasks of the given source_type.
   */
  listOpenSourceIdsByType(sourceType: string): string[] {
    return _listOpenSourceIdsByType(this.db, sourceType);
  }

  getTask(id: number): Task | null {
    return _getTask(this.db, id);
  }

  getTasksByIds(ids: number[]): Task[] {
    return _getTasksByIds(this.db, ids);
  }

  listTasks(filters: {
    repo?: string;
    source?: string;
    status?: string;
    assignee?: string;
    context?: string;
    session?: string;
    age?: string;
    limit?: number;
  }): Task[] {
    return _listTasks(this.db, filters);
  }

  setStatus(id: number, status: string): void {
    _setStatus(this.db, id, status);
  }

  setAssignee(id: number, assignee: string): void {
    _setAssignee(this.db, id, assignee);
  }

  firstGithubSourceIdPerRepo(): Map<string, string> {
    return _firstGithubSourceIdPerRepo(this.db);
  }

  myOpenPrCountPerRepo(): Map<string, number> {
    return _myOpenPrCountPerRepo(this.db);
  }

  findOpenTasksInRepos(repos: string[], sourceTypes?: string[]): Task[] {
    return _findOpenTasksInRepos(this.db, repos, sourceTypes);
  }

  findDoneTasksInRepos(repos: string[], sourceTypes?: string[]): Task[] {
    return _findDoneTasksInRepos(this.db, repos, sourceTypes);
  }

  closeTasksBySourceIds(
    items: Array<{ source_type: string; source_id: string }>,
  ): TaskStatusSnapshot[] {
    return _closeTasksBySourceIds(this.db, items);
  }

  batchCloseTasks(ids: number[]): TaskStatusSnapshot[] {
    return _batchCloseTasks(this.db, ids);
  }

  batchDeleteTasks(ids: number[]): Task[] {
    return _batchDeleteTasks(this.db, ids);
  }

  restoreDeletedTasks(snapshots: Task[]): number {
    return _restoreDeletedTasks(this.db, snapshots);
  }

  findBySession(sourceType: string, sessionId: string): Task[] {
    return _findBySession(this.db, sourceType, sessionId);
  }

  forgetBySession(sourceType: string, sessionId: string): number {
    return _forgetBySession(this.db, sourceType, sessionId);
  }

  updateTaskState(snapshot: TaskStatusSnapshot): void {
    _updateTaskState(this.db, snapshot);
  }

  applyTaskStates(snapshots: TaskStatusSnapshot[]): number {
    return _applyTaskStates(this.db, snapshots);
  }

  bulkSnooze(ids: number[], until: string): number {
    return _bulkSnooze(this.db, ids, until);
  }

  bulkClose(ids: number[]): number {
    return _bulkClose(this.db, ids);
  }

  upsertSession(row: SessionRow): void {
    _upsertSession(this.db, row);
  }

  getSessions(
    opts: {
      type?: SessionType;
      repo?: string;
      sinceLastActive?: string;
      limit?: number;
      parent?: string;
      includeSubagents?: boolean;
    } = {},
  ): SessionRow[] {
    return _getSessions(this.db, opts);
  }

  getSessionByTypeId(type: SessionType, id: string): SessionRow | null {
    return _getSessionByTypeId(this.db, type, id);
  }

  countSubagentsByParent(type: SessionType): Map<string, number> {
    return _countSubagentsByParent(this.db, type);
  }

  // --- views (saved + smart) ---------------------------------------------

  listViews(): SavedView[] {
    const saved = _listSavedViews(this.db);
    return [...smartViews(this), ...saved];
  }

  createView(input: { name: string; filter: ViewFilter; pinned?: boolean }): SavedView {
    return _createView(this.db, input);
  }

  deleteView(id: number): boolean {
    return _deleteView(this.db, id);
  }

  countForViewFilter(filter: ViewFilter): number {
    return _countForViewFilter(this.db, filter);
  }

  smartInboxCounts(): Record<string, number> {
    return _smartInboxCounts(this.db);
  }

  // Internal helper preserved for parity with the pre-split shape; the
  // facade itself no longer calls it (createView resolves the id via the
  // views module). Kept on the class so any future caller can still reach it.
  private viewIdByName(name: string): number {
    return _viewIdByName(this.db, name);
  }

  // --- aggregates / dashboards -------------------------------------------

  today(limit: number, excludeRepos: string[] = [], decayDays: number = 0): Task[] {
    return _today(this.db, limit, excludeRepos, decayDays);
  }

  viewCounts(excludeRepos: string[] = []): {
    today: number;
    open: number;
    snoozed: number;
    done: number;
  } {
    return _viewCounts(this.db, excludeRepos);
  }

  sourceCounts(): Record<string, number> {
    return _sourceCounts(this.db);
  }

  sourceDelta7d(): number {
    return _sourceDelta7d(this.db);
  }

  repoStats(): Array<{
    name: string;
    open: number;
    in_progress: number;
    snoozed: number;
    lastTouched: string;
    dailyEventCounts: number[];
  }> {
    return _repoStats(this.db);
  }

  heatmap(
    range: { weekStarts: string[]; weekEnds: string[] },
    sourceTypes: SourceType[] = [],
  ): HeatmapData {
    return _heatmap(this.db, range, sourceTypes);
  }

  reviewTasks(range: {
    weekStart: string;
    weekEnd: string;
    previousWeekStart: string;
    staleBefore: string;
  }): ReviewTasks {
    return _reviewTasks(this.db, range);
  }

  closedTasksSince(sinceIso: string, untilIso?: string): Task[] {
    return _closedTasksSince(this.db, sinceIso, untilIso);
  }

  selfDrivenTasks(limit: number, excludeRepos: string[] = []): Task[] {
    return _selfDrivenTasks(this.db, limit, excludeRepos);
  }

  blockedTasks(limit: number, excludeRepos: string[] = []): Task[] {
    return _blockedTasks(this.db, limit, excludeRepos);
  }

  agendaInRange(fromIso: string, toIso: string, excludeRepos: string[] = []): Task[] {
    return _agendaInRange(this.db, fromIso, toIso, excludeRepos);
  }

  overdueTasks(beforeIso: string, excludeRepos: string[] = []): Task[] {
    return _overdueTasks(this.db, beforeIso, excludeRepos);
  }

  scheduledNoDate(excludeRepos: string[] = []): Task[] {
    return _scheduledNoDate(this.db, excludeRepos);
  }

  // --- contexts -----------------------------------------------------------

  runContextSessionBackfill(opts: { dryRun?: boolean } = {}): {
    total: number;
    eligible: number;
    updated: number;
  } {
    return _runContextSessionBackfill(this.db, opts);
  }

  contextCount(): number {
    return _contextCount(this.db);
  }

  insertContext(input: {
    hash: string;
    repo: string;
    branch: string;
    headSha: string;
    dirtyFiles: string[];
    summary: string;
    sessionId?: string | null;
  }): void {
    _insertContext(this.db, input);
  }

  updateContextSummary(input: {
    hash: string;
    summary: string;
    generatedAt: string | null;
    modelName: string | null;
  }): boolean {
    return _updateContextSummary(this.db, input);
  }

  setTaskContext(taskId: number, contextHash: string): void {
    _setTaskContext(this.db, taskId, contextHash);
  }

  linkContextToActiveTasks(repo: string, contextHash: string, sessionId?: string): number {
    return _linkContextToActiveTasks(this.db, repo, contextHash, sessionId);
  }

  getContext(hash: string): RelayContext | null {
    return _getContext(this.db, hash);
  }

  getLatestContextForRepo(repo: string): RelayContext | null {
    return _getLatestContextForRepo(this.db, repo);
  }

  listContexts(repo?: string, limit = 50): RelayContext[] {
    return _listContexts(this.db, repo, limit);
  }

  contextGraph(filters: { repo?: string; limit?: number } = {}): ContextGraphData {
    return _contextGraph(this.db, filters);
  }

  contextHighlightsSince(sinceIso: string, limit = 10): RelayContext[] {
    return _contextHighlightsSince(this.db, sinceIso, limit);
  }

  // --- insights -----------------------------------------------------------

  insightsWfr(periodWeeks: number): ReturnType<typeof _insightsWfr> {
    return _insightsWfr(this.db, periodWeeks);
  }

  insightsThroughput(windowDays: number): { closed: number; opened: number } {
    return _insightsThroughput(this.db, windowDays);
  }

  insightsStale(thresholdDays: number): { stale: number; open_total: number } {
    return _insightsStale(this.db, thresholdDays);
  }

  insightsTouched(windowDays: number): { active: number; total: number } {
    return _insightsTouched(this.db, windowDays);
  }

  insightsWaitAgeRaw(): number[] {
    return _insightsWaitAgeRaw(this.db);
  }

  insightsStaleRepos(limit: number): ReturnType<typeof _insightsStaleRepos> {
    return _insightsStaleRepos(this.db, limit);
  }

  insightsNewlyActive(windowDays: number): ReturnType<typeof _insightsNewlyActive> {
    return _insightsNewlyActive(this.db, windowDays);
  }

  insightsFlowTimeseries(days: number): ReturnType<typeof _insightsFlowTimeseries> {
    return _insightsFlowTimeseries(this.db, days);
  }

  insightsWaitMix(): ReturnType<typeof _insightsWaitMix> {
    return _insightsWaitMix(this.db);
  }

  insightsAgeHistogram(): ReturnType<typeof _insightsAgeHistogram> {
    return _insightsAgeHistogram(this.db);
  }

  insightsSourceInflow(windowDays: number): ReturnType<typeof _insightsSourceInflow> {
    return _insightsSourceInflow(this.db, windowDays);
  }

  insightsRunsByAgent(days: number): ReturnType<typeof _insightsRunsByAgent> {
    return _insightsRunsByAgent(this.db, days);
  }

  insightsSyncReliabilityRaw(days: number): ReturnType<typeof _insightsSyncReliabilityRaw> {
    return _insightsSyncReliabilityRaw(this.db, days);
  }

  insightsContextFreshness(limit: number): ReturnType<typeof _insightsContextFreshness> {
    return _insightsContextFreshness(this.db, limit);
  }

  insightsOrphans(ageDays: number, limit: number): ReturnType<typeof _insightsOrphans> {
    return _insightsOrphans(this.db, ageDays, limit);
  }

  insightsBurndown(days: number): ReturnType<typeof _insightsBurndown> {
    return _insightsBurndown(this.db, days);
  }

  insightsVelocity(weeks: number): ReturnType<typeof _insightsVelocity> {
    return _insightsVelocity(this.db, weeks);
  }

  insightsDuplicates(minSimilarity?: number): ReturnType<typeof _insightsDuplicates> {
    return _insightsDuplicates(this.db, minSimilarity);
  }

  closeStaleTasks(thresholdDays: number): ReturnType<typeof _closeStaleTasks> {
    return _closeStaleTasks(this.db, thresholdDays);
  }

  // --- runs / sync_history / queue / undo --------------------------------

  latestSuccessfulRunsForTasks(
    taskIds: number[],
    sinceIso: string,
  ): Map<number, { agent: string; output_summary: string | null; ended_at: string | null }> {
    return _latestSuccessfulRunsForTasks(this.db, taskIds, sinceIso);
  }

  insertRun(taskId: number, agent: string): number {
    return _insertRun(this.db, taskId, agent);
  }

  finishRun(runId: number, status: string, summary?: string): void {
    _finishRun(this.db, runId, status, summary);
  }

  runsSince(sinceIso: string): ReturnType<typeof _runsSince> {
    return _runsSince(this.db, sinceIso);
  }

  recordSyncHistory(input: {
    started_at: string;
    ended_at: string;
    adapter: string;
    status: "ok" | "error" | "skipped";
    count: number;
    error?: string | null;
  }): number {
    return _recordSyncHistory(this.db, input);
  }

  latestSyncPerAdapter(): LatestSyncRow[] {
    return _latestSyncPerAdapter(this.db);
  }

  listSyncHistory(filters: { adapter?: string; limit?: number } = {}): SyncHistoryRow[] {
    return _listSyncHistory(this.db, filters);
  }

  lastSuccessfulSyncEndedAt(adapter: string): string | null {
    return _lastSuccessfulSyncEndedAt(this.db, adapter);
  }

  addQueueItem(taskId: number): number | null {
    return _addQueueItem(this.db, taskId);
  }

  listQueueItems(): QueueItem[] {
    return _listQueueItems(this.db);
  }

  deleteQueueItem(id: number): boolean {
    return _deleteQueueItem(this.db, id);
  }

  clearQueue(): void {
    _clearQueue(this.db);
  }

  recordUndo(input: { op_kind: string; payload: unknown; inverse: unknown }): number {
    return _recordUndo(this.db, input);
  }

  listUndo(limit = 20): UndoLogRow[] {
    return _listUndo(this.db, limit);
  }

  latestUndo(status: UndoLogRow["status"]): UndoLogRow | null {
    return _latestUndo(this.db, status);
  }

  markUndoStatus(id: number, status: UndoLogRow["status"]): boolean {
    return _markUndoStatus(this.db, id, status);
  }

  pruneUndoOlderThan(days: number): number {
    return _pruneUndoOlderThan(this.db, days);
  }
}
