import { defineCommand } from "citty";
import { MemoryLedgerStore, SqliteLedgerStore } from "@stlw/warden";
import { existsSync } from "node:fs";

type ExportFormat = "json" | "csv";

function isExportFormat(value: string | undefined): value is ExportFormat {
  return value === "json" || value === "csv";
}

function csvField(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function exportJson(entries: unknown[], events: unknown[], chain: { valid: boolean; brokenAt?: number }) {
  return `${JSON.stringify({ formatVersion: 1, chain, entries, securityEvents: events })}\n`;
}

function exportCsv(
  entries: ReturnType<SqliteLedgerStore["getEntries"]>,
  events: ReturnType<SqliteLedgerStore["getEvents"]>,
) {
  const header = [
    "record_type", "id", "timestamp", "session_id", "task_id", "tool", "tool_input",
    "trust_level", "trust_source", "policy_rules_matched", "decision", "decision_reason",
    "previous_hash", "hash", "event_type", "event_details",
  ];
  const rows = [header.join(",")];
  for (const entry of entries) {
    rows.push([
      "ledger_entry", entry.id, entry.timestamp, entry.sessionId, entry.taskId, entry.tool,
      entry.toolInput, entry.trustLevel, entry.trustSource, entry.policyRulesMatched,
      entry.decision, entry.decisionReason, entry.previousHash, entry.hash, "", "",
    ].map(csvField).join(","));
  }
  for (const event of events) {
    rows.push([
      "security_event", event.id, event.timestamp, "", "", "", "", "", "", "", "", "", "", "",
      event.eventType, event.details,
    ].map(csvField).join(","));
  }
  return `${rows.join("\n")}\n`;
}

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
    export: {
      type: "string",
      description: "Machine-readable format: json or csv",
    },
  },
  async run({ args }) {
    const ledger = args.db && existsSync(args.db)
      ? new SqliteLedgerStore(args.db)
      : new MemoryLedgerStore();

    const entries = ledger.getEntries();
    const chain = ledger.verifyChain();
    const events = ledger.getEvents();

    if (args.export !== undefined) {
      if (!isExportFormat(args.export)) {
        ledger.close();
        throw new TypeError(`Unsupported audit export format: ${args.export}`);
      }
      process.stdout.write(args.export === "json"
        ? exportJson(entries, events, chain)
        : exportCsv(entries, events));
      ledger.close();
      return;
    }

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
