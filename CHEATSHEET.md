# relay — Cheatsheet

CLI と Web UI の早見表。インストールは `INSTALL.md`、Web UI 詳細は `HOTKEYS.md` を参照。

凡例: `<id>` 必須, `[id]` 任意, `--flag` フラグ, `*` 破壊的 / 確認推奨。

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
| `relay ls [--repo X] [--source S] [--status open\|done\|snoozed] [--agent A] [-n N]` | フィルタ付き一覧。 |
| `relay show <id>` | タスク詳細 (prompt / files / session 紐付け含む)。 |
| `relay watch <repo> [--interval 5s\|10s\|30s\|1m]` | repo のタスク変動をリアルタイム tail。 |

## Lifecycle

| Command | 用途 |
|---|---|
| `relay add [--repo X --title "..." --assignee A --prompt "..." --files a,b --due YYYY-MM-DD --priority 0-100 --body "..."]` | 手動追加。引数なしで対話モード。 |
| `relay assign <id> <agent>` | 担当変更 (`claude-code` / `codex` / `antigravity` / `self` / `human-review`)。 |
| `relay close <id>` | done に。 |
| `relay snooze <id>` | snooze に。 |
| `relay reopen <id>` | snooze / done → open に戻す。 |
| `relay focus [id] [--clear]` | 今フォーカス中のタスクを set / show / clear。 |
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
| `/` | filter focus |
| `r` / `s` / `c` / `o` / `a` | run コピー / snooze / close / reopen / assignee |
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
| `relay prune --missing-repos --yes` * | 消えた repo のタスクを一掃。`relay undo` で取り戻し可。 |

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
