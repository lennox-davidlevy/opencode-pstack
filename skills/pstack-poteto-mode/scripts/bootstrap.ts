import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const scriptsDirectory = import.meta.dir;
const nodeModulesDirectory = join(scriptsDirectory, "node_modules");
const commanderPackagePath = join(
  nodeModulesDirectory,
  "commander",
  "package.json"
);
const installKeyPath = join(
  nodeModulesDirectory,
  ".poteto-mode-tools-install-key"
);

function currentInstallKey(): string {
  return createHash("sha256")
    .update(readFileSync(join(scriptsDirectory, "package.json")))
    .update("\0")
    .update(readFileSync(join(scriptsDirectory, "bun.lock")))
    .digest("hex");
}

export function ensureDependenciesInstalled(): void {
  try {
    const installKey = currentInstallKey();
    if (
      existsSync(commanderPackagePath) &&
      existsSync(installKeyPath) &&
      readFileSync(installKeyPath, "utf8").trim() === installKey
    ) {
      return;
    }
  } catch {
    // Unreadable metadata cannot establish a current installation either.
  }

  throw new Error(
    `Tool dependencies are missing or stale. With approval to install dependencies, run bun --no-install ${JSON.stringify(join(scriptsDirectory, "bootstrap.ts"))} --install, then rerun your command. No dependencies were installed.`
  );
}

function installDependencies(): void {
  const installKey = currentInstallKey();
  const result = Bun.spawnSync(
    [process.execPath, "install", "--frozen-lockfile"],
    { cwd: scriptsDirectory }
  );
  if (result.exitCode !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(
      `bun install --frozen-lockfile exited with status ${result.exitCode}`
    );
  }
  if (!existsSync(commanderPackagePath)) {
    throw new Error(
      "bun install --frozen-lockfile completed without installing commander"
    );
  }

  writeFileSync(installKeyPath, `${installKey}\n`);
  process.stdout.write("Tool dependencies installed. Rerun your command explicitly.\n");
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--install") {
      installDependencies();
    } else if (args.length === 0) {
      ensureDependenciesInstalled();
    } else {
      throw new Error("Usage: bun --no-install bootstrap.ts [--install]");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
