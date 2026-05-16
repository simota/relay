"use client";

import {
  Accessibility,
  BookOpen,
  Brush,
  Check,
  CloudMoon,
  Coffee,
  Contrast,
  Flower,
  Highlighter,
  type LucideIcon,
  Moon,
  MoonStar,
  Notebook as NotebookIcon,
  Ruler,
  Snowflake,
  Sun,
  Sunset,
  Terminal,
  Tv,
  Waves,
} from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { type Theme, useTheme } from "@/components/theme-provider";
import { c, type CopyKey } from "@/lib/copy";
import { cn } from "@/lib/utils";

type ThemeMeta = {
  id: Theme;
  labelKey: CopyKey;
  icon: LucideIcon;
  // [bg, fg, accent, warm] — hardcoded so the dots render in the *theme's*
  // colors regardless of which theme is currently applied to <html>.
  dots: [string, string, string, string];
};

export const THEMES: ThemeMeta[] = [
  {
    id: "dark",
    labelKey: "common.dark",
    icon: Moon,
    dots: [
      "oklch(0.145 0.005 240)",
      "oklch(0.95 0.005 240)",
      "oklch(0.85 0.18 145)",
      "oklch(0.82 0.14 60)",
    ],
  },
  {
    id: "light",
    labelKey: "common.light",
    icon: Sun,
    dots: [
      "rgb(255 255 255)",
      "rgb(31 35 40)",
      "rgb(26 127 55)",
      "rgb(191 135 0)",
    ],
  },
  {
    id: "sunset",
    labelKey: "common.sunset",
    icon: Sunset,
    dots: [
      "oklch(0.96 0.02 70)",
      "oklch(0.25 0.04 50)",
      "oklch(0.72 0.20 35)",
      "oklch(0.78 0.15 80)",
    ],
  },
  {
    id: "matrix",
    labelKey: "common.matrix",
    icon: Terminal,
    dots: [
      "oklch(0.10 0.01 140)",
      "oklch(0.88 0.20 140)",
      "oklch(0.85 0.28 140)",
      "oklch(0.78 0.15 75)",
    ],
  },
  {
    id: "ocean",
    labelKey: "common.ocean",
    icon: Waves,
    dots: [
      "oklch(0.16 0.04 240)",
      "oklch(0.93 0.02 220)",
      "oklch(0.84 0.16 195)",
      "oklch(0.74 0.18 5)",
    ],
  },
  {
    id: "notebook",
    labelKey: "common.notebook",
    icon: NotebookIcon,
    dots: [
      "oklch(0.94 0.04 90)",
      "oklch(0.22 0.04 270)",
      "oklch(0.56 0.21 25)",
      "oklch(0.78 0.16 90)",
    ],
  },
  {
    id: "blueprint",
    labelKey: "common.blueprint",
    icon: Ruler,
    dots: [
      "oklch(0.26 0.10 250)",
      "oklch(0.93 0.01 90)",
      "oklch(0.86 0.16 90)",
      "oklch(0.78 0.15 60)",
    ],
  },
  {
    id: "washi",
    labelKey: "common.washi",
    icon: Brush,
    dots: [
      "oklch(0.92 0.04 80)",
      "oklch(0.18 0.02 60)",
      "oklch(0.55 0.18 25)",
      "oklch(0.65 0.14 75)",
    ],
  },
  {
    id: "sketch",
    labelKey: "common.sketch",
    icon: Highlighter,
    dots: [
      "oklch(0.985 0.003 0)",
      "oklch(0.20 0.005 0)",
      "oklch(0.62 0.21 20)",
      "oklch(0.62 0.16 150)",
    ],
  },
  {
    id: "midnight",
    labelKey: "common.midnight",
    icon: MoonStar,
    dots: [
      "oklch(0 0 0)",
      "oklch(0.86 0.02 60)",
      "oklch(0.78 0.14 70)",
      "oklch(0.74 0.13 50)",
    ],
  },
  {
    id: "mist",
    labelKey: "common.mist",
    icon: CloudMoon,
    dots: [
      "oklch(0.22 0.025 280)",
      "oklch(0.90 0.018 280)",
      "oklch(0.78 0.10 320)",
      "oklch(0.82 0.10 50)",
    ],
  },
  {
    id: "solar",
    labelKey: "common.solar",
    icon: Coffee,
    dots: [
      "oklch(0.96 0.025 90)",
      "oklch(0.40 0.025 220)",
      "oklch(0.60 0.13 195)",
      "oklch(0.68 0.14 65)",
    ],
  },
  {
    id: "paper",
    labelKey: "common.paper",
    icon: BookOpen,
    dots: [
      "oklch(0.97 0 0)",
      "oklch(0.12 0 0)",
      "oklch(0.20 0 0)",
      "oklch(0.32 0 0)",
    ],
  },
  {
    id: "nord",
    labelKey: "common.nord",
    icon: Snowflake,
    dots: [
      "oklch(0.27 0.020 250)",
      "oklch(0.93 0.010 220)",
      "oklch(0.78 0.10 220)",
      "oklch(0.78 0.12 30)",
    ],
  },
  {
    id: "sakura",
    labelKey: "common.sakura",
    icon: Flower,
    dots: [
      "oklch(0.97 0.012 15)",
      "oklch(0.30 0.040 25)",
      "oklch(0.62 0.16 150)",
      "oklch(0.72 0.14 20)",
    ],
  },
  {
    id: "amber",
    labelKey: "common.amber",
    icon: Tv,
    dots: [
      "oklch(0.10 0.005 60)",
      "oklch(0.84 0.16 75)",
      "oklch(0.92 0.18 80)",
      "oklch(0.78 0.14 55)",
    ],
  },
  {
    id: "hc-dark",
    labelKey: "common.hcDark",
    icon: Contrast,
    dots: [
      "oklch(0 0 0)",
      "oklch(1 0 0)",
      "oklch(0.90 0.22 105)",
      "oklch(0.78 0.20 220)",
    ],
  },
  {
    id: "hc-light",
    labelKey: "common.hcLight",
    icon: Accessibility,
    dots: [
      "oklch(1 0 0)",
      "oklch(0 0 0)",
      "oklch(0.45 0.22 260)",
      "oklch(0.45 0.20 50)",
    ],
  },
];

