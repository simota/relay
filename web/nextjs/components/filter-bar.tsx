"use client";

import { Save, Search, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { c, formatNumber } from "@/lib/copy";

interface FilterBarProps {
  value: string;
  onChange: (v: string) => void;
  matched: number;
  total: number;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onSaveView?: () => void;
  savingView?: boolean;
}

export function FilterBar({ value, onChange, matched, total, inputRef, onSaveView, savingView }: FilterBarProps) {
  return (
    <div className="flex items-center gap-3 px-5 h-11 border-b border-[var(--color-border)]">
      <Search className="w-3.5 h-3.5 text-[var(--color-fg-dim)] shrink-0" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="repo:foo status:open age>7 source:code_todo title"
        className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[var(--color-fg-dim)] font-mono"
      />
      <span className="text-[11px] text-[var(--color-fg-dim)] whitespace-nowrap">
        {c("tasks.filterHint")} <Kbd>/</Kbd> {c("tasks.filterSuffix")}
      </span>
      <span className="tabular text-[11px] text-[var(--color-fg-dim)]">
        {value ? `${formatNumber(matched)}/${formatNumber(total)}` : formatNumber(total)}
      </span>
      {onSaveView && (
        <button
          type="button"
          onClick={onSaveView}
          disabled={savingView}
          title={c("common.saveCurrentAsView")}
          className="h-7 px-2 inline-flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[11.5px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-elev-2)] disabled:opacity-50 disabled:pointer-events-none transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{c("common.saveCurrentAsView")}</span>
        </button>
      )}
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </div>
  );
}
