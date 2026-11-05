"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

/** Presets map to the server's `until` shorthands (see parseWhenInput). */
const PRESETS: ReadonlyArray<{ until: string; label: string }> = [
  { until: "+4h", label: "Later today (+4h)" },
  { until: "tomorrow", label: "Tomorrow" },
  { until: "+3d", label: "In 3 days" },
  { until: "next-week", label: "Next week (Mon)" },
  { until: "+2w", label: "In 2 weeks" },
];

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Split snooze button: the main half snoozes indefinitely (the `s` hotkey's
 * behavior), the chevron opens wake-date presets. A dated snooze reopens on
 * its own once the date passes.
 */
export function SnoozeMenu({
  onSnooze,
  disabled,
}: {
  onSnooze: (until?: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (until?: string) => {
    setOpen(false);
    void onSnooze(until);
  };

  return (
    <div ref={ref} className="relative inline-flex">
      <Button onClick={() => pick()} disabled={disabled} className="rounded-r-none">
        <Pause className="w-3 h-3" />
        Snooze
        <Kbd className="ml-1">s</Kbd>
      </Button>
      <Button
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Snooze until…"
        title="Snooze until… (⇧S = until tomorrow)"
        className="rounded-l-none border-l-0 px-1.5"
      >
        <ChevronDown className="w-3 h-3" />
      </Button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute z-20 left-0 bottom-full mb-1 min-w-[210px]",
            "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]",
            "shadow-lg py-1 text-[12px]",
          )}
        >
          <div className="px-3 pt-1 pb-1.5 text-[10.5px] uppercase tracking-wider text-[var(--color-fg-dim)] font-medium">
            reopens automatically
          </div>
          {PRESETS.map((p) => (
            <button
              key={p.until}
              type="button"
              role="menuitem"
              onClick={() => pick(p.until)}
              className="block w-full text-left px-3 py-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-fg)] focus-visible:bg-[var(--color-bg-elev)] focus-visible:outline-none"
            >
              {p.label}
            </button>
          ))}
          <form
            className="flex items-center gap-1.5 px-3 py-1.5 border-t border-[var(--color-border)] mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (date) pick(date);
            }}
          >
            <input
              type="date"
              value={date}
              min={tomorrowIso()}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Snooze until date"
              className="flex-1 min-w-0 bg-transparent border border-[var(--color-border)] rounded-[var(--radius-sm)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-fg)]"
            />
            <Button type="submit" size="sm" disabled={!date} className="h-6 px-2">
              Set
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
