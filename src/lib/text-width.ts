// Terminal display-width helpers. CJK / fullwidth characters render as two
// columns, but String.padEnd counts code points — tables containing Japanese
// repo names or titles drift out of alignment without this correction.

const WIDE_CHAR =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

export function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) width += WIDE_CHAR.test(ch) ? 2 : 1;
  return width;
}

export function padEndDisplay(s: string, width: number): string {
  const pad = width - displayWidth(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}

/** Cut `s` to at most `width` display columns, ending with "…" when cut. */
export function truncateDisplay(s: string, width: number): string {
  if (displayWidth(s) <= width) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    const w = WIDE_CHAR.test(ch) ? 2 : 1;
    if (used + w > width - 1) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
}
