"use client";

import type { SessionDetail } from "@/lib/api";
import { c } from "@/lib/copy";

export function TodosList({ todos }: { todos: SessionDetail["todos"] }) {
  if (todos.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)] py-6 text-center">
        {c("sessions.detail.noTodos")}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5 pt-3">
      {todos.map((t) => (
        <li
          key={t.id}
          className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 flex items-center gap-3 text-[13px]"
        >
          <StatusBadge status={t.status} />
          <span className="flex-1">{t.title}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "var(--color-ok, var(--color-cool))",
    in_progress: "var(--color-accent)",
    pending: "var(--color-fg-dim)",
  };
  return (
    <span
      className="font-mono text-[10.5px] uppercase tracking-wider w-24"
      style={{ color: colors[status] ?? "var(--color-fg-dim)" }}
    >
      {status}
    </span>
  );
}
