import { homedir } from "node:os";
import { join } from "node:path";

export const RELAY_HOME = process.env.RELAY_HOME ?? join(homedir(), ".relay");
export const CONFIG_PATH = join(RELAY_HOME, "config.toml");
export const DB_PATH = join(RELAY_HOME, "db.sqlite");

export function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  if (p === "~") return homedir();
  return p;
}
