import { spawnSync } from "node:child_process";

// `gh auth status` is a blocking spawn that validates the token against
// GitHub, and every gh-backed adapter's precheck runs it. runSync calls the
// prechecks back to back on the event loop, so one sync used to pay for up
// to eight serial probes of the same state. Reusing a result for a few
// seconds collapses that burst into one probe while any later sync — or a
// Web sync a moment later — still sees fresh auth state.
const PROBE_TTL_MS = 5_000;

export interface GhAuthProbe {
  error?: Error;
  status: number | null;
  stdout: string;
  stderr: string;
}

let cached: { at: number; probe: GhAuthProbe } | null = null;

function spawnProbe(): GhAuthProbe {
  const res = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
  return {
    error: res.error,
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

export function ghAuthStatus(
  now: number = Date.now(),
  probeFn: () => GhAuthProbe = spawnProbe,
): GhAuthProbe {
  if (cached && now - cached.at >= 0 && now - cached.at < PROBE_TTL_MS) return cached.probe;
  const probe = probeFn();
  cached = { at: now, probe };
  return probe;
}

/** True when `gh auth status` exits 0 (same test every adapter applied). */
export function ghAuthenticated(): boolean {
  const probe = ghAuthStatus();
  return !probe.error && probe.status === 0;
}

/** Test hook: forget the memoized probe. */
export function resetGhAuthStatusCache(): void {
  cached = null;
}
