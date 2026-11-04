// Regression guard for the theme tokens in app/globals.css.
//
// Every theme must keep its text tokens readable (WCAG 2.1 AA, 1.4.3 / 1.4.11),
// and the theme picker swatches must match the tokens they preview.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { THEMES } from "../components/theme-picker";

const CSS = readFileSync(join(import.meta.dir, "..", "app", "globals.css"), "utf8");

type Linear = [number, number, number];

function oklchToLinear(L: number, C: number, H: number): Linear {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function parseColor(value: string): Linear | null {
  const v = value.trim();
  const ok = v.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (ok) return oklchToLinear(Number(ok[1]), Number(ok[2]), Number(ok[3]));
  const rgb = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)/);
  if (rgb) return [srgbToLinear(Number(rgb[1])), srgbToLinear(Number(rgb[2])), srgbToLinear(Number(rgb[3]))];
  return null;
}

function contrast(a: Linear, b: Linear): number {
  const lum = (c: Linear) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** theme id → token name (without `--`) → raw value. `@theme` is "dark". */
function readThemes(): Map<string, Record<string, string>> {
  const themes = new Map<string, Record<string, string>>();
  let base: Record<string, string> = {};
  const blockRe = /(@theme|:root\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g;
  for (const block of CSS.matchAll(blockRe)) {
    const id = block[2] ?? "dark";
    const vars: Record<string, string> = { ...base };
    for (const decl of (block[3] ?? "").matchAll(/--([\w-]+):\s*([^;]+);/g)) {
      vars[decl[1]!] = decl[2]!.trim();
    }
    if (!block[2]) base = vars;
    themes.set(id, vars);
  }
  return themes;
}

// [foreground token, background token, minimum ratio]
// Text tokens use the 4.5:1 body-text threshold because they render
// 10–13px labels; accent / warm are used for large numerals, icons and
// borders, so they use the 3:1 non-text threshold.
const PAIRS: Array<[string, string, number]> = [
  ["color-fg", "color-bg", 4.5],
  ["color-fg", "color-bg-elev", 4.5],
  ["color-fg-muted", "color-bg", 4.5],
  ["color-fg-muted", "color-bg-elev", 4.5],
  ["color-fg-dim", "color-bg", 4.5],
  ["color-fg-dim", "color-bg-elev", 4.5],
  ["color-accent-fg", "color-accent", 4.5],
  ["color-critical", "color-bg", 4.5],
  ["color-cool", "color-bg", 4.5],
  ["color-accent", "color-bg", 3],
  ["color-warm", "color-bg", 3],
];

const themes = readThemes();

describe("theme tokens", () => {
  test("every theme picker entry has a token block", () => {
    for (const theme of THEMES) expect(themes.has(theme.id)).toBe(true);
  });

  for (const [id, vars] of themes) {
    test(`${id}: text and UI tokens meet WCAG AA contrast`, () => {
      const failures: string[] = [];
      for (const [fg, bg, min] of PAIRS) {
        const a = parseColor(vars[fg] ?? "");
        const b = parseColor(vars[bg] ?? "");
        if (!a || !b) {
          failures.push(`${fg}/${bg}: unparseable`);
          continue;
        }
        const ratio = contrast(a, b);
        if (ratio < min) failures.push(`${fg} on ${bg} = ${ratio.toFixed(2)} (< ${min})`);
      }
      expect(failures).toEqual([]);
    });
  }

  test("theme picker swatches match globals.css [bg, fg, accent, warm]", () => {
    for (const theme of THEMES) {
      const vars = themes.get(theme.id)!;
      expect(theme.dots).toEqual([
        vars["color-bg"]!,
        vars["color-fg"]!,
        vars["color-accent"]!,
        vars["color-warm"]!,
      ]);
    }
  });

  test("semantic aliases used by components are defined", () => {
    expect(CSS).toMatch(/--color-danger:\s*var\(--color-critical\)/);
    expect(CSS).toMatch(/--color-warn:\s*var\(--color-warm\)/);
  });
});
