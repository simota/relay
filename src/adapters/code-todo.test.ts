import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterContext } from "../types.js";
import { codeTodoAdapter } from "./code-todo.js";

let tmp: string;
const originalPath = process.env.PATH;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "relay-rg-"));
  mkdirSync(join(tmp, "root", "demo"), { recursive: true });
  // Stand-in for `rg` hitting one unreadable directory: it still prints
  // the matches it found, then exits 2.
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  const match = {
    type: "match",
    data: {
      path: { text: join(tmp, "root", "demo", "a.ts") },
      line_number: 3,
      lines: { text: "// TODO: keep me" },
      submatches: [],
    },
  };
  writeFileSync(join(bin, "rg"), `#!/bin/sh\necho '${JSON.stringify(match)}'\nexit 2\n`);
  chmodSync(join(bin, "rg"), 0o755);
  process.env.PATH = `${bin}:${originalPath}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
  rmSync(tmp, { recursive: true, force: true });
});

describe("code_todo", () => {
  test("keeps the matches of a scan that hit an unreadable path", async () => {
    const logs: string[] = [];
    const ctx = { roots: [join(tmp, "root")], exclude: [], log: (m: string) => logs.push(m) } as AdapterContext;
    const tasks = await codeTodoAdapter.fetch(ctx);
    expect(tasks.map((t) => [t.repo, t.title])).toEqual([["demo", "keep me"]]);
    expect(logs.length).toBe(1);
  });
});
