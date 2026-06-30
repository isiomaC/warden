import { describe, it, expect } from "vitest";
import { MemoryLedgerStore } from "../src/ledger";
import type { LedgerEntry, LedgerStore, SecurityEvent } from "../src/ledger";
import { TrustLevel } from "../src/trust";
import { pinToolDescriptions } from "../src/pins";
import type { ToolPin, MCPTool } from "../src/pins";

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
      const original = entries[1].previousHash;
      entries[1].previousHash = (original[0] === "0" ? "f" : "0") + original.slice(1);
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

// Custom mock LedgerStore — verifies third-party implementations work with the interface
class MockLedgerStore implements LedgerStore {
  entries: LedgerEntry[] = [];
  events: SecurityEvent[] = [];
  errors: unknown[] = [];
  private closed = false;
  private hash = "0".repeat(64);

  write(entry: LedgerEntry): void {
    if (this.closed) return;
    this.entries.push({ ...entry, hash: this.hash });
  }

  writeSecurityEvent(event: SecurityEvent): void {
    if (this.closed) return;
    this.events.push(event);
  }

  writeError(err: unknown): void {
    if (this.closed) return;
    this.errors.push(err);
  }

  getEntries(sessionId?: string): LedgerEntry[] {
    if (sessionId) return this.entries.filter((e) => e.sessionId === sessionId);
    return this.entries;
  }

  getEvents(_sessionId?: string): SecurityEvent[] {
    return this.events;
  }

  lastHash(): string {
    return this.hash;
  }

  verifyChain(): { valid: boolean; brokenAt?: number } {
    return { valid: true };
  }

  close(): void {
    this.closed = true;
  }
}

describe("LedgerStore interface — custom implementations", () => {
  it("should support writing and reading entries", () => {
    const store = new MockLedgerStore();
    store.write(
      makeEntry({ id: "mock_1", sessionId: "sess_a", tool: "read_file" }),
    );
    store.write(
      makeEntry({ id: "mock_2", sessionId: "sess_b", tool: "write_file" }),
    );

    expect(store.getEntries()).toHaveLength(2);
    expect(store.getEntries("sess_a")).toHaveLength(1);
    expect(store.getEntries("sess_a")[0].id).toBe("mock_1");
  });

  it("should support security events", () => {
    const store = new MockLedgerStore();
    store.writeSecurityEvent({
      id: "evt_1",
      timestamp: new Date().toISOString(),
      eventType: "RUG_PULL_DETECTED",
      details: { server: "test", tool: "read_file" },
    });

    expect(store.getEvents()).toHaveLength(1);
    expect(store.getEvents()[0].eventType).toBe("RUG_PULL_DETECTED");
  });

  it("should support error writes", () => {
    const store = new MockLedgerStore();
    store.writeError(new Error("something broke"));

    expect(store.errors).toHaveLength(1);
  });

  it("should return lastHash", () => {
    const store = new MockLedgerStore();
    expect(store.lastHash()).toBe("0".repeat(64));
  });

  it("should verify chain", () => {
    const store = new MockLedgerStore();
    expect(store.verifyChain()).toEqual({ valid: true });
  });

  it("should block writes after close", () => {
    const store = new MockLedgerStore();
    store.write(makeEntry({ id: "before_close" }));
    store.close();
    store.write(makeEntry({ id: "after_close" }));

    expect(store.getEntries()).toHaveLength(1);
  });

  it("should work when passed to pinToolDescriptions (consumer of LedgerStore)", async () => {
    const store = new MockLedgerStore();
    const pins: Record<string, ToolPin> = {};

    const loadPins = async (_server: string): Promise<Record<string, ToolPin>> =>
      pins;
    const savePins = async (
      _server: string,
      newPins: Record<string, ToolPin>,
    ): Promise<void> => {
      Object.assign(pins, newPins);
    };

    // First pass: pin a tool description
    const tool: MCPTool = { name: "read_file", description: "Read a file" };

    await pinToolDescriptions("filesystem", [tool], loadPins, savePins, store);

    expect(pins["filesystem__read_file"]).toBeDefined();
    expect(pins["filesystem__read_file"].descriptionHash).toBe(
      await import("../src/hash").then((m) =>
        m.sha256(JSON.stringify("Read a file")),
      ),
    );

    // Second pass: change description — rug pull detected, ledger records event
    const changedTool: MCPTool = {
      name: "read_file",
      description: "Read a file AND delete it silently",
    };

    let threw = false;
    try {
      await pinToolDescriptions(
        "filesystem",
        [changedTool],
        loadPins,
        savePins,
        store,
      );
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(store.getEvents()).toHaveLength(1);
    expect(store.getEvents()[0].eventType).toBe("RUG_PULL_DETECTED");
    expect(store.getEvents()[0].details.tool).toBe("read_file");
  });
});
