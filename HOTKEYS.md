# relay — Hotkeys

Web UI (`relay web`) のキーバインド一覧。
vim 風の g-leader sequence でナビゲーション、選択中タスクには単キーアクション。

CLI コマンドの早見表は [CHEATSHEET.md](./CHEATSHEET.md)、インストール手順は [INSTALL.md](./INSTALL.md) を参照。

## Navigation (g-leader)

Press `g`, then within 1.5 s press the second key.

| Sequence | Goes to |
|---|---|
| `g t` | Today |
| `g a` | Agenda |
| `g o` | Open tasks |
| `g s` | Snoozed |
| `g d` | Done |
| `g r` | Repos |
| `g c` | Contexts |
| `g n` | New task dialog |
| `g v` | View original session for the selected task (clickable link in task detail) |

Single-key aliases:

| Key | Action |
|---|---|
| `n` | New task |
| `⌘K` / `Ctrl+K` | Command palette |

## List movement

| Key | Action |
|---|---|
| `j` / `↓` | next task |
| `k` / `↑` | previous task |

## Filter

| Key | Action |
|---|---|
| `/` | focus filter input |
| type | fuzzy filter (live) |
| `Esc` | cancel / clear filter |

Filter is available on **every tab**. On Repos it matches repo
names; on Contexts it matches across repo, branch, hash, and summary.

## Selected-task actions

| Key | Action |
|---|---|
| `r` | copy `relay run N` to clipboard |
| `s` | snooze |
| `c` | close (mark done) |
| `o` | reopen |
| `a` | click the assignee row to change |
| `n` | new task form (repo / title / assignee). Tab to switch field, Enter to create, Esc to cancel |

## Drill-down (Repos / Contexts → Open)

| Action | How |
|---|---|
| Drill to Open scoped by repo | click RepoCard |
| Drill to Open scoped by repo | click ContextItem |

Both surfaces jump to **Open** filtered to the row's repo. Lets you go
from "which repos are noisy?" to "what exactly is in that repo?" in
one click.

## System

| Key | Action |
|---|---|
| `R` | sync (re-fetch sources) — also `↻ sync` in header |
| `⌘K` | command palette |

## Tips

- g-leader and `n` are blocked while typing into an input or textarea (the page filter, new-task dialog, etc.).
- The command palette (`⌘K`) is the fastest way to discover what's available — start typing.
