// First import: guarantees a throwaway RELAY_HOME even when bunfig.toml's
// preload is skipped (e.g. `bun test` started from a subdirectory).
import "../test-setup.js";
import { describe, expect, test } from "bun:test";
import { RelayDB } from "./client.js";

describe("RelayDB connection lifecycle", () => {
  test("`using` closes the connection when the block throws", () => {
    let leaked: RelayDB | undefined;
    expect(() => {
      using db = new RelayDB();
      leaked = db;
      db.getTask(1); // connection is usable inside the block
      throw new Error("query failed");
    }).toThrow("query failed");
    // Closed: any further query fails instead of holding a WAL handle open.
    expect(() => leaked!.getTask(1)).toThrow();
  });

  test("`using` closes the connection on an early return", () => {
    let leaked: RelayDB | undefined;
    const run = (): string => {
      using db = new RelayDB();
      leaked = db;
      if (db.getTask(-1) === null) return "not found";
      return "found";
    };
    expect(run()).toBe("not found");
    expect(() => leaked!.getTask(1)).toThrow();
  });

  test("close() is idempotent, so an explicit close inside a `using` scope is safe", () => {
    expect(() => {
      using db = new RelayDB();
      db.close();
    }).not.toThrow();
    const db = new RelayDB();
    db.close();
    expect(() => db.close()).not.toThrow();
  });
});
