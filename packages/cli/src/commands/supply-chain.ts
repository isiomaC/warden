import { defineCommand } from "citty";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { checkSupplyChain, parseLockDeps } from "@warden/core";
import type { Dependency, PackagePin } from "@warden/core";

interface NpmLockPackage {
  version?: string;
  integrity?: string;
}

interface NpmLockFile {
  packages?: Record<string, NpmLockPackage>;
  dependencies?: Record<string, NpmLockPackage>;
}

/** Flattens an npm package-lock.json (v1-v3) into name -> {version, integrity}, skipping
 * the root project and local workspace entries (which have no integrity hash). */
function loadLockDeps(lockfilePath: string): Dependency[] {
  const raw = readFileSync(lockfilePath, "utf-8");
  const lock = JSON.parse(raw) as NpmLockFile;
  const flat: Record<string, { version: string; integrity: string }> = {};

  const entries = lock.packages ?? lock.dependencies ?? {};
  for (const [key, pkg] of Object.entries(entries)) {
    if (!pkg.version || !pkg.integrity) continue;
    if (key === "" || !key.includes("node_modules/")) continue;
    const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
    flat[name] = { version: pkg.version, integrity: pkg.integrity };
  }

  return parseLockDeps(flat);
}

function loadPins(pinsPath: string): Record<string, PackagePin> {
  if (!existsSync(pinsPath)) return {};
  return JSON.parse(readFileSync(pinsPath, "utf-8")) as Record<string, PackagePin>;
}

function writeBaseline(pinsPath: string, deps: Dependency[]): Record<string, PackagePin> {
  const approvedAt = new Date().toISOString();
  const pins: Record<string, PackagePin> = {};
  for (const dep of deps) {
    pins[dep.name] = {
      name: dep.name,
      version: dep.version,
      integrity: dep.integrity,
      approvedAt,
      approvedBy: "warden-cli",
    };
  }
  mkdirSync(dirname(pinsPath), { recursive: true });
  writeFileSync(pinsPath, JSON.stringify(pins, null, 2));
  return pins;
}

export const supplyChainCommand = defineCommand({
  meta: {
    name: "supply-chain",
    description: "Check package integrity against pinned hashes",
  },
  args: {
    lockfile: {
      type: "string",
      description: "Path to package-lock.json",
      default: "package-lock.json",
    },
    pins: {
      type: "string",
      description: "Path to the supply-chain pin file",
      default: ".warden/supply-chain-pins.json",
    },
    baseline: {
      type: "boolean",
      description: "Approve the current lockfile state as the new pinned baseline",
      default: false,
    },
  },
  async run({ args }) {
    const lockfilePath = resolve(args.lockfile);
    const pinsPath = resolve(args.pins);

    if (!existsSync(lockfilePath)) {
      process.stderr.write(`Lockfile not found: ${lockfilePath}\n`);
      process.exit(1);
    }

    const deps = loadLockDeps(lockfilePath);

    if (args.baseline) {
      writeBaseline(pinsPath, deps);
      process.stdout.write(`Baseline written: ${pinsPath} (${deps.length} packages pinned)\n`);
      return;
    }

    const pinned = loadPins(pinsPath);
    const noPinsConfigured = Object.keys(pinned).length === 0;
    const report = checkSupplyChain(deps, pinned);

    process.stdout.write(`
=== Supply Chain Check ===

Lockfile:        ${lockfilePath}
Pin file:         ${pinsPath}${noPinsConfigured ? " (none found — run with --baseline to create one)" : ""}
Packages checked: ${deps.length}
Status:           ${report.clean ? "CLEAN" : "VIOLATIONS FOUND"}

${report.violations.length > 0 ? "Violations:\n" + report.violations.map((v) => `  [${v.type}] ${v.package}${v.pinned ? ` (pinned: ${v.pinned}, current: ${v.current})` : ` (${v.version})`}`).join("\n") : "All packages verified."}
`);

    if (!report.clean) {
      process.exit(1);
    }
  },
});
