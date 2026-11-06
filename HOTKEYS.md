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
| `g v` | View original session for the selected task (Today / Tasks; also a clickable link in task detail) |

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
| `Shift+J` / `Shift+K` | extend range selection down / up |

## Filter

| Key | Action |
|---|---|
| `/` | focus filter input |
| type | fuzzy filter (live) |
| `Esc` | cancel / clear filter |

Filter is available on **every tab**. On Repos it matches repo
names; on Contexts it matches across repo, branch, hash, and summary.

On the Tasks tab the filter also understands field terms, which combine
with fuzzy title text:

| Term | Matches |
|---|---|
| `repo:x` / `source:code_todo` / `status:open` | exact field |
| `age>7` / `age<3` | created more / fewer than N days ago |
| `tag:billing` (`tag:a,b` = either) | tasks carrying the tag |
| `is:blocked` / `is:ready` | waiting / not waiting on an unfinished dependency |

`?filter=` in the URL pre-fills the box (Today's "⛓ N waiting on
dependencies" link uses `is:blocked`).

## Selected-task actions

| Key | Action |
|---|---|
| `r` | copy `relay run N` to clipboard |
| `s` | snooze (indefinitely; the detail panel's ▾ menu picks a wake date) |
| `Shift+S` | snooze until tomorrow — reopens on its own |
| `e` | edit the task inline (title / priority / due / wait on / prompt / files / body). `⌘↵` saves, `Esc` cancels. Edited fields stay across sync |
| `c` | close (mark done) |
| `o` | reopen |
| `a` | add the selected task (or every multi-selected task) to the run queue |
| `b` | open the bulk-action bar for the selection (`s` snooze / `c` close / `a` queue / `Esc` cancel; the bar's "assign…" menu hands the selection to one agent) |
| `n` | new task form (repo / title / assignee). Tab to switch field, Enter to create, Esc to cancel |

Assignee is changed by clicking the assignee row in the task detail panel.

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
| `u` | undo the most recent snooze/close toast |
| `⌘Z` / `⇧⌘Z` | undo / redo via the server undo log (covers edits too) — CLI: `relay undo [--redo]` |
| `⌘Z` / `Ctrl+Z` | undo last operation |
| `⌘⇧Z` / `Ctrl+Shift+Z` | redo |
| `⌘K` | command palette |

## Tips

- g-leader and `n` are blocked while typing into an input or textarea (the page filter, new-task dialog, etc.).
- The command palette (`⌘K`) is the fastest way to discover what's available — start typing.
