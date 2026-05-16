# relay — Specification

`v0.1 draft / 2026-05-12`

## 1. Problem

40+リポを横断する個人多事業主にとって、以下4つの摩擦が日常的に発生する。

1. **作業の散在** — TODO は code, GitHub issue/PR, `.agents/`, Claude session に分散しており単一視点が無い
2. **コンテキスト復元コスト** — 数日前 repo X でやっていた作業の再立ち上げに数分かかる
3. **AI 生成タスクの蒸発** — Claude Code の TodoWrite は session 終了で消える、git にも残らない
4. **Portfolio 視点の不在** — 「今日 40+リポのうち何を触るべきか」が即答できない

## 2. Goals

- **G1**: 4以上のソースを横断インデックス化し、ローカル SQLite に統合
- **G2**: タスクを `(repo, agent, prompt, files, context)` を持つ実行可能ユニットとして再定義
- **G3**: タスクから直接 Claude Code / Codex / Gemini を該当 repo で起動可能
- **G4**: セッション終了時の context 退避と、後日のリジューム
- **G5**: ローカルファースト、外部依存は gh CLI と git のみ
- **G6**: 個人作業者向け、40+リポ規模で実用速度を維持

## 3. Non-Goals

- チーム共有・マルチユーザー (将来検討)
- **クラウド同期サービス** (将来検討) ── 自動で third-party service と同期する機能は引き続き範囲外
- ガントチャート / プロジェクト計画機能
- Linear / Jira の置き換え (補完関係)
- iOS / Android ネイティブアプリ

### 3.1 In scope (clarification, #8 / #9 — Magi verdict 2026-05-13)

- **File-based snapshot 往復**: single-user の multi-machine personal use 限定で
  `relay export --json` ↔ `relay import --from relay --json` をサポート。
  G5 (ローカルファースト、外部依存は gh CLI と git のみ) を維持しつつ、
  仕事 Mac / 個人 Mac 等の複数マシン使用パターンに対応する。
- 競合解決は `updated_at` ベースの **last-writer-wins**。CRDT は overkill (Plea ユウ自身の判断と整合)。
- `db.sqlite` の直接共有は引き続き非推奨 (WAL コラプションリスク)。JSON snapshot 経由のみが safe path。

## 4. User Journeys

### J1 — 「昨日の続き」を即座に再開

```
$ relay today
  [1] refscope        api 設計の続き           claude-code  ⏸  yesterday
  [2] devrouter       traefik conf の修正      self         ⏸  2d ago
  ...
$ relay run 1
→ cd ~/repos/github.com/refscope && claude --resume <session-id>
```

### J2 — 横断 today view で優先タスクを選択

```
$ relay today --limit 5
  [1] luna-sns        critical: auth bug       claude-code  🔥 today
  [2] refscope        feat: add filter view    claude-code  ⏰ today
  [3] agent-skills    update README            self         ⏰ today
  [4] devcloud        review PR #12            human-review ⏰ today
  [5] kozu            scrape new sources       claude-code  ⏰ today
```

### J3 — TodoWrite が relay へ自動退避

Claude Code セッション終了時の hook により:
- 最新の TodoWrite 内容を `claude_session_todo` タスクとして登録
- 触っていたファイル一覧、branch、最新 commit SHA を context に保存
- 後日 `relay run <id>` で同じ session を resume

### J4 — 全リポの code TODO を一覧

```
$ relay ls --source code-todo --status open
  [12] refscope     src/api.ts:34       TODO: handle 429
  [13] devcloud     internal/smtp.go:88 FIXME: race on close
  [14] kozu         scraper/meili.py:201 HACK: workaround M1 timeout
  ...
```

### J5 — 手動タスク追加と即実行

```
$ relay add --repo devrouter --agent claude-code \
    --prompt "wildcard cert 対応の調査と PoC"
→ task #42 created
$ relay run 42
→ cd ~/repos/github.com/devrouter && claude 'wildcard cert 対応の調査と PoC'
```

## 5. Data Model

### `tasks` テーブル

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `source_type` | TEXT | `code_todo` \| `github_issue` \| `github_pr` \| `gh_notification` \| `gh_run_failure` \| `gh_project_card` \| `git_interrupted` \| `git_stash` \| `orphan_branch` \| `claude_session_todo` \| `codex_session_todo` \| `gemini_session_todo` \| `cursor_session_todo` \| `agents_note` \| `manual` |
| `source_id` | TEXT | adapter ごとの自然キー (URL, file:line, session_id+index) |
| `repo` | TEXT | repo name (= dir name under `~/repos/github.com/`) |
| `title` | TEXT | 1行サマリ |
| `body` | TEXT | 詳細 (markdown) |
| `status` | TEXT | `open` \| `in_progress` \| `blocked` \| `snoozed` \| `done` |
| `assignee` | TEXT | `claude-code` \| `codex` \| `gemini` \| `self` \| `human-review` |
| `priority` | INTEGER | 0-100, default 50 |
| `prompt` | TEXT NULL | agent 起動時の prompt (manual の場合は必須) |
| `files` | TEXT NULL | JSON array of file paths |
| `context_hash` | TEXT NULL | snapshot ID (後述) |
| `session_id` | TEXT NULL | Claude Code session UUID (resume 用) |
| `due_at` | TEXT NULL | ISO8601 |
| `wait_on` | TEXT | `'self'` \| `'reviewer'` \| `'external'` \| `'scheduled'`、default `'self'`。"今日やる" と "待ち" の二段組で使う。schema_version 2 で追加 |
| `created_at` | TEXT | ISO8601 |
| `updated_at` | TEXT | ISO8601 |
| `closed_at` | TEXT NULL | ISO8601 |

UNIQUE: `(source_type, source_id)` で adapter 再 ingest を冪等化。

`wait_on` 値の意味:

| 値 | 意味 | 典型例 |
|---|---|---|
| `self` | 次の行動は自分 (default) | 自分 assignee の issue、code TODO、claude session todo |
| `reviewer` | コードレビュー待ち | 自分が書いた open PR、レビュー依頼を投げた状態 |
| `external` | 外部関係者待ち | 他者 assignee の issue、サードパーティ問い合わせ中 |
| `scheduled` | 日時/イベント待ち | future #TODO: snoozed タスクで due_at が立っているもの (Web UI からの自動推論は未実装) |

Today 画面は `wait_on='self'` を上段に常に展開、それ以外を下段の折り畳みに表示する。

### `contexts` テーブル (snapshot 保存)

| Column | Type |
|---|---|
| `hash` | TEXT PK |
| `repo` | TEXT |
| `branch` | TEXT |
| `head_sha` | TEXT |
| `dirty_files` | TEXT (JSON) |
| `summary` | TEXT — 「次にやること」要約 |
| `created_at` | TEXT |

### `runs` テーブル (実行履歴)

| Column | Type |
|---|---|
| `id` | INTEGER PK |
| `task_id` | INTEGER FK |
| `agent` | TEXT |
| `started_at` | TEXT |
| `ended_at` | TEXT NULL |
| `status` | TEXT — `running` \| `success` \| `failed` \| `interrupted` |
| `output_summary` | TEXT NULL |

## 6. Source Adapters

