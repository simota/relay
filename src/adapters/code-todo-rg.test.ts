// Runs the real `rg` (unlike code-todo.test.ts, which stubs it) to cover
// how its JSON output is decoded.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterContext } from "../types.js";
import { codeTodoAdapter } from "./code-todo.js";

const hasRg = !spawnSync("rg", ["--version"]).error;
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "relay-rg-real-"));
  mkdirSync(join(root, "demo"), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasRg)("code_todo with real rg", () => {
  test("a non-UTF-8 line neither fails the adapter nor drops other TODOs", async () => {
    writeFileSync(join(root, "demo", "a.ts"), "// TODO: plain one\n");
    // 0xE9 is Latin-1 "é": rg reports this line as base64 `bytes`.
    writeFileSync(join(root, "demo", "b.c"), Buffer.from("/* \xe9 */ // TODO: fix later\n", "latin1"));
    try {
      const tasks = await codeTodoAdapter.fetch({ roots: [root], exclude: [] } as unknown as AdapterContext);
      expect(tasks.map((t) => t.title).sort()).toEqual(["fix later", "plain one"]);
    } finally {
      rmSync(join(root, "demo", "a.ts"));
      rmSync(join(root, "demo", "b.c"));
    }
  });

  test("multi-byte titles survive stdout chunk boundaries", async () => {
    // ~6 MB of rg JSON: several pipe chunks, whose boundaries land inside
    // 3-byte characters unless decoding is streaming-aware.
    const lines = Array.from({ length: 20000 }, (_, i) => `// TODO: 日本語のタスク番号${i}を確認する`);
    writeFileSync(join(root, "demo", "ja.ts"), `${lines.join("\n")}\n`);
    const tasks = await codeTodoAdapter.fetch({ roots: [root], exclude: [] } as unknown as AdapterContext);
    expect(tasks.length).toBe(20000);
    expect(tasks.filter((t) => t.title.includes("�"))).toEqual([]);
  });
});
