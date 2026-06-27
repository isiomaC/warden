import { describe, it, expect, afterEach } from "vitest";
import { SqliteLedgerStore } from "../src/ledger";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB = "/tmp/warden-test-ledger.db";

function cleanup() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
}

function makeEntry(ledger: SqliteLedgerStore, tool: string, decision: string) {
  ledger.write({
    id: `test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    previousHash: ledger.lastHash(),
    timestamp: new Date().toISOString(),
    sessionId: "test-session",
    taskId: "task-1",
    tool,
    toolInput: { path: "/tmp/test.txt" },
    trustLevel: 1,
    trustSource: "mcp__test",
    policyRulesMatched: [],
    decision: decision as "ALLOW" | "DENY",
    decisionReason: "test",
    hash: "",
    previousEntryHash: ledger.lastHash(),
  });
}

describe("SqliteLedgerStore", () => {
  afterEach(() => {
    cleanup();
  });

  it("should persist entries across instances", () => {
    const store1 = new SqliteLedgerStore(TEST_DB);
    makeEntry(store1, "read_file", "ALLOW");
    store1.close();

    const store2 = new SqliteLedgerStore(TEST_DB);
    const entries = store2.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].tool).toBe("read_file");
    const chain = store2.verifyChain();
    expect(chain.valid).toBe(true);
    store2.close();
  });

  it("should maintain hash chain across restarts", () => {
    const store1 = new SqliteLedgerStore(TEST_DB);
    makeEntry(store1, "read_file", "ALLOW");
    makeEntry(store1, "Bash", "DENY");
    store1.close();

    const store2 = new SqliteLedgerStore(TEST_DB);
    const entries = store2.getEntries();
    expect(entries.length).toBe(2);
    const chain = store2.verifyChain();
    expect(chain.valid).toBe(true);
    store2.close();
  });

  it("should start hash chain from 64 zeros on empty db", () => {
    const store = new SqliteLedgerStore(TEST_DB);
    expect(store.lastHash()).toBe("0".repeat(64));
    store.close();
  });

  it("should detect broken chain", () => {
    const store1 = new SqliteLedgerStore(TEST_DB);
    makeEntry(store1, "read_file", "ALLOW");
    makeEntry(store1, "write_file", "DENY");
    const entries1 = store1.getEntries();
    expect(entries1.length).toBe(2);

    const entries2 = store1.getEntries();
    expect(entries2.length).toBe(2);
    store1.close();
  });

  it("should write and retrieve security events", () => {
    const store = new SqliteLedgerStore(TEST_DB);
    store.writeSecurityEvent({
      id: "evt_1",
      timestamp: new Date().toISOString(),
      eventType: "SHADOW_MCP_BLOCKED",
      details: { server: "evil.com" },
    });
    store.close();

    const store2 = new SqliteLedgerStore(TEST_DB);
    const events = store2.getEvents();
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("SHADOW_MCP_BLOCKED");
    store2.close();
  });

  it("should not write after close", () => {
    const store = new SqliteLedgerStore(TEST_DB);
    makeEntry(store, "read_file", "ALLOW");
    store.close();
    makeEntry(store, "write_file", "DENY");

    const store2 = new SqliteLedgerStore(TEST_DB);
    const entries = store2.getEntries();
    expect(entries.length).toBe(1);
    store2.close();
  });
});
