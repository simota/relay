# relay — Cheatsheet

CLI と Web UI の早見表。インストールは `INSTALL.md`、Web UI 詳細は `HOTKEYS.md` を参照。

凡例: `<id>` 必須, `[id]` 任意, `--flag` フラグ, `*` 破壊的 / 確認推奨。
`<when>` = `YYYY-MM-DD` / ISO datetime / `today` / `tomorrow` / `next-week` / `mon`..`sun` / `+3d` / `+2w` / `+4h`。

## Setup / Diagnostics

| Command | 用途 |
|---|---|
| `relay setup [--force] [--skip-install] [--skip-build]` | root + `web/nextjs` の `bun install` と Next.js ビルドを一括実行 (冪等)。`--force` で全部やり直し。 |
| `relay init [--force]` | `~/.relay/{db.sqlite, config.toml}` を作成。`--force` で再生成。 |
| `relay quickstart [--no-sync]` | 初回 sync + today をワンショット。`--no-sync` で sync スキップ。 |
| `relay doctor [--strict]` | `rg / gh / claude / codex / agy / git` 検出。`--strict` で非ゼロ終了。 |
| `relay --help` / `relay <cmd> --help` | サブコマンドのフラグ一覧。 |

## Sync (ingest)

| Command | 用途 |
|---|---|
| `relay sync` | 全アダプタから ingest (SSE 進捗)。 |
| `relay sync --source <name>` | 1 アダプタのみ。`--only` も同義。 |
| `relay sync --dry-run` | DB 書き込みなしで対象ファイル数だけ確認。 |
| `relay sync --resume` | 1 時間以内に完了したアダプタをスキップして続き。 |

主なソース名: `code_todo`, `github_issue`, `github_pr`, `github_notif`, `github_run_failure`, `github_project_card`, `git_interrupted`, `git_stash`, `git_orphan_branch`, `claude_session_todo`, `codex_session`, `antigravity_session`, `cursor_session`, `agents_note`, `manual`.
正規仕様は `SPEC.md §6`。

## Views

| Command | 用途 |
|---|---|
| `relay today [-n <N>]` | `wait_on='self'` 優先の今日やる N 件。 |
| `relay agenda [--days 7\|14\|30]` | due_at / scheduled タスクのカレンダー + Overdue。 |
| `relay standup [--since 24h\|48h\|7d\|14d\|30d]` | 昨日のクローズ・今日の自走・ブロッカー。 |
| `relay digest [--since 7d] [--out <path>] [--format md\|json]` | 区間サマリを Markdown / JSON で。 |
| `relay ls [--repo X] [--source S] [--status open\|done\|snoozed\|all] [--agent A] [-q text] [-t tag] [--blocked\|--ready] [-n N]` | フィルタ付き一覧。`-q/--grep` は title / body / prompt / repo / source_id の全文検索 (指定時は全 status 対象)。`-t/--tag` でタグ、`--blocked` / `--ready` で依存待ちの有無を絞り込み。 |
| `relay show <id>` | タスク詳細 (prompt / files / wait_on / タグ / 編集済みフィールド / blocked by・blocks / 直近の agent run 履歴 / session 紐付け)。 |
| `relay tags [--json]` | 使用中のタグと open / total 件数。 |
| `relay watch <repo> [--interval 5s\|10s\|30s\|1m]` | repo のタスク変動をリアルタイム tail。 |

## Lifecycle

