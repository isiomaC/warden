import { describe, expect, it } from "vitest";
import { AuditChain, verifyAuditChain, type AuditEvent } from "../src/audit";

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
