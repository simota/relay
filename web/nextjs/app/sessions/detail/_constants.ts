import type { SessionType } from "@/lib/api";

export const VALID_TYPES: ReadonlyArray<SessionType> = ["claude", "codex", "gemini"];
export const MAX_TILES = 6;

export const COLLAPSE_LINE_THRESHOLD = 20;
export const COLLAPSE_CHAR_THRESHOLD = 2_000;
