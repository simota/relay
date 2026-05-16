"use client";

import { useEffect, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { c } from "@/lib/copy";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useHotkeys } from "@/hooks/use-hotkeys";

const SEEN_KEY = "relay.cheatsheet.seen";

const GROUPS = [
  {
    title: c("cheatsheet.navigate"),
    items: [
      { keys: ["g", "t"], label: c("nav.today") },
      { keys: ["g", "o"], label: c("nav.openTasks") },
      { keys: ["g", "s"], label: c("nav.snoozed") },
      { keys: ["g", "d"], label: c("nav.done") },
      { keys: ["g", "r"], label: c("nav.repos") },
      { keys: ["g", "c"], label: c("nav.contexts") },
    ],
  },
  {
    title: c("cheatsheet.moveSelect"),
    items: [
      { keys: ["j"], label: c("cheatsheet.nextTask") },
      { keys: ["k"], label: c("cheatsheet.previousTask") },
      { keys: ["Enter"], label: c("cheatsheet.openSelected") },
      { keys: ["/"], label: c("cheatsheet.focusFilter") },
      { keys: ["Esc"], label: c("cheatsheet.clearOrClose") },
    ],
  },
  {
    title: c("cheatsheet.action"),
    items: [
      { keys: ["N"], label: c("cheatsheet.newTask") },
      { keys: ["g", "n"], label: c("cheatsheet.newTask") },
      { keys: ["⌘", "K"], label: c("command.menu") },
      { keys: ["?"], label: c("cheatsheet.dialog") },
    ],
  },
];

export function Cheatsheet() {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useFocusTrap(popoverRef, open);

  useHotkeys([
    {
      key: "Shift+?",
      handler: (event) => {
        event.preventDefault();
        popoverRef.current?.togglePopover();
      },
    },
  ]);

  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;

    const markSeen = () => {
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        // Storage can be unavailable in restricted browser contexts.
      }
    };

    const onToggle = () => {
      const isOpen = popover.matches(":popover-open");
      setOpen(isOpen);
      if (!isOpen) {
        markSeen();
      }
    };

    popover.addEventListener("toggle", onToggle);

    let shouldAutoOpen = false;
    try {
      shouldAutoOpen = localStorage.getItem(SEEN_KEY) !== "1";
    } catch {
      shouldAutoOpen = false;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (shouldAutoOpen) {
      timer = setTimeout(() => {
        let alreadySeen = false;
        try {
          alreadySeen = localStorage.getItem(SEEN_KEY) === "1";
        } catch {
          alreadySeen = true;
        }

        if (!alreadySeen && !popover.matches(":popover-open")) {
          popover.showPopover();
        }
      }, 3000);
    }

    return () => {
      if (timer) clearTimeout(timer);
      popover.removeEventListener("toggle", onToggle);
    };
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.isComposing) return;
      popoverRef.current?.hidePopover();
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open]);

  return (
    <div
      ref={popoverRef}
      popover="auto"
      role="dialog"
      aria-modal="true"
      aria-label={c("cheatsheet.dialog")}
      className="fixed left-1/2 top-16 z-50 w-[min(760px,calc(100vw-32px))] -translate-x-1/2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 text-[var(--color-fg)] shadow-[var(--shadow-pop)] backdrop:bg-[var(--color-bg)]/70"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold">{c("cheatsheet.title")}</h2>
          <p className="mt-0.5 text-[12px] text-[var(--color-fg-muted)]">{c("cheatsheet.subtitle")}</p>
        </div>
        <button
          type="button"
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
          onClick={() => popoverRef.current?.hidePopover()}
        >
          {c("common.close")}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {GROUPS.map((group) => (
          <section key={group.title} className="min-w-0">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-fg-dim)]">
              {group.title}
            </h3>
            <div className="space-y-1.5">
              {group.items.map((item) => (
                <div key={`${group.title}-${item.label}-${item.keys.join("-")}`} className="flex min-h-7 items-center justify-between gap-3">
                  <span className="truncate text-[12px] text-[var(--color-fg-muted)]">{item.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {item.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-4 border-t border-[var(--color-border)] pt-3 text-right text-[11px] text-[var(--color-fg-dim)]">
        {c("cheatsheet.footer")}
      </div>
    </div>
  );
}
