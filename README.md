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
- **タスク編集** — `relay edit` / Web の `e` で title・priority・due・wait_on・prompt・files を編集。編集したフィールドは再 sync で上書きされず (`--reset` で upstream に返却)、⌘Z / `relay undo` で取り消し可能 (schema v11)
- **Snooze until** — `relay snooze --until tomorrow|+3d|fri|YYYY-MM-DD` / Web の snooze メニュー・`⇧S`。期限が来ると自動で open に復帰
- **AI ジョブキュー** — `relay queue add/run` と Web の queue tray が同じキューを共有。`relay queue run --headless` で claude-code / codex タスクを無人で順次実行し、出力は run ごとにログ保存 (`relay runs --log`、Web 詳細で展開)。Web から一括 queue / 一括 assign、tray で並べ替え
- **タグと依存関係** (schema v12) — `relay tag` / Web の詳細パネル・bulk `# tag…` で repo 横断タグを付け、`relay ls --tag` / `tag:` / サイドバー / 保存ビューで絞り込み (sync で消えない)。`relay block <id> <blocker>` / Web の「+ blocked by…」で依存を張ると、blocker 完了まで Today から隠れ、`relay queue run` は依存順に実行し、agent prompt に前提タスクが入る。循環は拒否、⌘Z / `relay undo` 可、export/import も対応
- **繰り返しタスク** (schema v13) — `relay add --every weekly` / `relay edit --every mon,thu` / Web の「repeat」。close すると次回分が snooze 状態で自動生成され期日に戻ってくる (完了履歴は残る、⌘Z で生成ごと取り消し)。queue と組み合わせて定期メンテを agent に回せる
- **run の変更キャプチャ** (schema v13) — 各 agent run が触ったファイル (+/− 行数) とコミット数を記録し、`relay runs` / `relay show` / Web の agent runs に表示。`relay runs --diff <run>` で patch を確認、`relay queue add --failed` / tray の「retry N failed」で失敗分を一括再キュー
- **一括ライフサイクル** — `relay close|snooze|reopen <ids...>` を 1 つの undo でまとめて実行
- **タスクノートと retry with feedback** (schema v14) — `relay note <id> "..."` / Web の notes (`m`) で進捗や「次はこう試して」を残すと、次の agent run の prompt 末尾に自動で入る。`--queue` / 「note & retry」で失敗した run をノート付きで再キュー
- **Verify gate と自動リトライ** (schema v15) — `relay run|queue run --verify` で agent 成功後に repo の検証コマンド (`[[verify.repos]]` / `.agents/RELAY_VERIFY`) を実行し、赤なら run を failed に (close されず retry 対象に)。`--retries N` で失敗出力をノートとして agent に返し green になるまで自動再挑戦。`relay verify` で単独実行、Web の agent runs に ✓ verified / ✗ verify
- **並列 queue 実行** — `relay queue run --headless -j N` / Web tray の parallel で別 repo のタスクを同時実行 (同 repo は直列、依存は完了待ち)
- **Web からの queue 実行** — queue tray の「run…」で `relay web` 自身が headless 実行 (verify / retries / close on success を選択)、進捗・結果・出力を tray でライブ表示。開始は loopback からのみ、CLI の `queue run` とはロックファイルで排他 (同じタスクを二重起動しない)
- **トリアージルール** — `config.toml` の `[[rules]]` (repo glob / source / title・body 正規表現 → tag / assign / priority / wait_on / queue) を sync が新規タスクへ自動適用。`relay rules apply` / `/sync` の Triage rules カードで既存タスクにも (⌘Z 可)
- **重複マージ** — `relay merge <keep> <dup...>` / `/insights` の重複クラスタから 1 クリックで統合 (タグ・依存・ノートを引き継ぎ、⌘Z 可)
- **検索と履歴** — `relay ls -q` と ⌘K パレットで done / snoozed を含む全タスクをサーバー側全文検索、`relay show` と Web 詳細にエージェント run 履歴

## Accessibility

`relay web` (http://127.0.0.1:7340) は semantic HTML、status / priority 信号へのアクセシブルネーム (`role="img"` + `aria-label`)、focus-visible リング、`prefers-contrast: more` 対応。Screen reader / keyboard-only でも操作可能。

## License

MIT
