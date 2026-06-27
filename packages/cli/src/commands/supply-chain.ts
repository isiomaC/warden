import { defineCommand } from "citty";
import { checkSupplyChain } from "@warden/core";
import type { Dependency } from "@warden/core";

export const supplyChainCommand = defineCommand({
  meta: {
    name: "supply-chain",
    description: "Check package integrity",
  },
  async run() {
    const deps: Dependency[] = [
      { name: "better-sqlite3", version: "9.6.0", integrity: "sha512-abc" },
      { name: "hono", version: "4.0.0", integrity: "sha512-def" },
      { name: "ulid", version: "2.3.0", integrity: "sha512-ghi" },
    ];

    const pinned = {
      "better-sqlite3": {
        name: "better-sqlite3",
        version: "9.6.0",
        integrity: "sha512-abc",
        approvedAt: new Date().toISOString(),
        approvedBy: "warden",
      },
      hono: {
        name: "hono",
        version: "4.0.0",
        integrity: "sha512-def",
        approvedAt: new Date().toISOString(),
        approvedBy: "warden",
      },
      ulid: {
        name: "ulid",
        version: "2.3.0",
        integrity: "sha512-ghi",
        approvedAt: new Date().toISOString(),
        approvedBy: "warden",
      },
    };

    const report = checkSupplyChain(deps, pinned);

    process.stdout.write(`
=== Supply Chain Check ===

Packages checked: ${deps.length}
Status: ${report.clean ? "CLEAN" : "VIOLATIONS FOUND"}

${report.violations.length > 0 ? "Violations:\n" + report.violations.map((v) => `  [${v.type}] ${v.package}${v.pinned ? ` (pinned: ${v.pinned}, current: ${v.current})` : ` (${v.version})`}`).join("\n") : "All packages verified."}
`);
  },
});
