import { sha256 } from "./hash";
import { redactSecrets } from "./redact";
import type { TrustLevel } from "./trust";
import type { PolicyDecision } from "./policy";

export interface LedgerEntry {
  id: string;
  previousHash: string;
  timestamp: string;
  sessionId: string;
  taskId: string;
  tool: string;
  toolInput: unknown;
  trustLevel: TrustLevel;
  trustSource: string;
  policyRulesMatched: string[];
  decision: PolicyDecision["action"];
  decisionReason: string;
  hash: string;
  previousEntryHash: string;
}

export interface SecurityEvent {
  id: string;
  timestamp: string;
  eventType: "RUG_PULL_DETECTED" | "SHADOW_MCP_BLOCKED" | "CHAIN_BROKEN" | "LATERAL_MOVEMENT" | "INJECTION_DETECTED" | "CONFIG_CHANGE_BLOCKED";
  details: Record<string, unknown>;
}

export interface LedgerStore {
  write(entry: LedgerEntry): void;
  writeSecurityEvent(event: SecurityEvent): void;
  writeError(err: unknown): void;
  getEntries(sessionId?: string): LedgerEntry[];
  getEvents(sessionId?: string): SecurityEvent[];
  lastHash(): string;
  verifyChain(): { valid: boolean; brokenAt?: number };
  close(): void;
}

export class MemoryLedgerStore implements LedgerStore {
  private entries: LedgerEntry[] = [];
  private events: SecurityEvent[] = [];
  private currentHash = "0".repeat(64);
  private closed = false;

  write(entry: LedgerEntry): void {
    if (this.closed) return;
    const toolInput = redactSecrets(entry.toolInput);
    const storageEntry = {
      id: entry.id,
      timestamp: entry.timestamp,
      sessionId: entry.sessionId,
      taskId: entry.taskId,
      tool: entry.tool,
      toolInput,
      trustLevel: entry.trustLevel,
      trustSource: entry.trustSource,
      policyRulesMatched: entry.policyRulesMatched,
      decision: entry.decision,
      decisionReason: entry.decisionReason,
      previousHash: this.currentHash,
      previousEntryHash: this.currentHash,
      hash: "",
    };
    const hashInput = JSON.stringify({ ...storageEntry, hash: undefined });
    storageEntry.hash = sha256(hashInput);
    this.currentHash = storageEntry.hash;
    this.entries.push(storageEntry);
  }

  writeSecurityEvent(event: SecurityEvent): void {
    if (this.closed) return;
    this.events.push(event);
  }

  writeError(err: unknown): void {
    if (this.closed) return;
    this.events.push({
      id: `err_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: "CHAIN_BROKEN",
      details: { error: String(err) },
    });
  }

  getEntries(_sessionId?: string): LedgerEntry[] {
    return this.entries;
  }

  getEvents(_sessionId?: string): SecurityEvent[] {
    return this.events;
  }

  lastHash(): string {
    return this.currentHash;
  }

  verifyChain(): { valid: boolean; brokenAt?: number } {
    let prev = "0".repeat(64);
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];
      if (entry.previousHash !== prev) {
        return { valid: false, brokenAt: i };
      }
      const hashInput = JSON.stringify({ ...entry, hash: undefined });
      const expectedHash = sha256(hashInput);
      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: i };
      }
      prev = entry.hash;
    }
    return { valid: true };
  }

  close(): void {
    this.closed = true;
  }
}
