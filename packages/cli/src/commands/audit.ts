import { defineCommand } from "citty";
import { MemoryLedgerStore } from "@wardenlabs/core";

export const auditCommand = defineCommand({
  meta: {
    name: "audit",
    description: "View and verify the action ledger",
  },
  async run() {
    const ledger = new MemoryLedgerStore();

    const entries = ledger.getEntries();
    const chain = ledger.verifyChain();

    process.stdout.write(`
=== Warden Audit ===

Ledger entries: ${entries.length}
Chain integrity: ${chain.valid ? "VALID" : "BROKEN"}
${chain.brokenAt !== undefined ? `Broken at entry: ${chain.brokenAt}` : ""}

Entries:
${entries.length === 0 ? "  (no entries)" : ""}
`);

    for (const entry of entries) {
      process.stdout.write(
        `  [${entry.timestamp}] ${entry.decision} | ${entry.tool} | ${entry.decisionReason}\n`,
      );
    }

    const events = ledger.getEvents();
    if (events.length > 0) {
      process.stdout.write(`\nSecurity events: ${events.length}\n`);
      for (const event of events) {
        process.stdout.write(
          `  [${event.timestamp}] ${event.eventType} | ${JSON.stringify(event.details)}\n`,
        );
      }
    }

    process.stdout.write(`\nChain status: ${chain.valid ? "OK" : "FAIL"}\n`);
  },
});
