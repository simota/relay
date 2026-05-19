"use client";

import { useMemo, useState } from "react";
import type { SessionToolCall } from "@/lib/api";
import { computeDiffGlyph, type DiffKind } from "../_lib/args-diff";
import { shortTime } from "../_lib/format";
import { parseToolArgs } from "../_lib/tool-args";

const GLYPH_COLOR: Record<DiffKind, string> = {
  edit: "var(--color-accent)",
  write: "var(--color-cool)",
  read: "var(--color-fg-dim)",
  none: "var(--color-fg-dim)",
};

export function ToolCallsList({ calls }: { calls: SessionToolCall[] }) {
  if (calls.length === 0) {
    return (
      <p className="text-[13px] text-[var(--color-fg-dim)] py-6 text-center">no tool calls</p>
    );
  }
  return (
    <ul className="space-y-1.5 pt-3">
      {calls.map((tc, i) => (
        <ToolCallRow key={`${tc.timestamp}-${i}`} call={tc} />
      ))}
    </ul>
  );
}

function ToolCallRow({ call }: { call: SessionToolCall }) {
  const parsed = useMemo(
    () => parseToolArgs(call.name, call.args_json),
    [call.name, call.args_json],
  );
  const glyph = useMemo(
    () => computeDiffGlyph(call.name, call.args_json),
    [call.name, call.args_json],
  );
  const [showRaw, setShowRaw] = useState(false);
  return (
    <li className="rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 text-[11.5px] font-mono space-y-1">
      <div className="flex items-baseline gap-2">
        <span className="text-[var(--color-fg-dim)]">{shortTime(call.timestamp)}</span>
        <span className="text-[var(--color-accent)]">{call.name}</span>
        {parsed.headline && (
          <span className="text-[var(--color-fg)] truncate">{parsed.headline}</span>
        )}
        <span className="flex-1" />
        {glyph.label && (
          <span
            className="text-[10px] font-mono shrink-0"
            style={{ color: GLYPH_COLOR[glyph.kind] }}
            title={
              glyph.kind === "edit"
                ? `line delta ${glyph.label}`
                : glyph.kind === "write"
                  ? `wrote ${glyph.label} line${glyph.delta === 1 ? "" : "s"}`
                  : undefined
            }
          >
            {glyph.label}
          </span>
        )}
        {call.args_json && (
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-[10px] text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            {showRaw ? "hide raw" : "raw"}
          </button>
        )}
      </div>
      {parsed.fields.length > 0 && (
        <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-0.5 text-[11px] pl-3">
          {parsed.fields.map((f) => (
            <div key={f.key} className="contents">
              <dt className="text-[var(--color-fg-dim)]">{f.key}</dt>
              <dd className="text-[var(--color-fg)] break-all whitespace-pre-wrap">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {showRaw && call.args_json && (
        <pre className="text-[10.5px] text-[var(--color-fg-muted)] bg-[var(--color-bg-elev)] rounded-[var(--radius-sm)] p-2 overflow-x-auto whitespace-pre-wrap break-all">
          {call.args_json}
        </pre>
      )}
    </li>
  );
}
