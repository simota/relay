# relay Web UI — Design Specification

`v0.1 draft / 2026-05-12`

## 1. Goals & Non-Goals

### Goals
- **G1**: 40+ リポを横断する個人多事業主の「**Sunday review** = 何があって何が止まっているか」を一画面で把握できる
- **G2**: CLI と機能等価 (today / open / snoozed / 検索 / snooze / close / reopen)
- **G3**: 俯瞰系: repo 別集計 / age ヒストグラム / context 履歴 / source 別件数
- **G4**: ローカル単一ユーザー前提、認証なし、`localhost:7340` 起動
- **G5**: 既存 5 作品 (refscope / docview / devrouter / devcloud / agent-skills) と視覚言語を揃える

### Non-Goals
- マルチユーザー / 共有
- リアル agent 起動 (browser からは実行不可、deep-link で `relay run <id>` を copy する程度に留める)
- Mobile 最適化 (Desktop 1280px+ 想定)
- リッチエディタ / Markdown プレビュー (docview を別途利用)
- 認証 / 権限管理

## 2. Architecture

```
┌─ Browser ──────────────────────────────────────────────────────┐
│  Next.js 15 (static export) + React 19 + Tailwind v4           │
│    ↑ SSE (sync progress, session detail snapshot/update)       │
└──────────────────────────┬─────────────────────────────────────┘
                           │ fetch / EventSource
                           ▼
            ┌─ relay web (Hono on Bun :7340) ────────────────────┐
            │  buildApp() mounts ~15 sub-apps from src/api/:     │
            │    /api/tasks          (tasks.ts)                  │
            │    /api/today          (tasks.ts)                  │
            │    /api/queue          (queue.ts)                  │
            │    /api/views          (views.ts)                  │
            │    /api/sessions/:t/:id        (sessions.ts)       │
            │    /api/sessions/:t/:id/stream (SSE snapshot+update)│
            │    /api/sync                   (sync.ts)           │
            │    /api/sync/stream            (SSE per-adapter)   │
            │    /api/insights               (insights.ts)       │
            │    /api/review                 (review.ts)         │
            │    /api/contexts{,/graph}      (contexts.ts)       │
            │    /api/agenda / standup / digest                  │
            │    /api/scan / repos/:n/agents / undo              │
            │    /api/client-errors          (browser sink)      │
            │  Static SPA fallthrough:                           │
            │    web/nextjs/out/ if built, else web/app/         │
            └──────────────────────────┬─────────────────────────┘
                                       ▼
            ┌─ RelayDB facade (bun:sqlite) ─────────────────────┐
            │  src/db/{client,internal}.ts + queries/*          │
            │  used synchronously by both CLI and Hono handlers │
            └───────────────────────────────────────────────────┘
```

**Tech stack** (current impl):

