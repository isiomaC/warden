import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteLedgerStore } from "@stlw/warden";
import { existsSync, unlinkSync } from "node:fs";
import { auditCommand } from "../src/commands/audit";

const TEST_DB = "/tmp/warden-cli-audit-export.db";
const GITHUB_TOKEN = ["ghp", "abcdefghijklmnopqrstuvwxyzABCDEF"].join("_");

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`);
  if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`);
}

function seedLedger() {
  const ledger = new SqliteLedgerStore(TEST_DB);
  ledger.write({
    id: "entry-1",
    previousHash: ledger.lastHash(),
    timestamp: "2026-09-25T12:00:00.000Z",
    sessionId: "session-1",
    taskId: "task-1",
    tool: "github__create_issue",
    toolInput: { title: "Needs, review", token: GITHUB_TOKEN },
    trustLevel: 1,
    trustSource: "mcp__github__create_issue",
    policyRulesMatched: ["confirm-write"],
    decision: "CONFIRM",
    decisionReason: "Approval required",
    hash: "",
    previousEntryHash: ledger.lastHash(),
  });
  ledger.writeSecurityEvent({
    id: "event-1",
    timestamp: "2026-09-25T12:01:00.000Z",
    eventType: "SHADOW_MCP_BLOCKED",
    details: { server: "untrusted, server" },
  });
  const [entry] = ledger.getEntries();
  ledger.close();
  return entry;
}

async function runAudit(args: Record<string, unknown>) {
  return auditCommand.run!({
    args: { _: [], ...args },
    rawArgs: [],
    cmd: auditCommand,
  } as never);
}

describe("auditCommand exports", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("emits a standalone versioned JSON ledger report", async () => {
    seedLedger();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runAudit({ db: TEST_DB, export: "json" });

    const report = JSON.parse(stdout.mock.calls.join(""));
    expect(report).toEqual({
      formatVersion: 1,
      chain: { valid: true },
      entries: [expect.objectContaining({
        id: "entry-1",
        tool: "github__create_issue",
        toolInput: { title: "Needs, review", token: "[REDACTED]" },
      })],
      securityEvents: [{
        id: "event-1",
        timestamp: "2026-09-25T12:01:00.000Z",
        eventType: "SHADOW_MCP_BLOCKED",
        details: { server: "untrusted, server" },
      }],
    });
  });

  it("emits CSV with escaped structured values", async () => {
    const entry = seedLedger();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runAudit({ db: TEST_DB, export: "csv" });

    expect(stdout.mock.calls.join("")).toBe([
      "record_type,id,timestamp,session_id,task_id,tool,tool_input,trust_level,trust_source,policy_rules_matched,decision,decision_reason,previous_hash,hash,event_type,event_details",
      `ledger_entry,entry-1,2026-09-25T12:00:00.000Z,session-1,task-1,github__create_issue,"{""title"":""Needs, review"",""token"":""[REDACTED]""}",1,mcp__github__create_issue,"[""confirm-write""]",CONFIRM,Approval required,${"0".repeat(64)},${entry.hash},,`,
      'security_event,event-1,2026-09-25T12:01:00.000Z,,,,,,,,,,,,SHADOW_MCP_BLOCKED,"{""server"":""untrusted, server""}"',
      "",
    ].join("\n"));
  });
});
