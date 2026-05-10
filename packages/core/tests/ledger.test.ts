import { describe, it, expect } from "vitest";
import { MemoryLedgerStore } from "../src/ledger";
import type { LedgerEntry } from "../src/ledger";
import { TrustLevel } from "../src/trust";

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "entry_1",
    previousHash: "0".repeat(64),
    timestamp: new Date().toISOString(),
    sessionId: "session_1",
    taskId: "task_1",
    tool: "read_file",
    toolInput: {},
    trustLevel: TrustLevel.TOOL,
    trustSource: "mcp__filesystem",
    policyRulesMatched: [],
    decision: "ALLOW",
    decisionReason: "test",
    hash: "",
    previousEntryHash: "0".repeat(64),
    ...overrides,
  };
}

describe("MemoryLedgerStore", () => {
  describe("write and read", () => {
    it("should write an entry and assign a hash", () => {
      const store = new MemoryLedgerStore();
      store.write(makeEntry());
      const entries = store.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].hash).toBeTruthy();
      expect(entries[0].hash.length).toBe(64);
    });

    it("should chain hashes between entries", () => {
      const store = new MemoryLedgerStore();
      store.write(makeEntry({ id: "entry_1" }));
      store.write(makeEntry({ id: "entry_2" }));
      const entries = store.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[1].previousHash).toBe(entries[0].hash);
    });

    it("should redact secrets in toolInput before writing", () => {
      const store = new MemoryLedgerStore();
      store.write(
        makeEntry({
          toolInput: { apiKey: "sk-proj-abcdefghijklmnopqrstuvwxyz123456" },
        }),
      );
      const entries = store.getEntries();
      const input = entries[0].toolInput as Record<string, string>;
      expect(input.apiKey).toContain("[REDACTED]");
    });
  });

  describe("verifyChain", () => {
    it("should return valid for properly chained entries", () => {
      const store = new MemoryLedgerStore();
      store.write(makeEntry({ id: "e1" }));
      store.write(makeEntry({ id: "e2" }));
      store.write(makeEntry({ id: "e3" }));
      expect(store.verifyChain()).toEqual({ valid: true });
    });

    it("should detect broken chains", () => {
      const store = new MemoryLedgerStore();
      store.write(makeEntry({ id: "e1" }));
      store.write(makeEntry({ id: "e2" }));
      const entries = store.getEntries();
      // Tamper with an entry
      entries[1].hash = "deadbeef";
      const result = store.verifyChain();
      expect(result.valid).toBe(false);
    });

    it("should detect chain at a specific index", () => {
      const store = new MemoryLedgerStore();
      store.write(makeEntry({ id: "e1" }));
      store.write(makeEntry({ id: "e2" }));
      store.write(makeEntry({ id: "e3" }));
      const entries = store.getEntries();
      entries[1].previousHash = entries[1].previousHash.replace("a", "b");
      const result = store.verifyChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
    });
  });

  describe("security events", () => {
    it("should store and retrieve security events", () => {
      const store = new MemoryLedgerStore();
      store.writeSecurityEvent({
        id: "evt_1",
        timestamp: new Date().toISOString(),
        eventType: "RUG_PULL_DETECTED",
        details: { server: "test", tool: "read_file" },
      });
      const events = store.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("RUG_PULL_DETECTED");
    });
  });

  describe("close", () => {
    it("should prevent writes after close", () => {
      const store = new MemoryLedgerStore();
      store.write(makeEntry({ id: "e1" }));
      store.close();
      store.write(makeEntry({ id: "e2" }));
      expect(store.getEntries()).toHaveLength(1);
    });
  });
});
