#!/usr/bin/env bash
# Deterministic fixture for the SQI UI measurements (quality/SQI-REPORT.md).
# Usage: quality/scripts/seed-fixture.sh <throwaway RELAY_HOME>
# Never point this at ~/.relay: it deletes the target directory first.
set -euo pipefail
H=${1:?usage: seed-fixture.sh <throwaway RELAY_HOME>}
case "$H" in "$HOME/.relay"|"$HOME/.relay/") echo "refusing to overwrite ~/.relay" >&2; exit 1;; esac
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
rm -rf "$H"; mkdir -p "$H/repos/alpha" "$H/repos/beta-service"
export RELAY_HOME=$H
cd "$REPO_ROOT"
bun run src/cli.ts init >/dev/null 2>&1 || true
sed -i.bak "s|^roots = .*|roots = [\"$H/repos\"]|" "$H/config.toml" && rm -f "$H/config.toml.bak"
add() { bun run src/cli.ts add "$@" >/dev/null; }
add --repo alpha --title "Fix flaky login retry" --assignee claude-code --priority 90 --due 2026-11-01 --body "Retry loop never backs off."
add --repo alpha --title "Write migration guide for v2 config" --assignee self --priority 60
add --repo alpha --title "Refactor session parser into pure functions" --assignee codex --priority 70 --prompt "Split parse() into tokenize/normalize"
add --repo beta-service --title "Investigate P99 latency spike on /search" --assignee human-review --priority 80 --due 2026-11-10
add --repo beta-service --title "Add pagination to admin list" --assignee antigravity --priority 40
add --repo beta-service --title "Update dependencies" --assignee self --priority 20
bun run src/cli.ts close 6 >/dev/null
bun run src/cli.ts snooze 5 >/dev/null
echo "seeded $H"
