# relay

> **AIジョブキュー型・横断タスク管理ツール**
> 個人多事業主が40+リポを横断する時代のための、ローカルファーストなタスクハブ。

## What it is

`relay` は、以下のソースに散らばるタスクを単一の SQLite インデックスへ集約し、各タスクを **`(repo, agent, prompt, files, context)` を持つ実行可能ユニット** として扱うローカル CLI / Web ハブです。

- **Code** — `rg` 全 scan による TODO / FIXME / HACK / XXX
- **GitHub** — issue / PR / notifications / Actions failure / Project v2 cards
- **Git states** — interrupted rebase・merge・cherry-pick、stash、PR の付いていない orphan branch
- **AI CLI sessions** — Claude Code / Codex / Antigravity / Cursor の TodoWrite・plan・chat
- **Project notes** — `.agents/*.md` の checkbox 行
- **Manual** — `relay add` で直接登録

ワンキーで該当 repo に Claude Code / Codex / Antigravity を起動でき、セッション終了時にはコンテキストを退避して後日リジューム可能。Codex は `--resume` パリティ対応 (Antigravity は CLI 側に UUID resume が無いため preamble fallback)。

## Why

既存のタスク管理ツール (Linear, GitHub Projects, Things, Claude Code の TodoWrite) は、いずれも「個人 × 多リポ × AI 実行可能」の領域を満たしません。

| | Linear | GH Projects | TodoWrite | **relay** |
|---|---|---|---|---|
| 横断リポ | △ | × | × | ◎ |
| AI実行可能 | × | × | △ session内のみ | ◎ |
| コンテキスト復元 | × | × | × | ◎ |
| ローカルファースト | × | × | △ | ◎ |
| 個人多事業主の量に耐える | △ | △ | △ | ◎ |

## Install

詳細は [INSTALL.md](./INSTALL.md)。最短手順:

```bash
# Bun ≥ 1.1.0 が必要 (`bun:sqlite` / `Bun.serve` を使用)
git clone https://github.com/devs/relay.git ~/repos/github.com/devs/relay
cd ~/repos/github.com/devs/relay
bun install && bun link                    # 最初の bun install と PATH 通し
relay setup                                # root+web deps を入れて Web UI を一括ビルド
relay init && relay doctor                 # 初期化 + 環境チェック
```

## Quickstart

```bash
relay quickstart                           # 初回 sync + 今日の view まで一気通貫
relay today                                # 今日やる N 項目 (wait_on='self' 優先)
relay web                                  # http://127.0.0.1:7340 (UI + API + /insights)
relay run <task-id>                        # 該当 repo に agent を起動 (Claude/Codex/Antigravity)
```

主要コマンドの早見表は [CHEATSHEET.md](./CHEATSHEET.md)、Web UI のキーバインドは [HOTKEYS.md](./HOTKEYS.md) を参照。

## Documentation

- [Landing Page](https://simota.github.io/relay/) — プロジェクト紹介サイト
- [INSTALL.md](./INSTALL.md) — セットアップ手順とトラブルシュート
- [CHEATSHEET.md](./CHEATSHEET.md) — CLI / Web UI 早見表
- [HOTKEYS.md](./HOTKEYS.md) — Web UI のキー一覧
- [SPEC.md](./SPEC.md) — 詳細仕様 (データモデル / コマンド / アダプタ)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — レイヤ構造とシーケンス
- [WEB_DESIGN.md](./WEB_DESIGN.md) — Web UI デザイン仕様

## Status

`v0.1` — CLI / Web (Next.js 15 + React 19) / Hono backend (Bun) が動作。
実装済み:

- **アダプタ 15 種** — code-todo / github (issue, pr, notification, run-failure, project-card) / git (interrupted, stash, orphan-branch) / AI sessions (claude, codex, antigravity, cursor) / agents-note / manual
- **実行系** — Claude / Codex / Antigravity (`agy`) 起動、Codex `--resume` パリティ + `--no-resume` フラグ (F-2)
- **セッション統合** — `sessions` テーブル基盤 (F-1) と task↔session 双方向ナビ (F-4)、メッセージ単位の rendered/raw markdown トグル
- **コンテキスト** — repo snapshot save / restore、Stop hook での自動退避、JSON export/import
- **Web UI** — `/insights` アナリティクスダッシュボード、18 種のテーマプリセット (paper / mist / midnight / solar / washi / blueprint / nord / sakura / amber / hc-dark / hc-light など)、compositor-safe アニメーション、セッション詳細での新着メッセージハイライト + GFM テーブル / Mermaid レンダリング
- **UX** — g-leader キーマップ、fuzzy filter、wait_on による二段組 today view、SSE 同期進捗

## Accessibility

`relay web` (http://127.0.0.1:7340) は semantic HTML、status / priority 信号へのアクセシブルネーム (`role="img"` + `aria-label`)、focus-visible リング、`prefers-contrast: more` 対応。Screen reader / keyboard-only でも操作可能。

## License

MIT
