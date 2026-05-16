"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Theme =
  | "dark"
  | "light"
  | "sunset"
  | "matrix"
  | "ocean"
  | "notebook"
  | "blueprint"
  | "washi"
  | "sketch"
  | "paper"
  | "mist"
  | "midnight"
  | "solar"
  | "nord"
  | "sakura"
  | "amber"
  | "hc-dark"
  | "hc-light";

const KNOWN_THEMES: ReadonlySet<Theme> = new Set([
  "dark",
  "light",
  "sunset",
  "matrix",
  "ocean",
  "notebook",
  "blueprint",
  "washi",
  "sketch",
  "paper",
  "mist",
  "midnight",
  "solar",
  "nord",
  "sakura",
  "amber",
  "hc-dark",
  "hc-light",
]);

interface ThemeContextValue {
  theme: Theme;
  setTheme: (name: Theme) => void;
}

const STORAGE_KEY = "relay.theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read the theme synchronously on the client from the data attribute set
  // by the inline script in layout.tsx (which runs before React hydrates).
  // On SSR the document object is unavailable, so we default to "dark" —
  // consumers must use `suppressHydrationWarning` or wait for hydration on
  // theme-dependent text. The inline script ensures the actual DOM matches.
  const [theme, setTheme] = useState<Theme>(() => readInitialTheme());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore (private mode, etc.)
    }
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme: (name: Theme) => setTheme(name),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function readInitialTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.dataset.theme;
  if (attr && (KNOWN_THEMES as ReadonlySet<string>).has(attr)) {
    return attr as Theme;
  }
  return "dark";
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
