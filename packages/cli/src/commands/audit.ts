import { defineCommand } from "citty";
import { FileConfigSource, FileLedgerStore, MemoryLedgerStore, SqliteLedgerStore } from "@stlw/warden";
import type { PolicyConfig } from "@stlw/warden";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveRuntimeConfig } from "../runtime-config.js";
import type { RuntimeConfig } from "../runtime-config.js";

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
    jsonl: {
      type: "string",
      description: "Path to an append-only JSONL ledger",
    },
    export: {
      type: "string",
      description: "Machine-readable format: json or csv",
    },
    config: {
      type: "string",
      description: "Path to warden.config.yml, used to find the default ledger",
      default: "warden.config.yml",
    },
  },
  async run({ args }) {
    if (args.db && args.jsonl) throw new TypeError("Use either --db or --jsonl, not both.");
    // With no --db/--jsonl, read the project's persisted ledger (the same default
    // `warden proxy` and `warden start` write to), not an always-empty memory store.
    let dbPath: string | undefined = args.db;
    if (!dbPath && !args.jsonl) {
      const configPath = resolve(args.config ?? "warden.config.yml");
      const config = existsSync(configPath)
        ? (await new FileConfigSource(configPath).load()) as PolicyConfig & RuntimeConfig
        : {} as RuntimeConfig;
      dbPath = resolveRuntimeConfig(config).dbPath;
    }
    const ledger = args.jsonl && existsSync(args.jsonl)
      ? new FileLedgerStore(args.jsonl)
      : dbPath && existsSync(dbPath)
        ? new SqliteLedgerStore(dbPath)
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

Ledger backend: ${args.jsonl ? `JSONL (${args.jsonl})` : dbPath && existsSync(dbPath) ? `SQLite (${dbPath})` : "None found (nothing has been recorded yet)"}
Ledger entries: ${entries.length}
Chain integrity: ${chain.valid ? "VALID" : "BROKEN"}
${chain.brokenAt !== undefined ? `Broken at entry: ${chain.brokenAt}` : ""}

Entries:
${entries.length === 0 ? "  (no entries). Decisions are recorded when tool calls go through `warden proxy` or `warden start`." : ""}
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
