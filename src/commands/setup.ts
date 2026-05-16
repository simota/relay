import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";

export interface SetupOptions {
  skipInstall?: boolean;
  skipBuild?: boolean;
  force?: boolean;
}

export async function runSetup(opts: SetupOptions = {}): Promise<void> {
  const repoRoot = locateRepoRoot();
  if (!repoRoot) {
    console.log(
      chalk.red(
        "relay setup: could not locate the relay source tree (web/nextjs not found).\n" +
          "  Run this command from the relay repository, or clone it first.",
      ),
    );
    process.exit(1);
  }
  const webDir = resolve(repoRoot, "web", "nextjs");

  console.log(chalk.bold(`relay setup`));
  console.log(chalk.gray(`  repo: ${repoRoot}`));

  if (!opts.skipInstall) {
    const rootNm = resolve(repoRoot, "node_modules");
    if (opts.force || !existsSync(rootNm)) {
      await runStep("Installing root deps (bun install)", "bun", ["install"], repoRoot);
    } else {
      console.log(chalk.gray("• root deps present — skipping (`--force` to reinstall)"));
    }

    const webNm = resolve(webDir, "node_modules");
    if (opts.force || !existsSync(webNm)) {
      await runStep(
        "Installing web/nextjs deps (bun install)",
        "bun",
        ["install"],
        webDir,
      );
    } else {
      console.log(chalk.gray("• web/nextjs deps present — skipping (`--force` to reinstall)"));
    }
  }

  if (!opts.skipBuild) {
    const builtIndex = resolve(webDir, "out", "index.html");
    if (opts.force || !existsSync(builtIndex)) {
      await runStep("Building Next.js static export", "bun", ["run", "build"], webDir);
    } else {
      console.log(chalk.gray("• web/nextjs/out present — skipping build (`--force` to rebuild)"));
    }
  }

  console.log(chalk.green(`\n✓ relay setup complete.`));
  console.log(chalk.gray("  Next: `relay init` (once) → `relay quickstart` or `relay web`."));
}

function locateRepoRoot(): string | null {
  // 1) Source-tree resolution: src/commands/ → repo root
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidate = resolve(here, "..", "..");
    if (existsSync(resolve(candidate, "web", "nextjs", "package.json"))) {
      return candidate;
    }
  } catch {
    // ignore — fall through to cwd-based search
  }

  // 2) Bundled (dist/cli.js) or alt layout: walk up from cwd
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "web", "nextjs", "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function runStep(
  label: string,
  cmd: string,
  args: string[],
  cwd: string,
): Promise<void> {
  console.log(chalk.cyan(`\n→ ${label}`));
  console.log(chalk.gray(`  $ ${cmd} ${args.join(" ")}   (cwd: ${cwd})`));
  const proc = Bun.spawn([cmd, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.log(chalk.red(`\n✗ ${label} failed (exit ${code}).`));
    process.exit(code || 1);
  }
}
