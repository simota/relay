import { createHash } from "node:crypto";
import { gitSnapshot } from "../context/git.js";
import type { AdapterDB, SessionType } from "../types.js";

export function saveSessionContext(
  db: AdapterDB | undefined,
  input: {
    sessionType: SessionType;
    sessionId: string;
    repo: string;
    cwd: string;
    title: string | null;
    lastMessageText: string | null;
    status: string;
  },
): string | null {
  if (!db) return null;
  const snap = gitSnapshot(input.cwd);
  if (!snap) return null;

  const summary = buildSessionContextSummary(input);
  const hash = createHash("sha256")
    .update([
      "session-context",
      input.sessionType,
      input.sessionId,
      input.repo,
      snap.headSha,
      summary,
    ].join("\0"))
    .digest("hex");

  db.insertContext({
    hash,
    repo: input.repo,
    branch: snap.branch,
    headSha: snap.headSha,
    dirtyFiles: snap.dirtyFiles,
    summary,
    sessionId: input.sessionId,
    sessionType: input.sessionType,
  });

  return hash;
}

function buildSessionContextSummary(input: {
  sessionType: SessionType;
  sessionId: string;
  title: string | null;
  lastMessageText: string | null;
  status: string;
}): string {
  const label = input.sessionType === "codex" ? "Codex" : "Antigravity";
  const lines = [
    `${label} session ${input.sessionId}`,
    `status: ${input.status}`,
  ];
  const title = input.title?.trim();
  if (title) lines.push(`title: ${title}`);
  const last = input.lastMessageText?.trim();
  if (last && last !== title) lines.push(`last: ${last}`);
  return lines.join("\n");
}
