# relay — Architecture

## Layered View

```
┌──────────────────────────────────────────────────────────────────┐
│                         User Interfaces                          │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────┐                │
│  │   CLI   │  │  Web UI  │  │  Hook (Claude)   │                │
│  │  (cmd)  │  │  (hono)  │  │ Stop / PreToolUse│                │
│  └────┬────┘  └─────┬────┘  └─────────┬────────┘                │
└───────┼─────────────┼─────────────────┼──────────────────────────┘
        │             │                 │
        ▼             ▼                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                          Query API                               │
│   listTasks() / today() / show() / search() / stats()            │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                       Storage (SQLite)                           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │  tasks   │ │ contexts │ │   runs   │ │ sources  │             │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘             │
│            ~/.relay/db.sqlite (bun:sqlite)                       │
└────────────────────────────────▲─────────────────────────────────┘
                                 │
                                 │ upsert (idempotent on source_id)
                                 │
┌────────────────────────────────┴─────────────────────────────────┐
│                       Ingest Pipeline                            │
│   sync orchestrator → adapter.fetch() → normalize → dedupe       │
└──────────────────┬───────────────────────────────────────────────┘
                   │
   ┌───────────────┼───────────────┬──────────────┬──────────────┐
   ▼               ▼               ▼              ▼              ▼
┌────────┐   ┌─────────┐   ┌─────────────┐  ┌──────────┐  ┌────────┐
│ code-  │   │ github  │   │ claude-     │  │ agents-  │  │ manual │
│ todo   │   │ issue/pr│   │ session     │  │ note     │  │        │
│ (rg)   │   │ (gh)    │   │ (.jsonl)    │  │ (.agents)│  │        │
└────────┘   └─────────┘   └─────────────┘  └──────────┘  └────────┘
                                                                ▲
                                                                │
┌────────────────────────────────────────────────────────────────┴───┐
│                       Execution Layer                              │
│   run() → resolveRepoPath() → spawn(agent, cwd, prompt)            │
│            ├─ claude-code → claude --resume <sid> | claude '<p>'   │
│            ├─ codex       → codex '<prompt>'                       │
│            ├─ antigravity → agy '<prompt>'                         │
│            ├─ self        → $EDITOR <repo>                         │
│            └─ human-review → open <github-url>                     │
└────────────────────────────────────────────────────────────────────┘
```

## Module Layout

```
relay/
├── src/
│   ├── cli.ts                  # CLI entry (commander); bin.relay points here
│   ├── index.ts                # public exports
│   ├── types.ts                # shared zod schemas + types (Task, Source, etc.)
│   ├── config.ts               # ~/.relay/config.toml loader
│   ├── paths.ts                # RELAY_HOME / DB_PATH resolution
│   ├── repo-resolver.ts        # repo name -> filesystem path
│   ├── repo-metadata.ts        # repo discovery helpers
│   ├── adapters/               # 15 source-type adapters
│   │   ├── index.ts            # registry + enabledAdapters()
│   │   ├── code-todo.ts        # ripgrep TODO/FIXME/HACK/XXX
│   │   ├── github.ts           # gh issue / pr
│   │   ├── gh-notification.ts
│   │   ├── gh-run-failure.ts
│   │   ├── gh-project-card.ts
│   │   ├── git-interrupted.ts
│   │   ├── git-stash.ts
│   │   ├── orphan-branch.ts
│   │   ├── claude-session.ts   # ~/.claude/projects/*/messages.jsonl
│   │   ├── codex-session.ts
│   │   ├── antigravity-session.ts
│   │   ├── cursor-session.ts
│   │   ├── agents-note.ts      # <repo>/.agents/*.md checkbox lines
│   │   └── manual.ts           # `relay add` entries
│   ├── api/                    # Hono sub-apps mounted by buildApp()
│   │   ├── tasks.ts            # /api/tasks*, /api/today
│   │   ├── queue.ts            # /api/queue
│   │   ├── views.ts            # /api/views (saved filters)
│   │   ├── sessions.ts         # /api/sessions/* + SSE stream
│   │   ├── sync.ts             # /api/sync + /api/sync/stream
│   │   ├── insights.ts         # /api/insights
│   │   ├── review.ts           # /api/review
│   │   ├── contexts.ts         # /api/contexts (+ graph)
│   │   ├── agenda.ts           # /api/agenda
│   │   ├── digest.ts           # /api/digest
│   │   ├── standup.ts          # /api/standup
│   │   ├── undo.ts             # /api/undo
│   │   ├── scan.ts             # /api/scan
│   │   ├── repo-agents.ts      # /api/repos/:name/agents
│   │   └── client-errors.ts    # /api/client-errors (browser error sink)
│   ├── commands/               # one file per CLI subcommand (~21)
│   ├── db/                     # bun:sqlite layer (commit e3dffc7 split)
│   │   ├── schema.sql          # canonical schema
│   │   ├── schema.ts           # runtime mirror + apply()
│   │   ├── migrations.ts       # schema_version bump logic
│   │   ├── types.ts            # row types (RelayContext, ContextGraphData, ...)
│   │   ├── client.ts           # RelayDB facade
│   │   ├── internal.ts         # shared low-level helpers
│   │   └── queries/            # topic-grouped query modules
│   │       ├── tasks.ts
│   │       ├── ingest.ts       # idempotent UPSERT keyed by (source_type, source_id)
│   │       ├── views.ts
│   │       ├── insights.ts
│   │       ├── aggregates.ts
│   │       ├── contexts.ts
│   │       └── runs.ts
│   ├── sessions/               # multi-CLI session readers
│   │   ├── index.ts            # getSession(type, id, roots)
│   │   ├── types.ts
│   │   ├── claude.ts
│   │   ├── codex.ts
│   │   └── antigravity.ts
│   ├── executor/               # spawn the assigned agent in repo cwd
│   │   ├── index.ts
│   │   ├── claude.ts
│   │   ├── codex.ts            # --resume parity (F-2)
│   │   └── antigravity.ts      # `agy`, preamble fallback (no UUID resume)
│   ├── context/                # repo snapshot save/restore
│   │   ├── git.ts              # rev-parse HEAD + status porcelain
│   │   ├── transcript.ts       # session transcript materialization
│   │   └── summarize.ts        # one-line cue (rule-based or --llm)
│   ├── lib/                    # cross-cutting helpers
│   │   ├── digest.ts
│   │   ├── priority.ts
│   │   ├── repo-from-cwd.ts
│   │   └── session-helpers.ts
│   └── web/
│       └── server.ts           # buildApp(): Hono app for /api/* + static SPA
├── README.md
├── INSTALL.md            # setup + troubleshooting (root .md fan-out)
├── CHEATSHEET.md         # CLI / Web hotkey quick reference
├── SPEC.md
├── ARCHITECTURE.md
├── WEB_DESIGN.md
├── HOTKEYS.md
├── CLAUDE.md             # AI agent guide (Claude Code)
├── AGENTS.md             # AI agent guide (Codex / Antigravity)
├── Makefile
├── docs/                 # GitHub Pages landing site (https://simota.github.io/relay/)
├── package.json
├── tsconfig.json
└── .relayrc.example.toml
```