| Command | 用途 |
|---|---|
| `relay add [--repo X --title "..." --assignee A --prompt "..." --files a,b --due <when> --wait-on W --priority 0-100 --body "..." --tags a,b --blocked-by 1,2 --every R]` | 手動追加。引数なしで対話モード。作成した `#id` を表示。`--every` = `daily`/`weekdays`/`weekly`/`biweekly`/`monthly`/`3d`/`2w`/`mon,thu` で繰り返しタスク。 |
| `relay edit <id> [--title --body --priority --prompt --files --due <when> --wait-on W --repo --every R] [--clear-due] [--clear-prompt] [--reset f1,f2]` | タスクを編集 (`--every none` で繰り返し解除)。編集したフィールドは `relay sync` で上書きされない (`--reset` で adapter に返す)。`--repo` は manual のみ。 |
| `relay tag <id> [tag ^tag ...] [--ids 3,4] [--clear]` | タグを表示 / 追加 / 削除 (`^tag` または `relay tag 5 -- -tag` で削除、`--ids` で一括)。sync で消えない。 |
| `relay block <id> <blocker...>` | 依存関係を追加 ("#id は blocker の完了待ち")。完了まで today から隠れ、queue run は blocker 成功後に起動。循環は拒否。 |
| `relay unblock <id> [blocker...]` | 依存関係を削除 (blocker 省略で全部)。 |
| `relay assign <id> <agent>` | 担当変更 (`claude-code` / `codex` / `antigravity` / `self` / `human-review`)。 |
| `relay close <ids...>` | done に (複数 id 可、1 回の undo でまとめて戻る)。繰り返しタスクは次回分を snooze 状態で自動生成 (期日に open へ復帰)。 |
| `relay snooze <ids...> [--until <when>]` | snooze に。`--until` 指定時はその日時を過ぎると自動で open に戻る。 |
| `relay reopen <ids...>` | snooze / done → open に戻す。 |
| `relay note <id> ["text"\|-] [--queue [--front]] [--rm <noteId>] [--json]` | タスクノート。テキストなしで一覧。ノートは次の agent run の prompt 末尾に入る。`--queue` で「ノート付きで再キュー」(失敗した run の retry with feedback)。⌘Z / `relay undo` 可。 |
| `relay merge <keep> <dup...>` | 重複タスクを `<keep>` に統合: dup を close し、タグ・依存関係・ノートを引き継ぐ (1 回の undo で戻る)。 |
| `relay focus [id] [--clear]` | 今フォーカス中のタスクを set / show / clear。 |
| `relay undo [--redo] [--list]` | 直前の変更 (close / snooze / reopen / assign / edit / tag / block / bulk / prune) を取り消し。Web の ⌘Z と同じ undo log。 |
| `relay forget <sessionId> [--source claude_session_todo] [--yes]` * | 特定セッションから入ったタスクを物理削除。 |
| `relay prune [--missing-repos] [--source T] [--all-sources] [--include-done] [--yes]` * | repo が消えたタスクを整理。`--yes` で無対話。 |

## Run (agent launch)

| Command | 用途 |
|---|---|
| `relay run <id>` | 担当エージェント (Claude / Codex / Antigravity) を repo で起動。 |
| `relay run <id> --ask` | プロンプトをプレビューしてから起動確認。 |
| `relay run <id> --dry-run` | プロンプトだけ表示、起動なし。 |
| `relay run <id> --no-template` | `<repo>/.agents/RELAY_PROMPT.md` を使わず素プロンプト。 |
| `relay run <id> --no-resume` | 直前セッションを再開せず新規プロンプト。 |
| `relay run <id> --keep-focus` | 完了後に focus を解除しない。 |
| `relay run <id> --headless [--timeout <min>]` | 非対話実行 (`claude -p` / `codex exec`)。出力は `~/.relay/runs/<run>.log`。 |
| `relay run <id> --close-on-success` | agent が exit 0 (かつ verify gate 通過) なら task を close (⌘Z / `relay undo` 可)。 |
| `relay run <id> --verify` / `--no-verify` | verify gate: 成功後に repo の verify コマンドを実行し、赤なら run を failed に。 |
| `relay run <id> --headless --verify --retries 2` | 失敗したら出力をノートに書いて最大 2 回再挑戦 (green になるまで反復)。 |
| `relay verify <id>` / `--repo X` / `--list` | verify コマンドを単独実行 / repo ごとの設定を一覧。 |

## Queue (AI job queue)

Web の queue tray (`a` / bulk `a`) と共有。

