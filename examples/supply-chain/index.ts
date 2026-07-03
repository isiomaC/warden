/**
 * Warden Supply Chain Verification Example
 *
 * Demonstrates checkSupplyChain — verify that all project dependencies
 * are pinned to exact versions with matching integrity hashes.
 * Catches unpinned deps, version drift, and tampering.
 *
 * Run: npx tsx examples/supply-chain/index.ts
 */

import { checkSupplyChain } from "@warden/core";

console.log("=== Warden Supply Chain Verification ===\n");

// Simulated pinned packages (from .warden/pins.json)
const pins: Record<string, { name: string; version: string; integrity: string; approvedAt: string; approvedBy: string }> = {
  "hono":  { name: "hono",  version: "4.0.0", integrity: "sha512-abc123...", approvedAt: "2026-01-01", approvedBy: "warden init" },
  "ulid":  { name: "ulid",  version: "2.3.0", integrity: "sha512-def456...", approvedAt: "2026-01-01", approvedBy: "warden init" },
  "citty": { name: "citty", version: "0.1.6", integrity: "sha512-ghi789...", approvedAt: "2026-01-01", approvedBy: "warden init" },
};

// Simulated current deps (from package-lock.json)
const currentDeps = [
  { name: "hono", version: "4.0.0", integrity: "sha512-abc123..." },     // ✅ matching
  { name: "ulid", version: "2.4.0", integrity: "sha512-def456..." },     // ❌ version drift
  { name: "citty", version: "0.1.6", integrity: "sha512-tampered..." }, // ❌ integrity mismatch
  { name: "grammy", version: "1.32.0", integrity: "sha512-new999..." },  // ❌ unpinned
];

const report = checkSupplyChain(currentDeps, pins);

console.log(`Clean: ${report.clean}`);
console.log(`Violations: ${report.violations.length}\n`);

for (const violation of report.violations) {
  switch (violation.type) {
    case "UNPINNED":
      console.log(`  ⚠️  UNPINNED: ${violation.package}@${violation.version} — not in pins`);
      console.log(`     Run: warden supply-chain approve\n`);
      break;
    case "VERSION_DRIFT":
      console.log(`  🔄 VERSION_DRIFT: ${violation.package} — pinned ${violation.pinned} but got ${violation.current}`);
      console.log(`     Possible silent update. Investigate.\n`);
      break;
    case "INTEGRITY_MISMATCH":
      console.log(`  🔴 INTEGRITY_MISMATCH: ${violation.package}@${violation.current}`);
      console.log(`     Hash mismatch — possible tampering or package republish.\n`);
      break;
  }
}

if (report.clean) {
  console.log("✅ All dependencies verified. Session can start.");
} else {
  console.log("❌ Supply chain violations detected. Session should be DENIED.");
  console.log("   Fix violations or run: warden supply-chain approve");
}