| Adapter | 取得元 | 取得頻度 | 取得方法 |
|---|---|---|---|
| `code-todo` | `rg "TODO\|FIXME\|HACK\|XXX"` 全 scan | sync 時 / daemon 5min | ripgrep 直接呼び出し |
| `github-issue` | gh CLI | sync 時 / daemon 15min | `gh issue list --json ...` per owned repo |
| `github-pr` | gh CLI | sync 時 / daemon 5min | `gh pr list --json ...` per owned repo |
| `gh-notification` | gh CLI | sync 時 / daemon 5min | `gh api notifications --paginate` → actionable reason のみ採用 |
| `gh-run-failure` | gh CLI | sync 時 / daemon 5min | `gh run list --status failure` per `github.user`/`github.orgs` repo |
| `gh-project-card` | gh CLI | sync 時 / daemon 5min | `gh api graphql viewer.projectsV2` + per-project `items` query。standalone DraftIssue を unique signal として ingest。default **OFF** (`read:project` scope 必要) |
| `git-interrupted` | `<repo>/.git/{rebase-merge,rebase-apply,MERGE_HEAD,CHERRY_PICK_HEAD,REVERT_HEAD,BISECT_LOG}` | sync 時 / daemon 5min | fs.stat のみ (CLI 不要)、`scan.roots` + `tracked_repos` を 1 段 walk |
| `git-stash` | `git stash list` per repo | sync 時 / daemon 5min | `git stash list --format=...` per repo、`scan.roots` + `tracked_repos` を 1 段 walk |
| `orphan-branch` | `git for-each-ref refs/heads/` per repo + `gh api graphql viewer.pullRequests` 1 sync (page size 100、最大 10 page = 1000 PR) | sync 時 / daemon 5min | local git CLI 全 walk × gh GraphQL 1 query (rate-limit 配慮で per-branch `gh pr list` を避ける) |
| `claude-session` | `~/.claude/projects/**/*.jsonl` | session 終了 hook / daemon 1min | jsonl parser, TodoWrite block 抽出 |
| `cursor-session` | `~/.cursor/plans/*.plan.md` (frontmatter `todos:`) + `~/.cursor/chats/<md5(cwd)>/<agentId>/store.db` | sync 時 / daemon 5min | YAML frontmatter parser + `bun:sqlite` read-only。default **OFF** (privacy) |
| `agents-note` | `<repo>/.agents/*.md` | sync 時 / daemon 5min | checkbox `- [ ]` 行抽出 |
| `manual` | `relay add` | 即時 | CLI (sync 経路では fetch しない — no-op adapter として登録、`precheck` で常に SKIPPED) |

### `code-todo` 詳細仕様

- ripgrep pattern: `^(\s*[#/]+\s*)?(TODO|FIXME|HACK|XXX)(\([^)]*\))?:?\s+(.+)$`
- captures: tag, scope (`(agent)` など), title
- source_id: `${repo}:${file}:${line}:${hash(title)}`
- file 内 line が変動しても title が一致すれば同一タスクと判定

### `claude-session` 詳細仕様

- `~/.claude/projects/<project-hash>/<session-uuid>.jsonl` を tail
- TodoWrite tool_use を発見 → 最新の todos を抽出
- session の cwd から repo を逆引き
- lookback: `[claude_session].lookback_days` (default **7**) 以内に更新された全 jsonl を対象とする (codex/gemini と同等)。これにより同プロジェクトの複数 session が漏れなく ingest される。
- source_id:
  - TaskCreate 系: `${session_uuid}:tc-${counter}` (`counter` は 1 起点の単調増加整数)
  - TodoWrite 系: `${session_uuid}:tw-${todo_id}` (`todo_id` は TodoWrite ペイロードの `id` フィールド)
  - 同一 session 内で両系統が混在しても `tc-` / `tw-` prefix で衝突しない

### `cursor-session` 詳細仕様

Cursor (VSCode fork、`~/.cursor/`) が disk に書く AI 計画 / chat の中で、
**plan ファイルだけ**が構造化された todo を expose する。本 adapter は
それを primary 取得元とし、chat 側 (proto-encoded blob で extract 不可)
は metadata だけを optional に拾う。Cursor 内部 format は無告知で変わる
ことを前提に、parser は失敗時に「該当 entry を skip」で抜けるよう
defensive に書く。

- 取得元:
  - **primary (構造化、todo 単位で ingest)**:
    `~/.cursor/plans/<name>_<hash8>.plan.md` — Markdown + YAML frontmatter。
    Cursor の "Agent Plan" feature が書き出すファイル。frontmatter に
    `name`, `overview`, `todos: [{id, content, status}]` を持ち、`status` は
    `pending` / `in_progress` / `completed` の 3 値が観測されている
    (他値は `pending` 扱いに正規化)。
  - **secondary (optional、chat 単位で 1 task)**:
    `~/.cursor/chats/<md5(cwd)>/<agentId>/store.db` (SQLite)。`meta` table の
    `value` 列は hex-encoded JSON `{agentId, latestRootBlobId, name, mode,
    createdAt, lastUsedModel}`。`name` を chat title、`mode` を補足情報として
    使う。`blobs` table 側は proto-encoded Merkle DAG なので todo 抽出は
    **断念**、metadata だけ採用する。`[cursor_session].store_body = true`
    の時のみ ingest。
- 認証: 不要 (ローカル file のみ、ネットワーク呼び出しゼロ)。
- repo 解決:
  - chat directory 名は `md5(absolute project cwd)` の hex。`scan.roots`
    1 段 + 2 段 readdir で候補 cwd を生成 → 各 md5 を計算 → 一致した hash の
    cwd を採用 → 既存 `resolveRepoForCwd` (`.git` walk-up) で repo 名へ。
    `gemini-session` の sha256(cwd) → projects.json 逆引きと同じ pattern。
  - plan ファイルは cwd 情報を持たないため、`~/.cursor/chats/` の中で
    md5 が逆引き可能な workspace のうち最も mtime が新しいものに bind する
    (heuristic、Cursor が plan ↔ workspace の永続 link を expose しない
    ための妥協)。これにより複数 repo を行き来する power user では plan
    todo が "直近触った repo" に集約される。誤 bind を疑う場合は
    `[adapters].cursor_session = false` で adapter を切る or
    `relay close` で個別に消す運用。
- source_id 形式:
  - plan todo: `cursor:plan:${plan_id}:${todo_id}` (`plan_id` = ファイル名
    から `.plan.md` を除いた stem、例 `画像フル幅表示_4f0a3f28`)。Cursor は
    plan ファイルを内容変更時に同名で上書きするので、`plan_id + todo_id`
    の組は disk 上の todo の一意 anchor として安定。
  - chat meta: `cursor:chat:${agentId}` (`agentId` は UUID、`meta.value` の
    JSON で抽出)。1 chat 1 task。
- title:
  - plan todo: `content` を 120 文字で truncate (末尾 `…`)。
  - chat meta: `meta.name` を 120 文字で truncate。`name` が空なら
    `(unnamed Cursor chat)` で fallback。
- body:
  - default OFF。`[cursor_session].store_body = true` の時のみ:
    - plan todo: `From Cursor plan ${plan_id} (status: ${status}).` +
      plan `name` / `overview` の 2 行を続ける。
    - chat meta: `From Cursor chat ${agentId} (mode: ${mode}, cwd: ${cwd}).`
- assignee: `self` 固定。Cursor は IDE 内で起動するエージェントなので
  relay 側から `claude-code` / `codex` / `gemini` のように再起動できる
  単一プロセス・パスを持たない。次の action は人間判断。
