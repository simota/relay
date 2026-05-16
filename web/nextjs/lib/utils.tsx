import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { c, formatNumber } from "@/lib/copy";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return c("common.now");
  if (mins < 60) return `${formatNumber(mins)}m`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${formatNumber(h)}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${formatNumber(d)}d`;
  return `${formatNumber(Math.round(d / 30))}mo`;
}

export function highlight(text: string, indices: number[]): React.ReactNode[] {
  if (!indices.length) return [text];
  const set = new Set(indices);
  const out: React.ReactNode[] = [];
  let buf = "";
  let isHL: boolean | null = null;
  const flush = (key: number) => {
    if (!buf) return;
    out.push(isHL ? <mark className="fuzz" key={key}>{buf}</mark> : buf);
    buf = "";
  };
  for (let i = 0; i < text.length; i++) {
    const hl = set.has(i);
    if (isHL === null) { isHL = hl; buf = text[i]!; continue; }
    if (hl === isHL) buf += text[i]!;
    else { flush(out.length); isHL = hl; buf = text[i]!; }
  }
  flush(out.length);
  return out;
}
