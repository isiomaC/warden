import { defineCommand } from "citty";
import { MemoryLedgerStore, SqliteLedgerStore } from "@wardenlabs/core";
import { existsSync } from "node:fs";

export const auditCommand = defineCommand({
  meta: {
    name: "audit",
    description: "View and verify the action ledger",
  },
  args: {
    db: {
      type: "string",
      description: "Path to SQLite ledger (default: in-memory only)",
    },
  },
  async run({ args }) {
    const ledger = args.db && existsSync(args.db)
      ? new SqliteLedgerStore(args.db)
      : new MemoryLedgerStore();

    const entries = ledger.getEntries();
    const chain = ledger.verifyChain();

    process.stdout.write(`
=== Warden Audit ===

Ledger backend: ${args.db ? `SQLite (${args.db})` : "In-memory"}
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
    ledger.close();
  },
});