- priority:
  - plan todo: 55 (`codex_session` / `gemini_session` と同 band)。
  - chat meta: 50 (plan より一段低い、未整理 chat なので)。
- wait_on: `self` 固定。
- precheck:
  - `~/.cursor/` 不在で `"~/.cursor/ not found (Cursor not installed?)"`
    SKIPPED。
  - `~/.cursor/plans/` も `~/.cursor/chats/` も無ければ `"~/.cursor/ has
    neither plans/ nor chats/"` SKIPPED。`ai-tracking/` や `projects/`
    だけが有るケースでも、todo 抽出側は何も出せないので skip 扱い。
- fetchResolved: plan todo のうち現在 `status === "completed"` のものを
  `source_id` として返す。`autoCloseResolvedRemoteTasks` 経由で対応 task が
  done になる。chat meta 側には終了 marker が disk 上に出ないため
  resolved は emit しない (`relay close` 任せ)。
- lookback: `[cursor_session].lookback_days` (default **14**、codex/gemini の 7
  より長い)。Cursor plan は手動で消すまで disk に残るので、tighter window でも
  毎 sync で月単位の古い todo が浮上する。`mtime` で plan を、`createdAt`
  で chat を切る。
- privacy default:
  - `[adapters].cursor_session = false` (adapter 全体が opt-in)。Cursor chat
    sqlite は user prompt を proto-encoded で抱えるため、relay の DB 行に
    metadata 経由で chat title (= しばしば prompt 1 行目) が流入することを
    回避する第一防波堤。
  - `[cursor_session].store_body = false` (chat meta 取り込み + plan body の
    第二防波堤)。store_body OFF だと plan todo の title だけが ingest される
    実質「Cursor の TODO list view」だけが見えるモードで動く。
- 静的 skip / 防御:
  - plan frontmatter parser は自前の minimal YAML reader (top-level scalar +
    `todos:` リストのみ)。新 field 追加に対しては「知らない key は無視」で
    open に降伏する。完全な YAML 構文崩壊時は `null` を返して該当 plan を
    skip。
  - chat sqlite open は `bun:sqlite` を **dynamic import** し、`meta.value`
    が hex でなければ / JSON parse 失敗なら / `agentId` 欠落なら、その agent
    を黙って skip。Cursor が schema を 1, 2 (`meta`, `blobs`) のままに保つ
    限り動き、column 追加には影響しない。
  - exclude patterns (`[cursor_session].exclude_patterns`, default `[]`) は
    plan ファイルパス / `store.db` パスに対して regex で match → skip。
    特定 workspace を sweep から外したい場合に使う。
- 書き込み禁止: `~/.cursor/` 配下への書き込みは一切行わない。plan の
  状態変更 (`completed` → `in_progress` 戻し等) は Cursor UI に委ねる。
- format-change risk: Cursor は internal data format を release note 無しで
  変更してきた歴がある。adapter は「parser が失敗したら entry を捨てる」
  defensive 姿勢を取るので、format breakage 時は **「task が増えない」** の
  形で観測される (誤ったデータ ingest は起きない)。`relay sync --source
  cursor_session_todo` の結果が突然 0 件になったら、ファイル形式を再
  inspect して adapter を更新する trigger とする。

### `gh-notification` 詳細仕様

`gh api notifications --paginate` で notifications inbox を取り込み、レビュー依頼
/ mention / assign / CI failure / state change の 5 種だけ task 化する adapter。
`github-issue` / `github-pr` が「自分が assignee / author の open item」を
ingest するのに対し、こちらは **inbox 側 = 他者から発火された通知**を補完する。

- 取得元: `gh api --paginate "notifications?per_page=100&all=true&since=<30 日前>"`。
  GitHub Notifications API の thread リスト。`since` で 30 日前以降に更新された
  thread に限定して volume を抑える。
- source_id: `gh:notification:${notification.id}` (thread ID は GitHub 側で固定)
- title: `[${reason}] ${subject.title}` (例: `[review_requested] feat: add filter view`)
- body: `${subject.url}` のみ。コメント本文や CI ログの取り込みは将来 issue で
  opt-in する想定で、現状は trace 用 URL のみ保存する。
- repo: `repository.name` を優先、欠落時は `subject.url` を
  `/repos/[^/]+/([^/]+)/...` regex で解析。bare repo 名のみ保存
  (既存 `github-issue` / `github-pr` と整合)。
- assignee: `self` 固定 (notifications は本人宛なので機械振り分けの対象外)
- priority: `ci_activity` 70 / `review_requested` 60 / `mention` 55 /
  `assign` `state_change` 50
- wait_on: `self` 固定
- 対象 reason: `review_requested` / `mention` / `assign` / `ci_activity` /
  `state_change`。これ以外 (`subscribed` / `comment` / `author` など) は noise
  扱いで drop する。
- precheck: `gh auth status` の exit code を確認。0 以外 (= 未ログイン) なら
  `"gh CLI not authenticated"` で SKIPPED。
- fetchResolved: 同じ `gh api notifications` 結果から `unread === false` かつ
  `updated_at` が 7 日以上前の thread を集めて `source_id` を返す。
  `autoCloseResolvedRemoteTasks` 経由で対応 task が done になる。
- 書き込み禁止: `PATCH /notifications/threads/{id}` (mark-as-read) は呼ばない。
  read 状態の変更は GitHub UI / 他クライアント側に委ねる。

### `gh-run-failure` 詳細仕様

`gh run list --status failure` 経由で、自分が owner / member の repo で
現在失敗中の workflow run を inbox 化する adapter。`gh-notification` の
`ci_activity` reason が「失敗通知が来た瞬間」の trigger なのに対し、こちらは
「今この瞬間 failing 中」という current state を取り続けるので、長期 stale
failure (通知を消化したが直していない workflow) を取りこぼさない。

- 取得元:
  1. repo 列挙: 各 `github.user` / `github.orgs[]` に対し
     `gh repo list <owner> --json name,defaultBranchRef --limit 200`。
     owner 外の third-party fork は走査しない (自分の責任範囲外)。
  2. failure 取得: 各 repo で
     `gh run list --repo <owner>/<repo> --status failure --limit 20
       --json databaseId,name,headBranch,headSha,event,conclusion,updatedAt,url`。
- source_id: `${repo}:gh-run:${workflow_name}:${head_branch}`。run id ではなく
  workflow + branch の組で一意化することで、同一 workflow の連続失敗が 1 task
  に集約される (最新 run の `updated_at` で上書き)。
- title: `CI failing: ${workflow_name} on ${repo}@${head_branch}`
- body: default は metadata 行のみ
  (`run: <url>` / `event: ...` / `sha: ...` / `updated_at: ...`)。
  `[gh_run_failure].store_body = true` (opt-in) の場合のみ
  `gh run view <id> --log-failed` を追加で呼び、最大 **8 KB**
  (UTF-8 byte 計測) で truncate して body 末尾に付与する。長 log の取り込みを
  default OFF にするのは (a) gh API rate-limit (失敗 run × 1 call 増)、
  (b) log に secret/path 等が含まれるリスク、の 2 点による。
- repo: 列挙時の `name` (bare repo 名)
- assignee: `self` 固定
- priority: default branch (`defaultBranchRef.name` または fallback で
  `main`/`master`) なら 80、それ以外 (PR / topic / release branch) なら 65。
  `updated_at` が 3 日以上前なら +10 (stale boost)。上限 100、下限 0。