## Key Sequences

### Seq-A: `relay sync` (full ingest)

```
User → CLI: relay sync
CLI → SyncOrchestrator: run()
  SyncOrchestrator → ConfigLoader: read ~/.relay/config.toml
  SyncOrchestrator → AdapterRegistry: enabled adapters

  par
    AdapterRegistry → CodeTodoAdapter: fetch(roots)
      CodeTodoAdapter → ripgrep: spawn
      ripgrep → CodeTodoAdapter: matches[]
      CodeTodoAdapter → SyncOrchestrator: Task[]
    AdapterRegistry → GitHubAdapter: fetch(user, orgs)
      GitHubAdapter → gh: spawn
      gh → GitHubAdapter: issues[], prs[]
      GitHubAdapter → SyncOrchestrator: Task[]
    AdapterRegistry → ClaudeSessionAdapter: fetch()
      ClaudeSessionAdapter → fs: walk ~/.claude/projects/
      fs → ClaudeSessionAdapter: jsonl[]
      ClaudeSessionAdapter → SyncOrchestrator: Task[]
  end par

  SyncOrchestrator → DB: upsertMany(tasks)
  DB → SyncOrchestrator: { inserted, updated, unchanged }
  SyncOrchestrator → CLI: report
CLI → User: "synced: 12 new, 4 updated, 38 unchanged"
```

### Seq-B: `relay run <id>` (execute task)

```
User → CLI: relay run 42
CLI → DB: getTask(42)
DB → CLI: task
CLI → RepoResolver: resolve(task.repo)
RepoResolver → CLI: /Users/simota/repos/github.com/<repo>
CLI → DB: insertRun(task_id, status='running')

alt task.assignee == 'claude-code'
  alt task.session_id present
    CLI → spawn: claude --resume <session_id> [cwd=repo]
  else
    CLI → spawn: claude '<prompt>' [cwd=repo]
  end
else task.assignee == 'codex'
  CLI → spawn: codex '<prompt>' [cwd=repo]
end

spawn → User: interactive session
note: relay watches the spawned process

User ↔ spawn: ... work ...
spawn → CLI: process exits
CLI → DB: updateRun(status='success', ended_at)
CLI → ContextSaver: save(task)
ContextSaver → git: rev-parse HEAD, status
ContextSaver → DB: insert context, update task.context_hash
```

### Seq-C: Claude session hook → auto context save

```
Claude Code: session Stop event
Hook → relay: relay context save --auto
relay → fs: find latest jsonl for cwd
relay → jsonlParser: extract last TodoWrite
jsonlParser → relay: todos[]
relay → git: status, rev-parse HEAD
git → relay: snapshot
relay → DB:
  - upsert tasks for unfinished todos (source_type='claude_session_todo')
  - insert context row
  - update related task.context_hash
relay → Claude Code: exit 0 (silent)
```

## Concurrency Model

- Sync は adapter ごとに並列 (`Promise.all`)
- DB は bun:sqlite の synchronous API、トランザクション内で upsert
- daemon は単一プロセス、SIGTERM で graceful shutdown
- Web UI は hono、SSE で sync 進捗を push

## Trust Boundaries

| Boundary | Validation |
|---|---|
| `relay sync` ingest | source_id 形式チェック、title 長さ制限 |
| `relay add` (CLI) | repo の存在確認、agent enum 検証 |
| `relay run` spawn | prompt の shell escape、cwd の repo root 内チェック |
| Hook 経由の自動 save | 呼び出し元の env (CLAUDE_SESSION_ID) を信頼、ファイル書き込みのみ |

## Dependencies

| Package | Purpose | Notes |
|---|---|---|
| `commander` | CLI parser | small, mature |
| `bun:sqlite` | DB | synchronous, fast (built-in Bun module) |
| `@iarna/toml` | config | TOML parser |
| `hono` | Web (v0.3+) | edge-style, fast |
| `zod` | validation | schema 検証 |
| `chalk` | CLI output | ANSI color |
| `date-fns` | due / age 計算 | tree-shakable |

外部 CLI 依存: `rg` (ripgrep), `gh` (GitHub CLI), `claude` (Claude Code), `git`。`relay doctor` で存在チェック。
