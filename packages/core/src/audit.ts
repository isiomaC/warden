import { sha256 } from "./hash.js";

export interface AuditEvent<Payload = unknown> {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actor?: string;
  correlationId?: string;
  resourceId?: string;
  payload: Payload;
}

export interface AuditEntry {
  ledgerFormatVersion: number;
  canonicalizationVersion: number;
  hashAlgorithm: "sha256";
  previousHash: string;
  event: AuditEvent;
  hash: string;
}

export type AuditVerification =
  | { valid: true; entries: number }
  | { valid: false; brokenAt: number; reason: "UNSUPPORTED_LEDGER_FORMAT" | "UNSUPPORTED_CANONICALIZATION" | "UNSUPPORTED_HASH_ALGORITHM" | "BROKEN_LINK" | "HASH_MISMATCH" };

const GENESIS_HASH = "0".repeat(64);

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Audit values must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  throw new TypeError(`Unsupported audit value: ${typeof value}`);
}

function hashEntry(entry: Omit<AuditEntry, "hash">): string {
  return sha256(canonicalize(entry));
}

export class AuditChain {
  readonly entries: AuditEntry[] = [];

  append(event: AuditEvent): AuditEntry {
    const unsigned: Omit<AuditEntry, "hash"> = {
      ledgerFormatVersion: 1,
      canonicalizationVersion: 1,
      hashAlgorithm: "sha256",
      previousHash: this.entries.at(-1)?.hash ?? GENESIS_HASH,
      event: structuredClone(event),
    };
    const entry = { ...unsigned, hash: hashEntry(unsigned) };
    this.entries.push(entry);
    return structuredClone(entry);
  }
}

export function verifyAuditChain(entries: readonly AuditEntry[]): AuditVerification {
  let previousHash = GENESIS_HASH;
  for (const [index, entry] of entries.entries()) {
    if (entry.ledgerFormatVersion !== 1) return { valid: false, brokenAt: index, reason: "UNSUPPORTED_LEDGER_FORMAT" };
    if (entry.canonicalizationVersion !== 1) return { valid: false, brokenAt: index, reason: "UNSUPPORTED_CANONICALIZATION" };
    if (entry.hashAlgorithm !== "sha256") return { valid: false, brokenAt: index, reason: "UNSUPPORTED_HASH_ALGORITHM" };
    if (entry.previousHash !== previousHash) return { valid: false, brokenAt: index, reason: "BROKEN_LINK" };
    const { hash, ...unsigned } = entry;
    if (hash !== hashEntry(unsigned)) return { valid: false, brokenAt: index, reason: "HASH_MISMATCH" };
    previousHash = hash;
  }
  return { valid: true, entries: entries.length };
}