- wait_on: `self` 固定 (自分の CI を直すのは自分)
- precheck: `gh auth status` exit 0 を確認、かつ `github.user` または
  `github.orgs` の少なくとも一方が定義されていることを確認。どちらも欠落して
  いれば `"github.user / github.orgs not configured"` で SKIPPED。
- fetchResolved: 同じ repo 集合に対して `--status success` を追加 sweep し、
  `(workflow_name, head_branch)` ごとに最新 success の `updated_at` と
  最新 failure の `updated_at` を比較する。success の方が新しければ resolved
  対象として `source_id` を返し、`autoCloseResolvedRemoteTasks` 経由で対応
  task が done になる。failure の方が新しい場合 (修正後に再び red になった)
  は open のまま保持する。
- 書き込み禁止: `gh run rerun` / `gh run cancel` 等の状態変更は一切呼ばない。
  status は GitHub UI / CI 側に委ねる。

### `gh-project-card` 詳細仕様

GitHub Project v2 (ユーザ / 組織配下の Projects ボード) の **items**
(= ボード上の各カード) を取り込む adapter。`github-issue` / `github-pr`
が「Issue / PR backed のカード」を別 source として既に拾っているのに対し、
本 adapter の **unique signal は standalone DraftIssue card** (ボードに
直接書いた、対応する GitHub Issue を持たないメモ)。ProjectV2 を運用する
power user が「ボードには書いたが Issue 化していない着想」を完全に
忘却する失敗モードを救う。

default **OFF** (`[adapters].gh_project_card = false`)。理由は 2 点:
1. Issue/PR backed のカードは既に `github-issue` / `github-pr` で
   ingest 済 (UNIQUE(source_type, source_id) で別行として重複登録される
   が、URL は別なので衝突しない)。ProjectV2 を使わないユーザにとっては
   noise になる。
2. `projectsV2` query に必要な `read:project` (or `project`) scope が
   `gh` の標準 token に含まれないため、デフォルト ON にすると毎 sync で
   skip エラーが出続けることになる。

- 取得元 (2 段、GraphQL のみ):
  1. **project 列挙**: `gh api graphql viewer.projectsV2(first: 20, after: $cursor) { nodes { id title number } pageInfo { hasNextPage endCursor } }`
     を最大 5 page (= 100 project) まで pagination。個人 / 組織 ボードを
     横断列挙する。
  2. **per-project item 取得**: 各 project の `node(id: $projectId) { ... on ProjectV2 { items(first: 100, after: $cursor) { nodes { id content { __typename ... } fieldValues(first: 20) { nodes { ... } } } pageInfo { ... } } } }`
     を最大 10 page (= 1000 item / project) まで pagination。
- 認証: `gh auth status` exit 0 + token scope に `project` または
  `read:project` のいずれかが含まれていること (precheck で確認)。
- repo 解決:
  - card content が `Issue` / `PullRequest` → `repository.name` (bare
    repo 名、既存 `github-issue` 等と整合)。
  - card content が `DraftIssue` (standalone note) →
    `[github].project_v2.fallback_repo` (default `"__inbox__"`)。
    `repo TEXT NOT NULL` 制約を満たすため必ず非空。`__inbox__` sentinel
    は disk 上に実在しない repo 名で、`relay run` 経由で agent を起動
    しようとすると path 不在 warning が出る (期待通り — DraftIssue は
    まだ Issue 化されていないので run 対象ではない)。inbox repo を
    実運用している user は `fallback_repo = "inbox"` 等で repoint 可能。
- source_id: `gh:project:${project_node_id}:item:${item_node_id}`。
  GitHub の internal node ID は rename / move に対して安定なので、
  card を別 column に動かしても source_id は不変 (同 task に Status
  field の更新が反映されるだけ)。
- title:
  - Issue / PullRequest backed: card content の `title`。
  - DraftIssue: `title` を採用。空なら body 先頭行で fallback。
    両方空なら **silent skip** (rare、AC 通り)。
  - 120 文字で truncate (末尾 `…`)。
- body: 常に metadata 行を含む (`project: ${project_title} (#${number})` /
  `issue: ${url}` または `pr: ${url}` または `type: draft_issue` /
  `status: ${status_value}` / `priority: ${priority_value}` /
  `date: ${date_field}` / `assignees: login1, login2`)。DraftIssue の
  `body` が non-empty なら 4000 文字で truncate して追記する。
- custom field 読み込み (case-insensitive で field name match):
  - `Status` (single-select): `In Progress` / `Doing` / `In Review` /
    `Active` → relay `status: "in_progress"`。それ以外 → `open`。
    `[gh_project_card].done_statuses` (default `["Done", "Completed",
    "Closed", "Shipped"]`) に case-insensitive で match → `fetchResolved`
    で resolved として返却 → `autoCloseResolvedRemoteTasks` 経由で done。
  - `Priority` (single-select): `P0` / `urgent` / `critical` → 90、
    `P1` / `high` → 75、`P2` / `medium` / `normal` → 50、`P3` / `low`
    → 35、`P4` → 25。未知の値は 50 で fallback。
  - 最初の `Date`-kind field (field name 不問) → `due_at` に転写。
    `Due date` / `Target` / `Ship date` 等 project 固有名でも汎用に動く。
  - `Assignees` (user field): login 列を body に列挙。adapter 側の
    `assignee` 列は `self` 固定 — ProjectV2 は IDE エージェント launcher
    と紐付かないので意味的に `self`。
- assignee: `self` 固定。
- priority: 上記 `Priority` field 由来。未設定なら 50。
- wait_on:
  - `Status` field に `Waiting` / `Blocked` / `On hold` が含まれる →
    `external`。
  - それ以外 → `self`。
- due_at: `Date`-kind field があれば。なければ null。
- precheck:
  1. `gh auth status` exit 0 確認。失敗で `"gh CLI not authenticated"`
     SKIPPED。
  2. `gh auth status` の出力 (stdout + stderr 連結) に `'project'` または
     `'read:project'` が含まれているか確認。無ければ
     `"gh token missing 'project' scope — run \`gh auth refresh -h github.com -s project\` (or \`-s read:project\`)"`
     で SKIPPED。これにより「`gh_project_card = true` だが scope 未付与」
     という最頻ハマりポイントを skip メッセージで即解決できる。