| Command | 用途 |
|---|---|
| `relay queue` / `relay queue ls` | 実行順に一覧。 |
| `relay queue add <ids...> [--front] [--assign codex]` | 追加 (重複なし)。`--front` で先頭、`--assign` で担当も一括変更。 |
| `relay queue add --failed [--since 24h\|3d\|1w]` | 最新 run が失敗 / 中断した未完了タスクをまとめて再キュー (Web tray の「retry N failed」と同じ)。 |
| `relay queue rm <ids...>` / `relay queue clear` | 除去 / 全消去。 |
| `relay queue run` | 先頭から順に起動 (依存関係順: blocker が成功するまで dependent は待つ)。成功分は queue から外れる。失敗で停止。 |
| `relay queue run --headless [--continue-on-error] [--close-on-success] [-n N] [--timeout <min>]` | 無人で一括実行 (claude-code / codex)。 |
| `relay queue run --headless --verify --retries 2 --close-on-success` | 夜間バッチ: 各タスクを verify が green になるまで最大 3 attempt、green だけ close。 |
| `relay queue run --headless -j 3` | 別 repo のタスクを最大 3 件並列実行 (同じ repo は直列、依存は完了待ち)。 |
| `relay queue run --dry-run` | 起動順と prompt だけ確認。 |
| Web queue tray「run…」 | `relay web` 自身が headless で queue を処理 (verify gate / retries / close on success を選択、進捗と結果を tray に表示、stop は現タスク完了後)。開始できるのは relay web と同じマシンからのみ。CLI の `queue run` とはロックで排他。タスク詳細の「run headless」でそのタスクだけ即実行。 |
| `relay runs [--task <id>] [--status failed] [-n N] [--json]` | run 履歴 (所要時間・出力末尾・変更ファイル数 / コミット数)。 |
| `relay runs --log <run-id>` | headless run の出力ログ全体 (先頭に変更ファイル一覧)。 |
| `relay runs --diff <run-id>` | その run が repo に加えた変更の patch (起動前 HEAD との差分)。 |

headless の権限は `~/.relay/config.toml` の `[agents]` で: `claude_headless_args = ["--permission-mode", "acceptEdits"]`, `codex_headless_args = ["--full-auto"]`, `headless_timeout_min = 30`。

## Verify gate (`[verify]`)

```toml
[verify]
auto = false        # true で全 run を検証
retries = 0         # headless の既定 --retries
timeout_min = 10

[[verify.repos]]
repo = ["billing-*", "relay"]
command = "bun run typecheck && bun test"
```

repo 側に置く場合は `<repo>/.agents/RELAY_VERIFY` に 1 行 (`#` コメント可)。config が優先。

## Triage rules (`[[rules]]`)

sync が新規に取り込んだタスクへ自動適用。`~/.relay/config.toml` に書く:

```toml
[[rules]]
name   = "security fixmes → codex"
repo   = ["billing-*"]        # glob
source = "code_todo"           # source type(s)
title  = "FIXME|security"      # 正規表現 (大小無視)。body = "..." も可
tag    = ["security"]
assign = "codex"
priority = 80                  # wait_on = "external" も可
queue  = true                  # AI job queue へ投入。stop = true で後続ルール停止
```

| Command | 用途 |
|---|---|
| `relay rules [--json]` | ルール一覧・設定エラー・現在マッチする open 件数。 |
| `relay rules apply [--dry-run] [--json]` | 既存の open タスク全体に適用 (1 回の undo で戻る)。Web は `/sync` の Triage rules カード。 |

## Context (repo snapshot)

| Command | 用途 |
|---|---|
| `relay context save [--auto] [--repo X] [--summary "..."] [--session-type claude\|codex\|antigravity\|cursor]` | 現 repo の作業 snapshot。`--auto` は Claude Stop hook 経由。Codex / Antigravity は `relay run` 完了時と `relay sync` 取り込み時にも保存。 |
| `relay context list [--repo X]` | 保存済み context 一覧。 |
| `relay context show <hash>` | 1 件の本文。 |
| `relay context summarize <hash> [--llm]` | 一行サマリ生成。`--llm` で Claude 経由。 |
| `relay context edit <hash> --summary "..."` | サマリを手動上書き。 |

## Hooks (Claude Code 統合)

