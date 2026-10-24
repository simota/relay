// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { RelayDB } from "../db/client.js";
import { RELAY_HOME } from "../paths.js";
import { runImport } from "./import.js";

describe("relay import", () => {
  test("reads a CSV export that starts with a UTF-8 BOM", () => {
    const file = join(RELAY_HOME, "notion-bom.csv");
    writeFileSync(file, "﻿Name,Status\nBOM header row,Todo\n");
    runImport({ from: "notion", file, repo: "bom-repo" });
    const db = new RelayDB();
    const titles = db.listTasks({ repo: "bom-repo" }).map((t) => t.title);
    db.close();
    expect(titles).toEqual(["BOM header row"]);
  });
});