- Server: **Hono** on **Bun** (`Bun.serve` direct, synchronous `bun:sqlite`).
- Frontend: **Next.js 15 + React 19** with `output: "export"` → `web/nextjs/out/` is consumed verbatim by the Hono server. Live development uses `next dev` on :3340 with a `/api/*` rewrite to :7340.
- Styling: **Tailwind v4** + 18 `:root[data-theme="…"]` presets in `app/globals.css` (oklch tokens — see §6).
- Markdown: `react-markdown` + `remark-gfm` for headings / lists / GFM tables, with `next/dynamic(ssr:false)` Mermaid for ` ```mermaid ` fences.

**Vanilla fallback**: `web/app/` ships a minimal static page that the Hono server serves when `web/nextjs/out/` is missing (e.g. before `relay setup`). It is no longer treated as a design prototype.

## 3. Information Architecture

Next.js App Router (`web/nextjs/app/*/page.tsx`) — **path routes** (no hash). 7340 で
配信される静的書き出しと、`next dev` (:3340) のどちらでも同じ URL。

| Route | View | Purpose |
|---|---|---|
| `/tasks` (default) | Tasks | today / open / snoozed / done をクエリ (`?status=...`) で切替 |
| `/agenda` | Agenda | 期日 / scheduled カレンダー + Overdue |
| `/sessions` | Sessions | Claude / Codex / Gemini / Cursor セッション一覧 |
| `/sessions/detail` | Session Detail | セッション本体 (messages / todos / tool calls)、SSE 差分でハイライト |
| `/repos` | Repos | repo 別カード + ドリルダウン (`/repos/detail`) |
| `/contexts` | Contexts | repo snapshot 一覧 (`/contexts/graph` でグラフ表示) |
| `/context` | Context Detail | 1 件の context 本文 |
| `/sync` | Sync | sync 状態、手動 trigger、adapter 別件数 |
| `/insights` | Insights | アナリティクスダッシュボード |
| `/review` | Review | バルク承認 / pager UI |

サイドバー (`components/sidebar.tsx`) + g-leader shortcuts (`HOTKEYS.md`) で
切替。URL はシェア可能でリロードに耐える。

## 4. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ relay                                          [sync ↻] [⚙] │ ← header (48px)
├──────────────┬───────────────────────────────────────────────┤
│              │ ┌─ filter bar (40px) ─────────────────────┐  │
│  ⌂ Today  12 │ │ /  __________________  10/847 match     │  │
│  ⏵ Open  847 │ ├──────────────────────────────────────────┤  │
│  ⏸ Snoozed 3 │ │ ▶ #84  ▶  luna-sns        auth fix      │  │
│  ✓ Done  240 │ │ · #87  ·  refscope        filter feat   │  │
│              │ │ · #91  ⏸  agent-skills    README        │  │
│  ── Repos    │ │ · ...                                    │  │
│  40 active   │ └──────────────────────────────────────────┘  │
│  8 dormant   │ ┌─ detail panel ───────────────────────────┐  │
│              │ │ #84  auth fix                             │  │
│  ── Contexts │ │ luna-sns / claude-code / priority 75      │  │
│  7 snapshots │ │                                            │  │
│              │ │ Files: src/auth/session.ts, ...           │  │
│  ── Source   │ │ Source: github_issue                       │  │
│  TODO   730  │ │ Last context: 2026-05-11                  │  │
│  Issue  68   │ │                                            │  │
│  Session 12  │ │ Body...                                    │  │
│              │ │                                            │  │
│              │ │ [Run]  [Snooze]  [Close]  [Copy CLI]      │  │
│              │ └──────────────────────────────────────────┘  │
│   v0.1.0    │                                                │
└──────────────┴───────────────────────────────────────────────┘
  sidebar (200px)    main + detail (split vertical or side-by-side)
```

レスポンシブ規則:
- `≥1280px`: list 右側に detail panel を並べる (split column)
- `<1280px`: detail panel を list の下に積む (stacked)
- `<768px`: 非対応 (Desktop 1280px+ 想定)

## 5. Component Catalog

| Component | Role |
|---|---|
| `Header` | logo、global sync button、settings |
| `Sidebar` | route nav + 集計 (Today / Open / Snoozed / Done / Repos / Contexts / Source breakdown) |
| `FilterBar` | live fuzzy search、件数表示、clear button |
| `TaskList` | rows: id / status marker / repo / assignee / title + match highlight |
| `TaskDetail` | full meta + body + action buttons |
| `StatPill` | サイドバーの件数表示 (number + label) |
| `RepoCard` | `#/repos` で使う、repo 名 + open件数 / 最近触った日 / age bar |
| `ContextTimeline` | `#/contexts` で使う、縦線 + ノード型タイムライン |
| `SyncStatus` | adapter ごとの ✓ / ✗ / 時刻 / 件数 |
| `Toast` | 操作後の通知 (snoozed #N, closed #N) |
| `Modal` | 確認 (close, reopen) |

## 6. Visual Language

### Palette tokens

実装は `web/nextjs/app/globals.css` の `:root` (default = dark) と
`:root[data-theme="..."]` のテーマブロック群で定義。値は **oklch** で記述し、
`color-mix()` を活用して半透明バリアントを派生させる。

| Token | Usage |
|---|---|
| `--color-bg` | base canvas |
| `--color-bg-elev` | cards, panels |
| `--color-bg-elev-2` | hover, active row, popovers |
| `--color-bg-overlay` | sticky header / dimmed bg layers |
| `--color-border` | dividers, card borders |
| `--color-border-strong` | emphasized borders (forms, selected) |
| `--color-ring` | focus ring (`box-shadow: 0 0 0 2px var(--color-ring)`) |
| `--color-fg` | primary text |
| `--color-fg-muted` | secondary text, meta |
| `--color-fg-dim` | tertiary, hints |
| `--color-accent` / `--color-accent-fg` | brand, primary CTA, in-progress |
| `--color-warm` | warnings, snoozed, dirty files |
| `--color-cool` | links, info, repo |
| `--color-critical` | errors, blocked, high priority |
| `--color-highlight` | fuzzy match indices, NEW badge background |
| `--shadow-soft` / `--shadow-elev` / `--shadow-pop` | depth ramp |
| `--radius` / `--radius-sm` | corner radii |

### Theme presets (18)

`<html data-theme="...">` で切り替え。`components/theme-provider.tsx` の
`Theme` union と `components/theme-picker.tsx` の `THEMES` 配列が SSOT。

| Group | Presets |
|---|---|
| Dark (default) | `dark`, `midnight`, `mist`, `matrix`, `nord`, `amber` |
| Dark / data-flavored | `ocean`, `blueprint` |
| Light | `light`, `paper`, `washi`, `sketch`, `notebook`, `sunset`, `solar`, `sakura` |
| Accessibility | `hc-dark`, `hc-light` (WCAG AAA, 純黒/純白 + 高彩度 accent) |

新着メッセージのハイライト (`.relay-fresh`) は `--color-accent` を
`color-mix(in oklch, var(--color-accent) 6-18%, transparent)` で薄め、
`prefers-reduced-motion: reduce` ではアニメーションを無効化してボーダー色のみ
残す。

### Typography

- **Headings**: `'IBM Plex Mono', 'JetBrains Mono', ui-monospace` — terminal-style mono
- **Body**: `'Inter', system-ui, -apple-system, sans-serif` — 読みやすさ
- **Code / IDs**: `'JetBrains Mono', ui-monospace`

Scale (base 14px):
- `xs` 11px / `sm` 12px / `base` 14px / `md` 16px / `lg` 20px / `xl` 28px / `2xl` 36px

### Spacing

`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64` (px) — 4の倍数のみ。

### Status Markers

| Status | Glyph | Color |
|---|---|---|
| `open` | `·` | text-muted |
| `in_progress` | `▶` | accent (mint) |
| `blocked` | `⊘` | accent-critical |
| `snoozed` | `⏸` | accent-warm |
| `done` | `✓` | text-muted |

### Source Type Badges

| Source | Badge color |
|---|---|
| `code_todo` | gray |
| `github_issue` | cool |
| `github_pr` | warm |
| `claude_session_todo` | accent |
| `agents_note` | dim |
| `manual` | white |

## 7. Interaction Patterns

### Selection
- Click a task row → highlight + open detail panel
- Keyboard: `j/k` to move, `Enter` toggles detail

### Filter
- Click filter bar or press `/` → focus the search input
- Live filter (every keystroke), no submit needed
- fzf-style fuzzy scorer in `web/nextjs/lib/fuzzy.ts`
- `Esc` clears + blurs

### Mutations
- Snooze / Close / Reopen: button → POST → optimistic update → toast
- Sync: header button → SSE progress stream → re-fetch counts
- Run: client-side cannot spawn; shows "Copy CLI" → `relay run 84`

### Navigation
- Sidebar items are anchors with hash routes; updating route updates view
- `Tab` cycles route in order (Today → Open → Snoozed → ...)

## 8. Empty / Error States

- **Empty Today**: "Nothing for today. Run `relay sync` to refresh." with CTA
- **Empty filter**: "No matches for '<query>'. Try fewer terms."
- **DB locked**: "DB locked. Another relay process is writing." with retry
- **Sync running**: progress bar with per-adapter status

## 9. Open Questions

- Q1: Web UI で `run` を実行可能にするか? → server 側で spawn してログを SSE で返せば可能だが、interactive な claude session には UX が合わない。**deep-link copy のみ**で v0.1 は十分か
- Q2: dark / light: dark のみで v0.1 出すか、最初から両対応するか → **dark のみ**で先行
- Q3: 文字 fuzzy のハイライトは title だけか、repo / assignee にも広げるか → v0.1 は title のみ
- Q4: charts (age histogram, repo breakdown) は v0.1 で必要か → 段階導入、まずは数字のみ
