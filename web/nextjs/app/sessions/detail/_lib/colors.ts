// Centralized color map for the session detail visualizations. Each accessor
// returns a string usable as `fill`/`stroke`/CSS color — same CSS variable
// references as the previous inline maps, so swapping to this module must be
// a no-op visually.

export type Lane = "user" | "assistant" | "tool" | "subagent" | "system";
export type Role = "user" | "assistant" | "tool" | "system";
export type RibbonState =
  | "active"
  | "waiting_for_user"
  | "interrupted"
  | "ended"
  | "idle";
export type TodoStatus = "completed" | "in_progress" | "pending";
export type FileOp = "read" | "write" | "edit";

export function getLaneColor(lane: Lane): string {
  switch (lane) {
    case "user":
      return "var(--color-accent)";
    case "assistant":
      return "var(--color-cool)";
    case "tool":
      return "var(--color-warm)";
    case "subagent":
      return "var(--color-cool)";
    case "system":
    default:
      return "var(--color-fg-dim)";
  }
}

export function getRoleColor(role: Role): string {
  switch (role) {
    case "user":
      return "var(--color-accent)";
    case "assistant":
      return "var(--color-cool)";
    case "tool":
      return "color-mix(in srgb, var(--color-fg-muted) 70%, transparent)";
    case "system":
    default:
      return "color-mix(in srgb, var(--color-fg-dim) 40%, transparent)";
  }
}

export function getStateColor(state: RibbonState): string {
  switch (state) {
    case "active":
      return "var(--color-accent)";
    case "waiting_for_user":
      return "var(--color-warm)";
    case "interrupted":
      return "var(--color-critical)";
    case "ended":
      return "var(--color-cool)";
    case "idle":
    default:
      return "color-mix(in srgb, var(--color-fg-dim) 35%, transparent)";
  }
}

export function getTodoStatusColor(s: TodoStatus): string {
  switch (s) {
    case "completed":
      return "var(--color-ok, var(--color-cool))";
    case "in_progress":
      return "var(--color-accent)";
    case "pending":
    default:
      return "var(--color-fg-dim)";
  }
}

export function getFileOpColor(op: FileOp): string {
  switch (op) {
    case "read":
      return "var(--color-cool)";
    case "write":
      return "var(--color-critical)";
    case "edit":
    default:
      return "var(--color-accent)";
  }
}

// FNV-1a-ish 32-bit hash → deterministic hue per tool name. Behaviour must
// match the previous tool-pie inline implementation byte-for-byte so existing
// charts don't shuffle colors on refactor.
function hueFor(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % 360;
}

export function getToolColor(name: string, _index?: number): string {
  if (name === "other") return "var(--color-fg-dim)";
  return `hsl(${hueFor(name)} 65% 55%)`;
}

// Generic density mapper for heatmap-style cells. `t` is a 0..1 intensity;
// values outside that range are clamped. `base` accepts any CSS color
// expression that color-mix can consume.
export function getDensityColor(t: number, base = "var(--color-accent)"): string {
  if (!Number.isFinite(t) || t <= 0) return "transparent";
  const clamped = Math.min(1, Math.max(0, t));
  const alpha = 0.18 + clamped * 0.82;
  return `color-mix(in srgb, ${base} ${(alpha * 100).toFixed(1)}%, transparent)`;
}

// SubagentTree intentionally renders `interrupted` muted (vs the state machine
// view that uses critical) — keep that asymmetry behind its own accessor so
// the divergence is documented.
export function getSubagentStatusColor(s: RibbonState): string {
  if (s === "interrupted") return "var(--color-fg-muted)";
  if (s === "ended") return "var(--color-fg-dim)";
  return getStateColor(s);
}
