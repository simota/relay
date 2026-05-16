# relay — Install

`relay` は **Bun ≥ 1.1.0** をランタイムにしたローカル CLI / Web ハブです。
本ドキュメントは初回セットアップから `relay` をグローバルに呼べる状態にするまでの手順をまとめます。
クイック起動だけなら `README.md` の Quickstart、コマンドの早見表は `CHEATSHEET.md` を参照してください。

## TL;DR

```bash
# 1) 前提: Bun ≥ 1.1.0, git, rg(ripgrep). gh / claude / codex は任意
curl -fsSL https://bun.sh/install | bash    # まだ入っていなければ

# 2) clone
git clone https://github.com/devs/relay.git ~/repos/github.com/devs/relay
cd ~/repos/github.com/devs/relay

# 3) `relay` を PATH に通す (bun link 経由が最短)
bun install && bun link                     # bin の relay を PATH に登録

# 4) 一括セットアップ — root + web/nextjs の deps インストール & Web UI ビルド
relay setup

# 5) 初期化と動作確認
relay init
relay doctor
relay quickstart
```

## Prerequisites

| ツール | 必須 | 用途 | インストール |
|---|---|---|---|
| **Bun** ≥ 1.1.0 | ✅ | ランタイム (`bun:sqlite` / `Bun.serve`) | `curl -fsSL https://bun.sh/install \| bash` |
| **git** | ✅ | リポ解決・git アダプタ | OS パッケージマネージャ |
| **ripgrep** (`rg`) | ✅ | code-todo アダプタの TODO スキャン | `brew install ripgrep` など |
| **GitHub CLI** (`gh`) | 推奨 | github アダプタ (issue / pr / notification) | `brew install gh` → `gh auth login` |
| **Claude Code** (`claude`) | 任意 | `relay run` で Claude を起動 / Stop hook 統合 | [公式手順](https://docs.claude.com/en/docs/claude-code) |
| **Codex CLI** (`codex`) | 任意 | `relay run` で Codex 起動 (`--resume` パリティ) | OpenAI 公式手順 |
| **Gemini CLI** (`gemini`) | 任意 | `relay run` で Gemini 起動 | Google 公式手順 |

> **Node.js ではなく Bun が必要です**。`bun:sqlite` をネイティブに使うため、`node src/cli.ts` では起動しません。

`relay doctor` で各種コマンドの検出状況を確認できます。
`--strict` フラグを付けると、いずれか不足時に非ゼロで終了します (CI で便利)。

## Step-by-step

### 1. Clone

```bash
# 既定の repo root は ~/repos/github.com (config.toml の scan.roots で変更可)
mkdir -p ~/repos/github.com/devs
git clone https://github.com/devs/relay.git ~/repos/github.com/devs/relay
cd ~/repos/github.com/devs/relay
```

### 2. Dependencies & Web UI build

```bash
bun install            # root deps を入れる (まだの場合)
bun link               # `relay` を PATH に通す
relay setup            # root+web の deps を入れて Web UI を一括ビルド
```

`relay setup` は以下を一括で行います (冪等):

- `bun install` (root) — `node_modules/` が無ければ実行
- `bun install` (`web/nextjs`) — 同上
- `bun run build` (`web/nextjs`) — `web/nextjs/out/index.html` が無ければ実行

既に揃っているものはスキップされます。`relay setup --force` で再インストール + 再ビルド、`--skip-install` / `--skip-build` で片方だけ実行することもできます。

> 互換手段: `make bootstrap` でも同じことができます (`bun install` × 2 + `bun run build`)。CI で `relay` をまだリンクしていない段階で動かす場合に便利です。

`relay web` は `web/nextjs/out/` を静的配信します。
ビルドしていない場合は "frontend not built" プレースホルダが `relay setup` を案内します。

### 3. グローバルコマンド化 (どれか 1 つ)

| 方法 | コマンド | 備考 |
|---|---|---|
| **bun link (推奨)** | `bun link` (リポ内で実行) | `bin.relay` が `src/cli.ts` を直接指すので、`git pull` 後の再ビルド不要。ソース更新が即反映される。 |
| **bundle + symlink** | `make build && ln -sf "$PWD/dist/cli.js" ~/.local/bin/relay` | 単一ファイル配布したい場合。更新の都度 `make build` が必要。 |
| **shell alias** | `alias relay='bun run ~/repos/github.com/devs/relay/src/cli.ts'` (`~/.zshrc` などに追記) | リポをいじりたくないとき最も軽量。 |
| **npm global** | `npm i -g .` (リポ内) | dist 経由。事前に `make build`。 |

> `package.json` の `bin.relay` を変更したり `src/cli.ts` を移動した場合は、リポ内でもう一度 `bun link` を実行してシムリンクを張り直してください。

検証:

```bash
which relay
relay --version            # 0.0.1
relay --help
```

### 4. 初期化

```bash
relay init                 # ~/.relay/{db.sqlite, config.toml} を作成
relay doctor               # rg / gh / claude / codex / gemini / git を点検
relay quickstart           # 初回 sync + today
```

`~/.relay/config.toml` で以下を編集できます (例):

```toml
[scan]
roots = ["~/repos/github.com", "~/work"]

[adapters]
code_todo       = true
github_issue    = true
github_pr       = true
github_notif    = true
claude_session  = true
codex_session   = true
agents_note     = true
manual          = true
```

`.relayrc.example.toml` がテンプレートとして同梱されています。

### 5. オプション統合

```bash
# Claude Code の Stop hook 統合 (session 終了時に自動で context save)
relay hook install
relay hook status

# Web UI を起動して http://127.0.0.1:7340 を開く
relay web
```

## Updating

```bash
cd ~/repos/github.com/devs/relay
git pull
relay setup --force    # 依存を再インストール + frontend を再ビルド
# bun link 経由なら relay コマンドは自動で最新を指す
```

スキーマが変更された場合は `relay sync` 実行時に `schema_version` を見て自動マイグレーションされます。
DB を物理的にやり直したい場合は `~/.relay/db.sqlite` を退避してから `relay init --force` してください。

## Uninstall

```bash
bun unlink                              # `bun link` していた場合
rm -f ~/.local/bin/relay                # symlink 方式だった場合
rm -rf ~/.relay                         # DB / config を完全削除 (破壊的)
relay hook uninstall                    # 事前に呼ぶと ~/.claude/settings.json から hook を外せる
```

## Troubleshooting

| 症状 | 原因 / 対処 |
|---|---|
| `bun: command not found` | `curl -fsSL https://bun.sh/install \| bash` の後にシェルを再起動 / `~/.zshrc` で PATH を確認 |
| `relay web` が "frontend not built" を返す | `relay setup` を実行 (内部で `bun install` と `bun run build` をまとめて行う) |
| `Could not load bun:sqlite` | Node で実行している。`bun run src/cli.ts ...` または `bun link` 経由で起動する |
| `relay doctor` で `gh` 検出失敗 | `brew install gh && gh auth login`。github アダプタを無効化したい場合は `config.toml` で `[adapters] github_* = false` |
| `relay sync` が途中で止まる | `Ctrl+C` でも完了したアダプタは保存される。`relay sync --resume` で続行 |
| `relay run` が repo を見つけられない | `config.toml` の `scan.roots` と、タスクの `repo` 名が `<root>/<repo>` で解決できるか確認 |
| Web UI の 7340 がポート競合 | `relay web --port 7341` |
| 別マシンへ移行したい | 旧機: `relay export --file relay.json` / 新機: `relay import --from relay --file relay.json` |

更に詳しい設計は `SPEC.md` / `ARCHITECTURE.md`、Web UI のキー操作は `HOTKEYS.md`、CLI 全コマンドは `CHEATSHEET.md` を参照してください。
