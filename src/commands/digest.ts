import { writeFileSync } from "node:fs";
import chalk from "chalk";
import { RelayDB } from "../db/client.js";
import {
  buildDigest,
  formatJson,
  formatMarkdown,
  type DigestFormat,
} from "../lib/digest.js";

export interface DigestOptions {
  since?: string;
  out?: string;
  format?: DigestFormat;
}

export function runDigest(opts: DigestOptions = {}): void {
  const format = normalizeFormat(opts.format);
  const db = new RelayDB();
  let payload: string;
  try {
    const report = buildDigest(db, { since: opts.since });
    payload = format === "json" ? formatJson(report) : formatMarkdown(report);
  } finally {
    db.close();
  }

  if (opts.out) {
    try {
      writeFileSync(opts.out, payload);
    } catch (e) {
      console.log(
        chalk.red(`could not write ${opts.out}: ${(e as Error).message}`),
      );
      process.exit(1);
    }
    console.log(chalk.green(`✓ wrote digest to ${opts.out}`));
    return;
  }

  // No --out → stream to stdout. Markdown payload already ends with a
  // trailing newline section; JSON.stringify does not, so add one for
  // shell-pipe friendliness (`relay digest | pbcopy` etc.).
  process.stdout.write(payload);
  if (!payload.endsWith("\n")) process.stdout.write("\n");
}

function normalizeFormat(raw: string | undefined): DigestFormat {
  if (!raw) return "md";
  const lc = raw.toLowerCase();
  if (lc === "md" || lc === "markdown") return "md";
  if (lc === "json") return "json";
  console.log(chalk.yellow(`unknown --format "${raw}"; defaulting to md`));
  return "md";
}
