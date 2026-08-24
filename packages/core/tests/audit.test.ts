import { describe, expect, it } from "vitest";
import { AuditChain, verifyAuditChain, type AuditEvent } from "../src/audit";
import { createAuditEntry } from "../src/index";

function event(id: string): AuditEvent {
  return {
    eventId: id,
    eventType: "ACTION_EVALUATED",
    occurredAt: "2026-08-23T00:00:00.000Z",
    actor: "actor-1",
    correlationId: "request-1",
    resourceId: "resource-1",
    payload: { z: 1, a: "stable" },
  };
}

describe("generic audit chain", () => {
  it("creates a genesis entry compatible with AuditChain", () => {
    const auditEvent = event("event-1");

    expect(createAuditEntry(auditEvent)).toEqual(new AuditChain().append(auditEvent));
  });

  it("creates a seeded next entry compatible with AuditChain and verification", () => {
    const chain = new AuditChain();
    const first = chain.append(event("event-1"));
    const expectedSecond = chain.append(event("event-2"));

    const second = createAuditEntry(event("event-2"), first.hash);

    expect(second).toEqual(expectedSecond);
    expect(verifyAuditChain([first, second])).toEqual({ valid: true, entries: 2 });
  });

  it("is deterministic and clones the input event", () => {
    const auditEvent = event("event-1");
    const first = createAuditEntry(auditEvent);
    const second = createAuditEntry(auditEvent);

    expect(first).toEqual(second);

    auditEvent.payload = { changed: true };
    expect(first.event.payload).toEqual({ z: 1, a: "stable" });
    expect(verifyAuditChain([first])).toEqual({ valid: true, entries: 1 });
  });

  it.each([
    ["empty", ""],
    ["too short", "0".repeat(63)],
    ["too long", "0".repeat(65)],
    ["non-hex", `${"0".repeat(63)}g`],
    ["uppercase", "A".repeat(64)],
  ])("rejects a %s persisted previous hash", (_description, previousHash) => {
    expect(() => createAuditEntry(event("event-1"), previousHash)).toThrow(
      new TypeError("previousHash must be exactly 64 lowercase hexadecimal characters"),
    );
  });

  it("creates a versioned chain that an independent verifier accepts", () => {
    const chain = new AuditChain();
    chain.append(event("event-1"));
    chain.append(event("event-2"));

    expect(chain.entries[0]).toMatchObject({
      ledgerFormatVersion: 1,
      canonicalizationVersion: 1,
      hashAlgorithm: "sha256",
    });
    expect(verifyAuditChain(chain.entries)).toEqual({ valid: true, entries: 2 });
  });

  it.each(["changed", "removed", "reordered"])("detects %s entries", (change) => {
    const chain = new AuditChain();
    chain.append(event("event-1"));
    chain.append(event("event-2"));
    chain.append(event("event-3"));
    const entries = structuredClone(chain.entries);
    if (change === "changed") entries[1]!.event.payload = { changed: true };
    if (change === "removed") entries.splice(1, 1);
    if (change === "reordered") [entries[0], entries[1]] = [entries[1]!, entries[0]!];

    expect(verifyAuditChain(entries).valid).toBe(false);
  });

  it("rejects unsupported format versions explicitly", () => {
    const chain = new AuditChain();
    chain.append(event("event-1"));
    const entries = structuredClone(chain.entries);
    entries[0]!.ledgerFormatVersion = 99;

    expect(verifyAuditChain(entries)).toEqual({
      valid: false,
      brokenAt: 0,
      reason: "UNSUPPORTED_LEDGER_FORMAT",
    });
  });
});
