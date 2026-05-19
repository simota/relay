"use client";

import type { SessionDetail } from "@/lib/api";
import { c } from "@/lib/copy";
import { getTodoStatusColor, type TodoStatus } from "../_lib/colors";
import { TodoProgressDonut } from "./todo-progress-donut";

function isTodoStatus(s: string): s is TodoStatus {
  return s === "completed" || s === "in_progress" || s === "pending";
}

export function TodosList({ todos }: { todos: SessionDetail["todos"] }) {
  if (todos.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)] py-6 text-center">
        {c("sessions.detail.noTodos")}
      </p>
    );
  }
  return (
    <div className="pt-3">
      <div className="mb-3">
        <TodoProgressDonut todos={todos} />
      </div>
      <ul className="space-y-1.5">
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
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = isTodoStatus(status) ? getTodoStatusColor(status) : "var(--color-fg-dim)";
  return (
    <span
      className="font-mono text-[10.5px] uppercase tracking-wider w-24"
      style={{ color }}
    >
      {status}
    </span>
  );
}