- fetchResolved: 同じ全 project / 全 item を 1 度再 sweep し、
  `Status` field 値が `done_statuses` の何れかに case-insensitive で
  match する item の source_id を返す。`autoCloseResolvedRemoteTasks`
  経由で task が done になる (undo 可)。projectV2 内で資源を消費する
  query が 2 回走るが、`fetch` 側と同じデータなので将来的に cache を
  挟む余地がある (#TODO(agent): single-pass sweep, two emissions)。
- 縮退動作: GraphQL 呼び出しが任意の段階で失敗した場合 (rate-limit /
  network / 突発的な scope 失効) は空配列を返し、その sync で `gh_project_card`
  は inserted=0 / updated=0。silent failure ではなく `ctx.log` 経由で
  「`gh_project_card: graphql ... failed`」を残すので、`relay sync` の
  console / Web sync drawer から異常を視認できる。
- `__inbox__` sentinel と他系統への影響:
  - relay の他 API / UI で `repo === "__inbox__"` を special-case しない。
    repo stats list / task list / sidebar の repo filter で普通の repo 名
    として扱われる。差異は「fs 上に `~/repos/github.com/__inbox__/`
    が存在しないので `relay run` 等の launcher 系で path 解決が失敗する」
    一点だけで、これは `autoCloseMissingRepoTasks` (sync.ts) と整合 ──
    ただし `__inbox__` 専用 task は `gh_project_card` adapter が再 ingest
    する限り auto-close 対象ではなく、`closeMissingRepoTasks` の方は
    "DB に repo row があるが disk に無い" tasks を閉じる側なので、
    standalone DraftIssue task が誤って閉じられる事は無い (`__inbox__`
    に対しては fs check が走らないため、task は open のまま残る)。
  - 実運用上ユーザが「inbox」を別の文字列 (例 `"inbox"` / `"__draft__"`)
    にしたい場合は `[github].project_v2.fallback_repo` を上書きする。
- 書き込み禁止: `updateProjectV2ItemFieldValue` / `addProjectV2ItemById`
  等の mutation は一切呼ばない。card の status 変更は GitHub UI / 他
  クライアントに委ねる (relay は read-only ingest)。

### `git-interrupted` 詳細仕様

`<repo>/.git/` 配下の中断状態 sentinel を全 repo 横断で stat し、
進行中で放置されている rebase / merge / cherry-pick / revert / bisect を
inbox 化する adapter。`code-todo` も `agents-note` もこの状態は拾えず、
40 repo 横断開発で「別 repo に切り替わって中断 rebase を完全に忘却」する
失敗モードを救う。CLI 呼び出しは行わず純 file stat なので外部依存ゼロ。

- 取得元: 各 repo の `.git/` 配下にある 6 種の sentinel を fs.stat する。
  | kind          | sentinel (`<repo>/.git/` 配下) | 種別 |
  |---------------|-------------------------------|------|
  | `rebase-merge`| `rebase-merge/`               | dir  |
  | `rebase-apply`| `rebase-apply/`               | dir  |
  | `merge`       | `MERGE_HEAD`                  | file |
  | `cherry-pick` | `CHERRY_PICK_HEAD`            | file |
  | `revert`      | `REVERT_HEAD`                 | file |
  | `bisect`      | `BISECT_LOG`                  | file |
- repo 列挙: `scan.roots` を 1 段だけ readdir し、各子ディレクトリ直下に
  `.git` があるものを候補にする (relay の標準 layout
  `<root>/<repo>` に最適化)。`scan.tracked_repos` の絶対パスも追加で
  チェックして、`scan.roots` 外に pin された repo も拾う。
- source_id: `${repo}:git-state:${kind}` (kind は上表の slug)。
  同一 repo × 同一 kind で必ず一意。run id / HEAD sha など不安定な値は
  使わないので、`git rebase --continue` を挟んでも source_id は不変。
- title: `Interrupted ${kind} in ${repo} (${days_since}d ago)`
- body: kind ごとに最も情報量の多い artefact を 5 行抜粋で添える。
  - `rebase-merge` / `rebase-apply` → `<sentinel>/todo` の先頭 5 行
    (残り step が見える)
  - `merge` → `.git/MERGE_MSG` の先頭 5 行 (commit message 草案)
  - `cherry-pick` / `revert` → `<sentinel>` の中身 (12 文字 short SHA)
  - `bisect` → `BISECT_LOG` の末尾 5 行 (これまでの good/bad 履歴)
  - 取得失敗時は sentinel の path のみ
- repo: `basename(repoDir)` (bare repo 名、`github-issue` 系と整合)
- assignee: `self` 固定 (`--continue` / `--abort` は人間判断)
- priority: `75 - days_since × 5`、下限 50 / 上限 100。新鮮 (0 日) で
  75、5 日経過で下限 50 に張り付く。`gh-run-failure` default-branch
  (80) より少し低く、`gh-notification` mention (55) より高い帯。
- wait_on: `self` 固定
- due_at: なし
- precheck: `scan.roots` を順に 1 段 readdir し、いずれかの子ディレクトリ
  直下に `.git` を発見できれば PASS。1 つも見つからなければ
  `"no .git directories found under scan.roots"` で SKIPPED。
- fetchResolved: 同じ walk を行い、6 種の sentinel のうち今は存在しない
  kind を `source_id` として返す。`autoCloseResolvedRemoteTasks` 側は
  存在しない source_id を無視するので、過去 ingest した task のみ
  自動 close される (undo 可)。`git rebase --continue` で sentinel が
  消えた瞬間に次回 sync で done になる。
- 書き込み禁止: `.git/` 配下への書き込みは一切行わない。
  rebase / merge / cherry-pick の解消は人間の判断に委ねる。

### `git-stash` 詳細仕様

各 repo の `git stash list` を sweep して、死蔵 WIP (= push しただけで pop し忘れた
stash) を inbox 化する adapter。`git-interrupted` が `.git/` 配下の sentinel で
「中断 rebase / merge」を救うのに対し、こちらは「とりあえず stash で逃がした WIP」
を救う。40 repo 横断開発で「2 週間前に luna-sns で stash した変更」を完全に
忘却する失敗モードを防ぐ。`code-todo` は file 内 TODO しか拾わないので、
未 commit のメンタル TODO はこの adapter が無いと relay の視界外。

- 取得元: 各 repo で `git stash list --format='%gd|%ai|%H|%s'` を spawn。
  - `%gd` = reflog selector (例 `stash@{0}`) — 不安定、body の表示用のみ
  - `%ai` = author ISO 8601 (`2026-05-13 14:22:31 +0900`) — age 計算用
  - `%H`  = full oid (40 文字 sha) — source_id の安定 anchor
  - `%s`  = stash subject (message 1 行目)
  - subject に `|` が含まれる場合は最初の 3 つの `|` までを field separator と
    して扱い、4 番目以降は subject の一部とする (Python `str.split(sep, 3)` 相当)。
- 認証: 不要 (ローカル `git` のみ、ネットワーク呼び出しゼロ)。
- repo 列挙: `scan.roots` を 1 段 readdir + `.git` 存在チェック + `tracked_repos`
  絶対パスを合わせて Set で dedupe (`git-interrupted` と同じパターン)。
- source_id: `${repo}:stash:${short_oid}` (oid 先頭 8 文字)。stash の oid は
  内容で決まるので、`git stash push` / `pop` で `stash@{0}` 番号が動いても
  oid 同一の間は同じ task。同名 stash でも oid が違えば別 task として扱う。
- title: `Stashed WIP in ${repo}: ${subject}` を 100 文字で truncate
  (末尾に `…` を付加)。
- body: 常に `stash: <selector> (oid <short12>)` / `age: <Nd>` /
  `repo: <repo>` の 3 行 metadata を含む。`[git_stash].store_body = true`
  (opt-in、**default OFF**) の場合のみ `git stash show --stat <oid>` の出力を
  fenced code block で append する。`-p` patch は **取らない** (SQLite 行が
  肥大化するうえ、stash 内に secret が含まれる可能性があるため stat のみに
  限定する)。
- repo: `basename(repoDir)` (bare repo 名、`github-issue` 系と整合)。
- assignee: `self` 固定 (人が WIP に向き直す対象)。
- priority: `70 - age_days × 1`、下限 40 / 上限 100。新鮮 (0 日) で 70、
  30 日経過で下限 40。`git-interrupted` 新鮮 (75) より少し低い帯で、
  「中断 rebase」より「忘れ stash」の方が緊急度が一段低いという扱い。
- wait_on: `self` 固定。
- due_at: なし。
- precheck:
  1. `git --version` を spawnSync して exit code 0 を確認。失敗 (PATH に
     `git` 無し / 実行不能) なら `"git CLI not found in PATH"` で SKIPPED。
  2. `scan.roots` を順に 1 段 readdir し `.git` を 1 つも検出できず、
     `tracked_repos` 側にも `.git` 持ちのパスが無ければ
     `"no .git directories found under scan.roots"` で SKIPPED。
- 静的 skip: stash 0 件の repo は fetch 段階で task 生成自体をスキップ
  (`entries.length === 0` 直 early-continue)。
- 並列化: per-repo の `git stash list` 呼び出しは `Promise.all` で並列実行。
  目標は 1 repo あたり 50 ms 以下、40 repo 全体で `relay sync` の現行
  performance budget (5s) を圧迫しない。
- subprocess time-bound: `git stash show --stat` の 1 呼び出しあたり
  300 ms の hard timeout、全体で累積 30 s の budget を消費したら以後の
  body fetch を skip (= body は metadata のみ)。`SIGKILL` で確実に終了。
- 環境変数: `GIT_TERMINAL_PROMPT=0` を強制設定し credential helper /
  ssh passphrase の対話を抑止 (corrupt repo がプロンプトを出して sweep を
  止めてしまうことを防ぐ)。
- fetchResolved: 現時点で `git stash list` に存在する oid 集合 vs DB が
  open として保持する `git_stash` source_id 集合の差分を resolved として
  返す。すなわち「前回 sync で見えていた oid が今回見えない (pop/drop された)」
  → 自動 done。DB-side の open source_id を取得するため、新規に
  `AdapterContext.knownOpenSourceIds(sourceType)` callback を導入し、
  sync.ts から `RelayDB.listOpenSourceIdsByType` を bind して提供する。
  test harness 等で callback が未供給の場合は no-op (現在 stash の ingest
  のみ動き、自動 close は手動 `relay close` 任せ)。
- 書き込み禁止: `git stash push` / `pop` / `drop` 等の状態変更は一切呼ばない。
  stash の解消は人間の判断 (`relay run` でエージェントを起動する場合も
  ユーザー操作経由)。

### `orphan-branch` 詳細仕様

`feat/*` / `fix/*` で複数 commit を積み、`git push -u` で push したのに
PR を立て忘れた branch を全 repo 横断で発掘する adapter。`github-pr` は
"PR が存在する前提" なので PR 化されていない work を取りこぼし、
`code-todo` は file 内マーカーしか拾わないので「完成寸前で PR 手前に
死蔵されている commit」は relay の視界から完全に消える。本 adapter は
その unique signal を inbox 化する。`git-stash` (未 commit WIP) と
`git-interrupted` (中断状態) と合わせて 3 種の "見えない WIP" を救う
3 兄弟の最後の 1 つ。

- 取得元 (2 段構成、rate-limit が最大の設計制約):
  1. **PR map (1 sync で 1 query、最大 10 page)**: `gh api graphql` で
     `viewer.pullRequests(first: 100, after: $cursor, states: [OPEN, CLOSED, MERGED], orderBy: {field: UPDATED_AT, direction: DESC}) { pageInfo { hasNextPage endCursor } nodes { url state headRefName repository { name } } }`
     を呼び、`endCursor` で 100 件 × 最大 10 page = 1000 PR まで pagination。
     ユーザの authored PR 全集合を `${repo}/${headRefName}` キーの Map に
     格納する。`gh search prs --json headRefName` は **使えない** — search
     API は headRefName を露出していない (`Unknown JSON field` エラー)。
     1000+ PR を持つ power user は古い closed PR が roll off するが、
     shipped 済の branch を取りこぼすだけなので実害なし。
     `gh pr list --head <branch>` を per-branch で呼ぶ素朴な実装だと
     40 repo × 5 branch = 200 call/sync になり secondary rate-limit を
     踏むため**禁止**。
  2. **branch 列挙 (per repo、local のみ)**: 各 repo で
     `git for-each-ref refs/heads/ --format='%(refname:short)|%(committerdate:iso8601)|%(upstream:short)|%(objectname:short)'`
     を spawn。network call ゼロ、`Promise.all` で並列実行。
- 認証: `gh auth status` exit 0 + `git --version` exit 0 が必要 (precheck)。
- repo 列挙: `scan.roots` を 1 段 readdir + `.git` 存在チェック +
  `tracked_repos` 絶対パス、Set で dedupe (`git-stash` / `git-interrupted`
  と同じパターン)。
- default branch 検出: 2 段 fallback。
  1. `git symbolic-ref --short refs/remotes/origin/HEAD` (=
     `git remote set-head origin --auto` 後の通常 case)。
  2. 失敗時は `git rev-parse --abbrev-ref origin/HEAD`。
  両方失敗 (origin remote 未設定 / fetch 未済) なら `null` を返し、
  default branch filter は no-op に縮退、`ahead` も `null` で記録する。
  prefix `origin/` は両 case で除去して bare branch 名で比較する。
- branch 判定: 以下 5 つの filter を順に通り抜けたものを orphan と判定。
  1. branch == default branch → skip (master / main は orphan ではない)
  2. `upstream:short` が空 → skip (push されていない local-only WIP)
  3. `[orphan_branch].exclude_patterns` (default `["release/*", "hotfix/*"]`)
     に match → skip。`prefix/*` (startsWith) と完全一致のみ対応、glob
     library は導入しない (dependency-light な方針)。
  4. `age_days < 1` → skip。今日 push したばかりの branch を即「orphan」と
     扱うのは早すぎるので 1 日の grace を設ける。
  5. PR map に `${repo}/${branch}` が hit → state を問わず skip。
     `state === 'open'` (= 既に review 中) と `closed` / `merged`
     (= 片付いた、または意識的に放棄) の両方を除外する。一度 PR 化
     された branch を数週間後にもう一度 inbox に上げ直すのは noise。
- source_id: `${repo}:orphan-branch:${branch}:${tip_short_sha}`。
  tip short SHA を含めることで、`git commit --amend` / `git rebase`
  で tip が動いた場合は別 task として登録され、古い task は次回
  sync の `fetchResolved` で自動 close される。
- title: `Orphan: ${branch} (+${ahead} commits ahead of ${base})`。
  `ahead` は `git rev-list --count ${base}..${branch}` で取得。
  default branch が検出できない場合は ahead 計算を skip し、
  `Orphan: ${branch}` のみの形式に縮退する。`commit` / `commits` の
  単複は ahead == 1 で切り替える。
- body: 常に metadata を含む (`branch:` / `tip:` / `upstream:` /
  `base:` / `ahead:` / `age:` / `repo:`)。`[orphan_branch].store_body = true`
  (opt-in、**default OFF**) の場合のみ
  `git log --oneline --no-merges --max-count=20 ${base}..${branch}`
  を fenced code block で append。commit message に secret や internal
  identifier が含まれる可能性があるため default OFF。
- repo: `basename(repoDir)` (bare repo 名、`github-issue` 系と整合)。
- assignee: `self` 固定 (PR 化判断は人間)。
- priority: `65 - age_days × 2`、下限 40 / 上限 100。新鮮 (0 日 →
  filter 4 で skip されるが境界値 1 日) で 63、12 日経過で下限 40 に
  張り付く。`git-stash` 新鮮 (70) より少し低い帯で、「stash 忘れ」
  より「PR 立て忘れ」の方がやや軽い扱い (commit 済なので失われは
  しない)。
- wait_on: `self` 固定。
- due_at: なし。
- precheck:
  1. `git --version` exit 0 確認。失敗で `"git CLI not found in PATH"`
     SKIPPED。
  2. `gh auth status` exit 0 確認。失敗で `"gh CLI not authenticated"`
     SKIPPED。PR map fetch が必須なので gh が無いと正しく分類できない。
  3. `scan.roots` 1 段 readdir + `tracked_repos` で `.git` 持ちパスが
     1 つもなければ `"no .git directories found under scan.roots"`
     SKIPPED。
- 並列化: `gh search prs` 1 call と per-repo の `git for-each-ref` を
  `Promise.all` で並列実行。`git` subprocess は 1 呼び出しあたり
  1500 ms の hard timeout、`GIT_TERMINAL_PROMPT=0` を強制設定し
  credential helper / ssh passphrase の対話を抑止。
- 縮退動作: `gh api graphql` が失敗した場合 (rate-limit / network /
  auth glitch) は空 Map を返す (途中で失敗した場合は取れた分のみ保持)。
  空 Map では filter 5 で全 branch が通り抜けて「filter 1-4 を通った
  全 branch を orphan として report」に縮退する。silent failure では
  なく明示的な "more orphans than usual" alert として機能するので、
  user が PR API 不調を検知できる。
- fetchResolved: 現時点で orphan 条件を満たす source_id 集合 vs DB の
  open `orphan_branch` source_id 集合の差分を resolved として返す。
  branch 削除 / PR 化 / tip 移動 (rebase/amend で source_id 別物化)
  の 3 ケースが全て自動 done になる。`AdapterContext.knownOpenSourceIds`
  が未供給の場合は no-op (test harness 等)。
- 書き込み禁止: `git push --delete` / `gh pr create` 等の状態変更は
  一切呼ばない。PR 化 / branch 削除は人間判断 (`relay run` 経由で
  agent を起動した場合もユーザー操作)。

### `github-issue` / `github-pr` の `wait_on` 推定 (schema_version 2)

`gh search` の `--json assignees,author,state` を見て、各 row の `wait_on`
を以下のルールで決定する。複数 sweep で同じ URL が来た場合は
`self > reviewer > scheduled > external` の優先順位で上書きする (どれか一つでも
"自分待ち" のシグナルがあれば self を採用する)。

1. `assignees[].login` に `github.user` が含まれる → `wait_on = 'self'`
   (自分 assignee。誰が author でも次の行動は自分)
2. `source_type = 'github_pr'` かつ `author.login = github.user` かつ
   1 が成立しない → `wait_on = 'reviewer'`
   (自分が書いた open PR で、自分は assignee ではない = レビュー待ち)
3. それ以外 → `wait_on = 'external'`
   (org owner sweep で拾った他者の PR / issue、third-party assignee の issue 等)

merged/closed PR は `--state open` フィルタで外れるため、上記の判定対象には
ならない。merged 確定後は `fetchResolved()` が拾い、sync が自動で done に閉じる。

## 7. CLI

実装は `src/cli.ts` (commander) — 早見表は `CHEATSHEET.md` を参照。

### Setup / Diagnostics

| Command | 説明 |
|---|---|
| `relay init [--force]` | `~/.relay/{db.sqlite, config.toml}` 作成、schema 適用 |
| `relay setup [--force] [--skip-install] [--skip-build]` | root + `web/nextjs` の deps インストール & Web UI ビルドを冪等に一括実行 |
| `relay quickstart [--no-sync]` | 初回 init + sync + today をワンショット |
| `relay doctor [--strict]` | `rg / gh / claude / codex / gemini / git` 検出 |

### Ingest

| Command | 説明 |
|---|---|
| `relay sync [--source X] [--dry-run] [--resume]` | 全アダプタ ingest (SSE 進捗)。`--resume` で 1 時間以内に完了済みをスキップ |
| `relay backfill [--list] [--dry-run] [--only X]` | 冪等な後方互換 fixup |

### Views

| Command | 説明 |
|---|---|
| `relay today [-n N]` | 今日触るべき N 項目 (`wait_on='self'` 優先) |
| `relay agenda [--days 7\|14\|30]` | 期日 / scheduled カレンダー + Overdue |
| `relay standup [--since 24h\|48h\|7d\|14d\|30d]` | 昨日の close + 今日の自走 + ブロッカー |
| `relay digest [--since 7d] [--out PATH] [--format md\|json]` | 区間サマリ |
| `relay ls [--repo X] [--source Y] [--status Z] [--agent W] [-n N]` | フィルタ一覧 |
| `relay show <id>` | タスク詳細 |
| `relay watch <repo> [--interval 5s\|10s\|30s\|1m]` | repo の更新を tail |

### Lifecycle

| Command | 説明 |
|---|---|
| `relay add [--repo X --title ... --assignee A --prompt ... --files a,b --due YYYY-MM-DD --priority N --body ...]` | 手動追加 (引数省略で interactive) |
| `relay assign <id> <agent>` | 担当変更 (`claude-code` / `codex` / `gemini` / `self` / `human-review`) |
| `relay close <id>` / `relay snooze <id>` / `relay reopen <id>` | 状態遷移 |
| `relay focus [id] [--clear]` | フォーカス set/show/clear |
| `relay forget <sessionId> [--source claude_session_todo] [--yes]` | セッション由来タスクの物理削除 |
| `relay prune [--missing-repos] [--source T] [--all-sources] [--include-done] [--yes]` | 消えた repo のタスク整理 (取り消し可) |

### Run

| Command | 説明 |
|---|---|
| `relay run <id> [--ask] [--dry-run] [--no-template] [--no-resume] [--keep-focus]` | 担当エージェントを repo の cwd で起動。task に紐付く context があれば summary を preamble として prompt 冒頭に注入する (§11 を参照)。`<repo>/.agents/RELAY_PROMPT.md` があればテンプレ採用 (`--no-template` で抑止) |

### Web / Context / Hook

| Command | 説明 |
|---|---|
| `relay web [-p 7340] [--host 127.0.0.1] [--no-open]` | Hono on Bun (`/api/*` + 静的 SPA) |
| `relay context save [--auto] [--repo X] [--summary ...]` | repo snapshot。`--auto` は Stop hook 用 (stdin から payload) |
| `relay context list [--repo X]` | 保存済み一覧 |
| `relay context show <hash>` | 本文 |
| `relay context summarize <hash> [--llm]` | 一行サマリ (`--llm` で Claude 経由) |
| `relay context edit <hash> --summary ...` | サマリ上書き |
| `relay hook install` / `relay hook status` / `relay hook uninstall` | `~/.claude/settings.json` の Stop hook (§11) |

### Cross-machine

| Command | 説明 |
|---|---|
| `relay export --file relay.json` | snapshot 出力 |
| `relay import --from linear\|things\|notion\|generic\|relay --file PATH [--repo R] [--dry-run] [--read-only]` | bulk import |

## 8. Web Views

Web UI (`relay web`) は `localhost:7340` で起動する Hono + 静的書き出しの
Next.js 15 + React 19。ルートは path-based:
`/tasks` (default) / `/agenda` / `/sessions{,/detail}` / `/repos{,/detail}` /
`/contexts{,/graph}` / `/context` / `/sync` / `/insights` / `/review`。
詳細は `WEB_DESIGN.md`、キーバインドは `HOTKEYS.md` を参照。

## 9. Storage

- Path: `~/.relay/db.sqlite`
- Schema: see `src/db/schema.sql`
- Backup: `relay export <path>` で JSON ダンプ
- Migration: schema_version テーブルで管理

## 10. Execution Layer

`relay run <id>` の実行フロー:

1. task を fetch、`repo` から absolute path を解決 (`~/repos/github.com/<repo>`)
2. `<repo>/.agents/RELAY_PROMPT.md` が存在し `--no-template` 指定がなければ、内容を **repo template** として読込
3. `runs` テーブルに `running` row を insert
4. assignee に応じて launcher を選択:
   - `claude-code`: `cd <repo> && claude --resume <session_id>` または `cd <repo> && claude '<prompt>'`
   - `codex`: `cd <repo> && codex '<prompt>'`
   - `gemini`: `cd <repo> && gemini '<prompt>'`
   - `self`: editor 起動 (`$EDITOR <repo>`)
   - `human-review`: GitHub PR URL を `open`
5. launcher プロセス終了時、`runs.ended_at` を更新
6. 終了 hook で `relay context save` を呼ぶ

### 10.1 Repo-scoped prompt template (`.agents/RELAY_PROMPT.md`)

リポごとに固定の前置きを `<repo>/.agents/RELAY_PROMPT.md` に置くと、`claude-code` / `codex` / `gemini` 起動時の prompt 先頭に自動挿入される。プロンプト合成順は **`repo template` → `context preamble` → `task.prompt`** (各セクション間は `---` 区切り)。

- 適用条件: `relay run <id>` 実行時に `<repo>/.agents/RELAY_PROMPT.md` が存在し、`--no-template` が指定されていないこと。空ファイルは無視される。
- 適用された場合は実行ログに `+ .agents/RELAY_PROMPT.md applied` を表示する (透明性確保)。
- 既存の `claude --resume <session_id>` パスでは template は適用されない (session 復帰中の prompt 注入は session 整合性を壊すため)。
- 編集は通常のテキストエディタで行う。Web UI からの編集 UI は **#TODO(future)** とする。

## 11. Context Save / Restore

### Save (session 終了時 hook)

`relay hook install` が `~/.claude/settings.json` を更新し、`Stop` イベントの catch-all matcher に hook entry を追加する:

```jsonc
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "relay context save --auto" }
        ]
      }
    ]
  }
}
```

既存設定があれば破壊せずマージし、`relay hook uninstall` は entry を取り除いて空のグループを削除する (`src/commands/hook.ts`)。

`relay context save --auto` の実行内容:
- stdin から Claude が送る Stop hook payload (cwd / transcript path 等) を読み取る
- `git rev-parse HEAD` → `head_sha`、`git status --porcelain` → `dirty_files`
- transcript の末尾 TodoWrite / 直前のアシスタント発話 → `summary` (一行)
- `contexts` テーブルに insert し、関連 task の `context_hash` を更新

### Restore (read-only preamble injection)

専用の `relay context restore` コマンドは持たない。代わりに `relay run <id>` 起動時:

- `task.context_hash` が指す `contexts` 行を `db.getContext(hash)` で取得
- `context.summary` / `branch` / `head_sha` を `formatPreamble()` で整形 (`src/commands/run.ts`)
- 整形済みテキストを実行プロンプトの冒頭に注入 (`contextPreamble`)
- ファイルチェックアウトや `git checkout <head_sha>` は **行わない** — 完全に read-only
- 担当者が `self` / `human-review` の場合は preamble を生成しない (人間が再開する想定)
- `--no-resume` を付けると preamble は注入されるが、エージェント側 (Codex / Gemini) の `--resume` パリティは無効化する

## 12. Configuration

`~/.relay/config.toml`:

```toml
[scan]
roots = ["~/repos/github.com"]
exclude = ["node_modules", "vendor", ".next", "dist", "target"]
max_depth = 2  # repos/github.com/<repo> までを scan

[github]
user = "simota"
orgs = ["Luna-company"]

# ProjectV2 sub-config — only consulted by `gh-project-card` adapter.
[github.project_v2]
# Sentinel `repo` value for standalone DraftIssue cards (no linked
# Issue / PR). Treated as a normal repo name by the rest of relay;
# the only difference is that `relay run` warns the directory does
# not exist when the user tries to launch an agent against it.
# Users who keep a literal inbox repo can repoint this (e.g. `"inbox"`).
fallback_repo = "__inbox__"

# `gh_project_card` adapter knobs — only consulted when the
# adapter is enabled via `[adapters].gh_project_card = true`.
[gh_project_card]
# Status column values (case-insensitive) that close the task via
# `fetchResolved`. ProjectV2 column names vary per project; users with
# custom done labels (`Released`, `Shipped 🚀`) override this list.
done_statuses = ["Done", "Completed", "Closed", "Shipped"]

[agents]
default = "claude-code"
claude_bin = "claude"
codex_bin = "codex"
gemini_bin = "gemini"

[ui]
default_view = "today"
today_limit = 5
priority_decay_days = 14  # 14日触らないタスクは priority -10 (累積)。`relay today` の並び順に反映 (set 0 to disable; restores raw priority ordering)

[daemon]
enabled = false
interval_sec = 300
```

## 13. Performance Budget

| Operation | Budget | Measured (p50 / p95) | Headroom | Source |
|---|---|---|---|---|
| `relay sync` (full) | ≤ 5s | 2444ms / 2808ms | ~44% | bench 2026-05-14, 40+ repos, 898 tasks, MacBook Air |
| `relay sync --dry-run` | (no formal budget) | 1365ms / 2482ms | n/a | bench 2026-05-14, same setup |
| `relay today` | ≤ 100ms | 64ms / 65ms | ~35% | bench 2026-05-14, same setup |
| `relay run` 起動 | ≤ 500ms | not measured | unknown | excluding agent startup |

Notes:
- p50/p95 are 5-sample bench. Method: warm-up run + 5 timed runs, sort, take 3rd (p50) and 5th (p95). Script: `/tmp/bench-relay.sh` (not checked in — re-derive on local).
- `relay sync --dry-run` shows wide variance because adapter file IO dominates and OS file cache state varies between runs.
- `relay run` benchmark deferred — launches an external agent. The static budget stays until a harness lands.

## 14. Roadmap

| Version | Scope |
|---|---|
| **v0.1** (MVP, 1-2週) | `code-todo` + `claude-session` adapter、`init/sync/today/ls/show/run` |
| **v0.2** | `github-issue/pr` adapter、`add/snooze/close`、context save/restore |
| **v0.3** | daemon、Web UI (docview 互換)、`.agents/` adapter |
| **v0.4** | hook 自動統合、refscope / agent-skills 連携 |
| **v1.0** | export/import、複数 root 対応の最適化、Codex/Gemini launcher |

## 15. Open Questions

- Q1: Codex CLI / Gemini CLI の正確な session resume API は要調査
- Q2: TodoWrite の jsonl フォーマットは Claude Code バージョン依存 — adapter は version-aware にする
- Q3: 40+リポを5sで scan するための ripgrep 並列度 (M1 想定)
- Q4: priority 自動算出ロジック (recency × source weight × due) は v0.2 で詰める
  - `priority_decay_days` に基づく effective priority を `today` ranking に適用済 (#49)。`relay show` でも引き続き可視化。`priority_decay_days = 0` で v0.1 の raw priority 並び順に degrade 可能。残: source weight / due weight