| Command | 用途 |
|---|---|
| `relay hook install` | `~/.claude/settings.json` の `hooks.Stop` に `relay context save --auto` を追加。 |
| `relay hook status` | 現在インストール済みか確認。 |
| `relay hook uninstall` | 該当 hook を削除。 |

## Web UI

| Command | 用途 |
|---|---|
| `relay web` | `http://127.0.0.1:7340` (UI + API + `/insights`)。 |
| `relay web --port 7341 --host 0.0.0.0 --no-open` | ポート/ホスト指定、ブラウザ自動起動なし。 |

Web UI のキーバインドは `HOTKEYS.md`。最頻出だけ抜粋:

| Key | Action |
|---|---|
| `g t` / `g a` / `g o` / `g s` / `g d` | Today / Agenda / Open / Snoozed / Done |
| `g r` / `g c` / `g n` / `g v` | Repos / Contexts / New task / View session |
| `j` / `k` | 次/前タスク |
| `/` | filter focus (`repo:x tag:billing is:ready is:blocked age>7 source:code_todo`) |
| `r` / `s` / `c` / `o` / `a` | run コピー / snooze / close / reopen / queue 追加 |
| `e` / `⇧S` | 選択タスクを編集 / 明日まで snooze |
| `m` | 詳細パネルのノート入力へ (`⌘↵` 保存 / `⇧⌘↵` note & retry) |
| `R` | sync |
| `⌘K` / `Ctrl+K` | command palette |

## Cross-machine sync

| Command | 用途 |
|---|---|
| `relay export --file relay.json` | DB を JSON snapshot に出力。 |
| `relay import --from relay --file relay.json [--dry-run] [--read-only]` | 別マシンへ取り込み (read-only ミラーも可)。 |
| `relay import --from linear\|things\|notion\|generic --file <.json\|.csv> [--repo fallback] [--dry-run]` | 外部ツール bulk import。 |

## Maintenance

| Command | 用途 |
|---|---|
| `relay backfill [--list] [--dry-run] [--only <name>]` | 冪等な後方互換 fixup (例: legacy context の session_id 補完)。 |
| `relay prune --missing-repos --yes` * | 消えた repo のタスクを一掃。`relay web` の ⌘Z / Ctrl+Z で取り戻し可（`--include-done` の物理削除は不可）。 |

## Developer shortcuts

Makefile の代表ターゲット (`make help` で全表示):

| Target | 意味 |
|---|---|
| `make setup` | `relay setup` (冪等な root+web install + Web UI ビルド) |
| `make bootstrap` | `bun install` (root + web) + 初回 web build (`relay` 未リンク時のフォールバック) |
| `make web` | web を build してから `relay web` 起動 |
| `make dev` | API (:7340) + Next.js dev (:3340) を並走 |
| `make typecheck-all` | root + `web/nextjs` の `tsc --noEmit` |
| `make check` | typecheck × 2 + `bun test` |
| `make build-all` | CLI bundle (`dist/cli.js`) + web 静的書き出し |
| `make clean` / `make clean-deps` | 生成物 / 依存を削除 |

## Files & paths

| Path | 用途 |
|---|---|
| `~/.relay/db.sqlite` (+ `-shm` / `-wal`) | task / session / context の SQLite。`RELAY_HOME` で変更可。 |
| `~/.relay/config.toml` | `scan.roots` とアダプタ ON/OFF。`.relayrc.example.toml` がテンプレ。 |
| `<repo>/.agents/RELAY_PROMPT.md` | `relay run` のプロンプトテンプレ (任意)。 |
| `web/nextjs/out/` | 静的書き出し。`relay web` が配信。 |
| `dist/cli.js` | `bun run build` の成果物 (配布用)。 |

## See also

- `INSTALL.md` — セットアップ詳細とトラブルシュート
- `README.md` — プロジェクト概要
- `SPEC.md` — データモデル / アダプタ / `source_id` 仕様
- `ARCHITECTURE.md` — レイヤとシーケンス
- `HOTKEYS.md` — Web UI 全キー
- `WEB_DESIGN.md` — UI デザイン仕様
