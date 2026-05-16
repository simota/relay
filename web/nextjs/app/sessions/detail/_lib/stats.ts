import type { SessionMessage } from "@/lib/api";

export function computeStats(
  messages: SessionMessage[],
): { user: number; assistant: number; tool: number; system: number } {
  const acc = { user: 0, assistant: 0, tool: 0, system: 0 };
  for (const m of messages) {
    if (m.role in acc) acc[m.role as keyof typeof acc]++;
  }
  return acc;
}
