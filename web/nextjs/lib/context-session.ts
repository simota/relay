import type { RelayContext, SessionType } from "@/lib/types";

export function contextSessionType(ctx: Pick<RelayContext, "sessionId" | "sessionType">): SessionType | null {
  if (ctx.sessionType) return ctx.sessionType;
  return ctx.sessionId ? "claude" : null;
}

export function contextSessionLabel(type: SessionType | null): string {
  switch (type) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "antigravity":
      return "Antigravity";
    case "cursor":
      return "Cursor";
    default:
      return "Session";
  }
}

export function contextSessionHref(ctx: Pick<RelayContext, "sessionId" | "sessionType">): string | null {
  const type = contextSessionType(ctx);
  if (!type || !ctx.sessionId) return null;
  return `/sessions?type=${type}&id=${encodeURIComponent(ctx.sessionId)}`;
}