export function getThemeMeta(theme: Theme): ThemeMeta {
  // Non-null: THEMES covers every Theme literal; .find never returns undefined.
  return THEMES.find((t) => t.id === theme) ?? THEMES[0]!;
}

interface ThemePickerProps {
  open: boolean;
  onClose: () => void;
  // Trigger element so outside-click can exclude the toggle button itself
  // (otherwise toggling the trigger immediately reopens-then-closes).
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  menuId: string;
}

export function ThemePicker({ open, onClose, triggerRef, menuId }: ThemePickerProps) {
  const { theme, setTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Outside click + ESC. Bound only while open so we don't leak listeners.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, triggerRef]);

  // Focus the current theme's row when the popover opens so screen reader and
  // keyboard users land on the active selection.
  useEffect(() => {
    if (!open) return;
    const currentIdx = THEMES.findIndex((t) => t.id === theme);
    const target = itemRefs.current[currentIdx >= 0 ? currentIdx : 0];
    target?.focus();
  }, [open, theme]);

  if (!open) return null;

  const handleItemKey = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = (idx + 1) % THEMES.length;
      itemRefs.current[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = (idx - 1 + THEMES.length) % THEMES.length;
      itemRefs.current[prev]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemRefs.current[THEMES.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      id={menuId}
      role="menu"
      aria-label="Theme picker"
      className="absolute bottom-[calc(100%+6px)] left-0 z-50 w-[240px] rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elev)] shadow-pop p-1"
    >
      {THEMES.map((t, idx) => {
        const Icon = t.icon;
        const selected = theme === t.id;
        const label = c(t.labelKey);
        return (
          <button
            key={t.id}
            ref={(el) => {
              itemRefs.current[idx] = el;
            }}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              setTheme(t.id);
              onClose();
            }}
            onKeyDown={(e) => handleItemKey(e, idx)}
            className={cn(
              "group flex w-full items-center gap-2 px-2 h-8 rounded-[var(--radius)] text-left text-[12.5px] ring-focus transition-colors",
              selected
                ? "bg-[var(--color-bg-elev-2)] text-[var(--color-fg)]"
                : "text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-elev-2)] hover:text-[var(--color-fg)]",
            )}
            title={c("common.switchTheme", { theme: label })}
          >
            <Icon
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                selected ? "text-[var(--color-accent)]" : "opacity-80",
              )}
              aria-hidden
            />
            <span className="flex-1 truncate capitalize">{label}</span>
            <span className="flex items-center gap-0.5" aria-hidden>
              {t.dots.map((color, i) => (
                <span
                  key={i}
                  className="w-2.5 h-2.5 rounded-full border border-[var(--color-border)]"
                  style={{ backgroundColor: color }}
                />
              ))}
            </span>
            <Check
              className={cn(
                "h-3 w-3 shrink-0 text-[var(--color-accent)]",
                selected ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

// Convenience hook for sidebar: a stable menu id per mount.
export function useThemeMenuId(): string {
  const id = useId();
  return `theme-menu-${id.replace(/:/g, "")}`;
}
