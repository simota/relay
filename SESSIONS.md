# SESSIONS.md — CLI Session Integration Reference

**Audience**: contributors extending relay's session adapters or debugging session ingest  
**Scope**: on-disk file layouts, JSONL/transcript schemas, relay's extraction logic, and `sessions` table mapping for Claude Code, Codex CLI, and Antigravity CLI (`agy`)  
**Non-scope**: `source_id` convention overview (canonical in `SPEC.md §6`), Web UI session browser (see `WEB_DESIGN.md`)

Related: `SPEC.md §6`, `ARCHITECTURE.md`, `src/sessions/types.ts`

---

## 1. Overview

relay treats each CLI session as both a **todo source** and a **sessions-table row**. Three coding-agent CLIs are supported:

| CLI | Binary | Adapter name | `sessions.type` |
|---|---|---|---|
| [Claude Code](https://claude.ai/code) | `claude` | `claude_session_todo` | `claude` |
| [Codex CLI](https://github.com/openai/codex) | `codex` | `codex_session_todo` | `codex` |
| [Antigravity CLI](https://github.com/google-gemini/gemini-cli) | `agy` | `antigravity_session_todo` | `antigravity` |

Each adapter runs during `relay sync` and performs two operations:

1. **Task ingest**: extracts todo items → UPSERTs into `tasks` as `TaskInput` records.
2. **Session upsert** (best-effort): writes one row per discovered session into `sessions` via `db.upsertSession()`.

Config flag keys (`~/.relay/config.toml`, under `[adapters]`): `claude_session`, `codex_session`, `antigravity_session`. All default to `true`.

---

## 2. Claude Code

### 2.1 On-disk layout

```
~/.claude/
└── projects/
    └── <project-hash>/          # kebab-cased hash of the workspace path
        ├── <session-uuid>.jsonl # parent session (UUID v4)
        └── <parent-uuid>/
            └── subagents/
                └── agent-<short-hex>.jsonl  # subagent session
```

`<project-hash>` is computed by Claude Code from the workspace absolute path and can silently truncate kebab-segmented repo names — relay prefers `cwd`-field-based repo resolution. Subagent ids begin with `agent-` (not UUID v4); relay uses this prefix to distinguish them from parent sessions (`isAgentId()` in `src/sessions/claude.ts`).

### 2.2 JSONL record schema

Each line is a JSON object. Two structural shapes coexist:

**Shape A — wrapped event** (most lines):

```jsonc
{
  "timestamp": "2026-05-20T10:31:45.123Z",
  "cwd": "/absolute/path/to/repo",  // first occurrence drives repo resolution
  "message": {
    "role": "user" | "assistant" | "system",
    "content": "string | ContentBlock[]",
    "stop_reason": "end_turn" | "tool_use" | "max_tokens" | null  // assistant only
  }
}
```

**ContentBlock** variants inside `content[]`:

```jsonc
{ "type": "text",        "text": "..." }
{ "type": "tool_use",    "id": "toolu_01...", "name": "Bash", "input": { ... } }
{ "type": "tool_result", "tool_use_id": "toolu_01...", "content": "..." }
```

**Shape B — bare event** (older or simplified entries): `role` and `content` at the top level rather than inside `message`. `getToolUseBlocks()` handles both by probing `obj.message.content` first, then `obj.content`.

**Fields relay reads**:

| Field | Path | Usage |
|---|---|---|
| `cwd` | `obj.cwd` (first occurrence) | Repo resolution |
| `timestamp` | `obj.timestamp` | `last_active`, status detection |
| `message.role` | `obj.message.role` or `obj.role` | Role classification |
| `message.content` | `obj.message.content` or `obj.content` | Text + tool scanning |
| `message.stop_reason` | `obj.message.stop_reason` | `ended` status |
| `content[type=tool_use].id/name/input` | — | Todo extraction, tool_calls |
| `content[type=tool_result].tool_use_id` | — | Pending tool detection |
| `input.run_in_background` | inside tool_use input | Background tool exclusion |

### 2.3 Todo extraction

Two tool conventions are tracked:

**TaskCreate / TaskUpdate (current)**:
- `TaskCreate { subject }` → creates task with id `tc-<counter>` (monotonic, starts at 1)
- `TaskUpdate { taskId, status }` → mutates by `tc-<taskId>`

**TodoWrite (legacy)** — replaces the entire list atomically:
```jsonc
{ "name": "TodoWrite", "input": { "todos": [{ "id": "1", "content": "...", "status": "pending" }] } }
```
When `TodoWrite` fires, relay clears all tasks and resets the counter; items use id `tw-<item.id>`.

`reduceEvents()` (`src/adapters/claude-session.ts:388`) processes events chronologically. The `tc-` / `tw-` namespace prefixes prevent `source_id` collisions when both conventions appear in the same session.

**Status mapping**: `completed` → task skipped; `in_progress` → `"in_progress"`; anything else → `"open"`.

### 2.4 source_id format

See `SPEC.md §6 claude-session`. Quick reference:

- Parent + TaskCreate: `${session_uuid}:tc-${counter}`
- Parent + TodoWrite: `${session_uuid}:tw-${todo_id}`
- Subagent: same patterns with `${agent_id}` as prefix

### 2.5 Session status detection

`detectClaudeSessionStatus(text)` (`src/lib/session-status.ts:64`) classifies by scanning the JSONL tail:

| Status | Condition |
|---|---|
| `interrupted` | `[Request interrupted by user...]` marker after last assistant event |
| `waiting_for_user` | Unanswered foreground `tool_use` (no matching `tool_result`), quiet > 5 s |
| `active` | Unanswered `tool_use` but last timestamp within 5 s |
| `ended` | Last assistant has `stop_reason: "end_turn"` with no trailing activity |
| `idle` | Default; no classifiable signal |

Background tool calls (`input.run_in_background === true`) are excluded from the pending-tool check.

### 2.6 Code reference

| Symbol | File |
|---|---|
| `claudeSessionAdapter` | `src/adapters/claude-session.ts:67` |
| `extractToolEvents()` | `src/adapters/claude-session.ts:323` |
| `reduceEvents()` | `src/adapters/claude-session.ts:388` |
| `extractLastMessageText()` | `src/adapters/claude-session.ts:452` |
| `getClaudeSession()` | `src/sessions/claude.ts:31` |
| `detectClaudeSessionStatus()` | `src/lib/session-status.ts:64` |

---

## 3. Codex CLI

### 3.1 On-disk layout

```
~/.codex/
└── sessions/
    └── <year>/<month>/<day>/     # e.g. 2026/05/22
        └── rollout-<session-id>.jsonl
```

Relay walks the year/month/day tree with early-exit pruning: directories whose end-of-day boundary is before `cutoffMs` are skipped entirely without stat-ing individual files.

### 3.2 JSONL record schema

Each line has a top-level `type` field. Three types matter:

**`session_meta`** — first record, written once per session:

```jsonc
{
  "type": "session_meta",
  "timestamp": "2026-05-20T10:31:45.123Z",
  "payload": {
    "id": "abc123def456",
    "cwd": "/absolute/path/to/repo",
    "timestamp": "2026-05-20T10:31:45.123Z",  // session start
    "source": {
      "subagent": {                             // only on spawn_agent children
        "thread_spawn": { "parent_thread_id": "<parent-id>" }
      }
    }
  }
}
```

**`event_msg`** — user and agent turns:

```jsonc
{
  "type": "event_msg",
  "timestamp": "...",
  "payload": {
    "type": "user_message" | "agent_message" | "task_complete" | "task_started" | "token_count",
    "message": "string"   // present for user_message / agent_message
  }
}
```

**`response_item`** — tool invocations and their outputs:

```jsonc
// Tool call
{ "type": "response_item", "payload": { "type": "function_call", "call_id": "call_abc", "name": "bash", "arguments": "{\"command\":\"ls\"}" } }
// Tool result
{ "type": "response_item", "payload": { "type": "function_call_output", "call_id": "call_abc", "output": "..." } }
```

**Fields relay reads**:

| Field | Path | Usage |
|---|---|---|
| `payload.id` | `session_meta` | Session id |
| `payload.cwd` | `session_meta` | Repo resolution |
| `payload.timestamp` | `session_meta` | `started_at` |
| `payload.source.subagent.thread_spawn.parent_thread_id` | `session_meta` | Parent session id |
| `payload.type` | `event_msg` | Message type routing |
| `payload.message` | `event_msg` | Title (first user_message), `last_message_text` |
| `payload.call_id` | `response_item/function_call` | Tool pairing for status |
| `payload.name` / `payload.arguments` | `response_item/function_call` | Tool name, `args_json` |

### 3.3 Todo extraction

Codex has no structured todo API. The session itself is the unit of ingest: the first `user_message` body (via `firstNonEmptyLine()`) becomes the task title (truncated to 120 chars). One task per session, `status: "in_progress"`. `todos_count` is always 0.

### 3.4 Session status detection

`detectCodexSessionStatus(text)` (`src/lib/session-status.ts:277`) pairs `function_call` / `function_call_output` by `call_id`:

| Status | Condition |
|---|---|
| `active` | Unanswered `function_call`, within 5 s |
| `waiting_for_user` | Unanswered `function_call`, quiet > 5 s |
| `ended` | Last meaningful event is `event_msg/task_complete` |
| `idle` | Default |

`token_count` and `task_started` event types are intentionally skipped.

### 3.5 Code reference

| Symbol | File |
|---|---|
| `codexSessionAdapter` | `src/adapters/codex-session.ts:65` |
| `parseCodexSession()` | `src/adapters/codex-session.ts:231` |
| `collectRecentJsonl()` | `src/adapters/codex-session.ts:168` |
| `getCodexSession()` | `src/sessions/codex.ts:15` |
| `detectCodexSessionStatus()` | `src/lib/session-status.ts:277` |

---

## 4. Antigravity CLI (`agy`)

### 4.1 On-disk layout

```
~/.gemini/antigravity-cli/
├── brain/
│   └── <conversationId>/
│       └── .system_generated/logs/transcript.jsonl  # human-readable (relay reads this)
├── conversations/
│   └── <conversationId>.pb   # binary protobuf — NOT read by relay
├── history.jsonl             # conversationId → workspace (primary cwd source)
└── cache/
    └── last_conversations.json  # workspace → conversationId (fallback cwd source)
```

Relay ignores `conversations/<id>.pb` (binary protobuf) entirely and reads only `transcript.jsonl`, which is the human-readable mirror of the conversation.

### 4.2 transcript.jsonl record schema

Each line is a `TranscriptEntry`:

```jsonc
{
  "step_index": 0,
  "source": "USER_EXPLICIT" | "MODEL" | "SYSTEM" | "TOOL",
  "type": "USER_INPUT" | "PLANNER_RESPONSE" | "CONVERSATION_HISTORY" | "TOOL_OUTPUT",
  "status": "DONE" | "RUNNING",
  "created_at": "2026-05-20T10:31:45.123Z",
  "content": "string",           // USER_INPUT: XML-wrapped; others: plain text
  "tool_calls": [
    { "name": "bash", "args": { "command": "ls" }, "toolAction": "Running command", "toolSummary": "Listed files" }
  ]
}
```

**`USER_INPUT` content format** — the actual user prompt is wrapped in `<USER_REQUEST>...</USER_REQUEST>` tags inside a larger XML envelope (including `<ADDITIONAL_METADATA>` and `<USER_SETTINGS_CHANGE>` sections). `extractUserRequest()` strips the envelope.

**Fields relay reads**:

| Field | Usage |
|---|---|
| `type` | Role classification |
| `source` | Secondary role signal |
| `status` | Direct status detection (`RUNNING` → active) |
| `created_at` | `last_active`, `started_at`, status detection |
| `content` | Message text (envelope stripped for USER_INPUT) |
| `tool_calls[].name` / `.args` / `.toolAction` / `.toolSummary` | Tool detail |

**Role mapping**:

| Entry | `SessionMessage.role` |
|---|---|
| `type === "USER_INPUT"` or `source === "USER_EXPLICIT"` | `"user"` |
| `type === "PLANNER_RESPONSE"` or `source === "MODEL"` | `"assistant"` |
| `source === "SYSTEM"` | `"system"` |
| `source === "TOOL"` | `"tool"` |
| `type === "CONVERSATION_HISTORY"` | skipped (bookkeeping) |

### 4.3 Workspace (cwd) resolution

`loadConversationWorkspaceMap()` merges two sources:

**Primary: `history.jsonl`** — one line per prompt:

```jsonc
{ "conversationId": "<id>", "workspace": "/absolute/path" }
```

Limitation: the first prompt of a new conversation is written *before* a `conversationId` is assigned, so single-prompt conversations often lack an entry here.

**Fallback: `cache/last_conversations.json`** — JSON object with inverted key/value order:

```jsonc
{ "/absolute/path": "<conversationId>" }
```

Covers single-prompt conversations but stores only the *latest* conversation per workspace. **Merge rule**: primary wins on conflict.

### 4.4 Todo extraction

Antigravity has no structured todo API. The session is the unit: the first `USER_INPUT` content (after `<USER_REQUEST>` stripping) becomes the task title. One task per conversation, `status: "in_progress"`. `todos_count` is always 0.

### 4.5 Session status detection

`detectAntigravitySessionStatus(text)` (`src/lib/session-status.ts:379`) uses the native per-entry `status` field — simpler than Claude/Codex:

| Status | Condition |
|---|---|
| `active` | Last meaningful entry has `status === "RUNNING"` |
| `active` | Last meaningful entry is `type === "USER_INPUT"` |
| `ended` | Last meaningful entry is `PLANNER_RESPONSE`, status `"DONE"`, no `tool_calls` |
| `idle` | Default; classifies by recency otherwise |

`CONVERSATION_HISTORY` entries are skipped.

### 4.6 Code reference

| Symbol | File |
|---|---|
| `antigravitySessionAdapter` | `src/adapters/antigravity-session.ts:64` |
| `loadConversationWorkspaceMap()` | `src/adapters/antigravity-session.ts:205` |
| `parseAntigravityTranscript()` | `src/adapters/antigravity-session.ts:251` |
| `extractUserRequest()` | `src/adapters/antigravity-session.ts:331` |
| `getAntigravitySession()` | `src/sessions/antigravity.ts:31` |
| `detectAntigravitySessionStatus()` | `src/lib/session-status.ts:379` |

---

## 5. Common Infrastructure

### 5.1 sessions table schema (schema v8)

```sql
CREATE TABLE sessions (
  id                 TEXT NOT NULL,   -- session id
  type               TEXT NOT NULL,   -- "claude"|"codex"|"antigravity"|"cursor"
  repo               TEXT,            -- bare repo name (null when cwd resolution fails)
  cwd                TEXT,            -- absolute working directory
  started_at         TEXT NOT NULL,   -- ISO 8601; preserved across re-ingest (UPSERT does not overwrite)
  last_active        TEXT NOT NULL,   -- ISO 8601; refreshed on every re-ingest
  message_count      INTEGER NOT NULL DEFAULT 0,
  parent_session_id  TEXT,            -- parent uuid for subagents; null for top-level
  source_path        TEXT NOT NULL,   -- absolute path to JSONL/transcript file
  sha                TEXT,            -- content hash (reserved; unused by current adapters)
  status             TEXT NOT NULL DEFAULT 'idle',
  last_message_text  TEXT,            -- truncated preview ≤240 chars
  title              TEXT,            -- first user prompt ≤240 chars (schema v8)
  PRIMARY KEY (type, id)
);
```

PRIMARY KEY is `(type, id)` — cross-CLI id collisions are impossible.

`toSessionRow()` (`src/lib/session-helpers.ts:108`) normalizes per-adapter values. `started_at` is preserved across UPSERT; `last_active`, `message_count`, `status`, `last_message_text`, and `title` are overwritten.

### 5.2 SessionStatus lifecycle

```
idle ──(activity)──► active ──(tool pending >5s)──► waiting_for_user
                         │                                   │
                         ▼                                   ▼
                       ended ◄──(stop_reason:end_turn)   interrupted
```

- `idle`: default; no classifiable signal
- `active`: tool call in flight within the 5 s idle window
- `waiting_for_user`: tool pending past idle window (permission prompt, AskUserQuestion)
- `interrupted`: user cancelled — Claude only (`[Request interrupted by user...]` marker)
- `ended`: last turn finished cleanly; ball is in the user's court

### 5.3 SessionDetail / SessionMessage shapes

Defined in `src/sessions/types.ts`:

```typescript
interface SessionMessage {
  timestamp: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;           // truncated to 4 000 chars
}

interface SessionToolCall {
  timestamp: string;
  name: string;
  args_summary: string;   // ≤200 chars
  args_json: string | null; // ≤4 000 chars; null when unavailable
}
```

`todos` in `SessionDetail` is populated only for Claude (from `TodoWrite` / `TaskCreate`); Codex and Antigravity always return `[]`.

### 5.4 Incremental sync cursor

All three adapters skip files whose `mtime <= parseCursorMs(ctx.lastSyncCursor)`. `ctx.lastSyncCursor` is an ISO 8601 string set by `runSync()` after each successful sync. A garbled or absent cursor falls back to a full sweep; a `stat` failure conservatively re-processes the file.

### 5.5 Repo resolution

`resolveRepoForCwd(cwd, roots)` (`src/lib/repo-from-cwd.ts`) walks up from `cwd` to find a `.git` directory, then matches the resolved path against `scan.roots`. When cwd resolution fails, `repo` is stored as `null`; the session row is still upserted, but no task is generated.

### 5.6 Adapter config knobs

All three adapters share identical config fields:

```toml
[claude_session]      # or [codex_session] / [antigravity_session]
lookback_days = 7     # only files modified within this window; default 7
store_body = true     # include human-readable body in tasks; default true
exclude_patterns = [] # regex list matched against full file path
```

---

## 6. Inspecting Sessions Directly

**Claude**:
```bash
# Find session files
ls ~/.claude/projects/ | grep <repo-fragment>
# Extract TodoWrite calls
jq 'select(.message.content[]?.name=="TodoWrite")' ~/.claude/projects/<hash>/<uuid>.jsonl
```

**Codex**:
```bash
# Session metadata
jq 'select(.type=="session_meta") | .payload' ~/.codex/sessions/2026/05/22/rollout-<id>.jsonl
# User messages
jq 'select(.type=="event_msg" and .payload.type=="user_message") | .payload.message' ~/.codex/sessions/2026/05/22/rollout-<id>.jsonl
```

**Antigravity**:
```bash
# List conversations
ls ~/.gemini/antigravity-cli/brain/
# View transcript
jq '.' ~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl | head -40
# Workspace map
jq 'select(.conversationId=="<id>")' ~/.gemini/antigravity-cli/history.jsonl
```
