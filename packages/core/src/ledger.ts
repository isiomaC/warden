import { createRequire } from "node:module";
import { sha256 } from "./hash";
import { generateId } from "./id";
import { redactSecrets } from "./redact";
import type { TrustLevel } from "./trust";
import type { PolicyDecision } from "./policy";

const require = createRequire(import.meta.url);

function getDb(dbPath: string) {
  const Database = require("better-sqlite3");
  return new Database(dbPath) as import("better-sqlite3").Database;
}

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
  eventType: "RUG_PULL_DETECTED" | "SHADOW_MCP_BLOCKED" | "CHAIN_BROKEN" | "LATERAL_MOVEMENT" | "INJECTION_DETECTED" | "CONFIG_CHANGE_BLOCKED" | "SECRETS_IN_OUTPUT" | "EXTERNAL_CONTENT_STRIPPED";
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

const LEDGER_SCHEMA = `
CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  previous_hash TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  session_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  tool_input TEXT NOT NULL,
  trust_level INTEGER NOT NULL,
  trust_source TEXT NOT NULL,
  policy_rules_matched TEXT NOT NULL,
  decision TEXT NOT NULL,
  decision_reason TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  details TEXT NOT NULL
);
`;

export class SqliteLedgerStore implements LedgerStore {
  private db: import("better-sqlite3").Database;
  private currentHash: string;
  private closed = false;

  constructor(dbPath: string) {
    this.db = getDb(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(LEDGER_SCHEMA);

    const last = this.db
      .prepare("SELECT hash FROM ledger_entries ORDER BY rowid DESC LIMIT 1")
      .get() as { hash: string } | undefined;
    this.currentHash = last?.hash ?? "0".repeat(64);
  }

  write(entry: LedgerEntry): void {
    if (this.closed) return;
    const toolInput = JSON.stringify(redactSecrets(entry.toolInput));
    const hashInput = JSON.stringify({
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
    });
    const hash = sha256(hashInput);

    this.db
      .prepare(
        `INSERT INTO ledger_entries (id, previous_hash, timestamp, session_id, task_id, tool, tool_input, trust_level, trust_source, policy_rules_matched, decision, decision_reason, hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        this.currentHash,
        entry.timestamp,
        entry.sessionId,
        entry.taskId,
        entry.tool,
        toolInput,
        entry.trustLevel,
        entry.trustSource,
        JSON.stringify(entry.policyRulesMatched),
        entry.decision,
        entry.decisionReason,
        hash,
      );

    this.currentHash = hash;
  }

  writeSecurityEvent(event: SecurityEvent): void {
    if (this.closed) return;
    this.db
      .prepare(
        "INSERT INTO security_events (id, timestamp, event_type, details) VALUES (?, ?, ?, ?)",
      )
      .run(
        event.id,
        event.timestamp,
        event.eventType,
        JSON.stringify(event.details),
      );
  }

  writeError(err: unknown): void {
    if (this.closed) return;
    this.writeSecurityEvent({
      id: generateId("err"),
      timestamp: new Date().toISOString(),
      eventType: "CHAIN_BROKEN",
      details: { error: String(err) },
    });
  }

  getEntries(sessionId?: string): LedgerEntry[] {
    const sql = sessionId
      ? "SELECT * FROM ledger_entries WHERE session_id = ? ORDER BY rowid ASC"
      : "SELECT * FROM ledger_entries ORDER BY rowid ASC";
    const params = sessionId ? [sessionId] : [];
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;

    return rows.map(
      (r): LedgerEntry => ({
        id: r.id as string,
        previousHash: r.previous_hash as string,
        timestamp: r.timestamp as string,
        sessionId: r.session_id as string,
        taskId: r.task_id as string,
        tool: r.tool as string,
        toolInput: JSON.parse(r.tool_input as string),
        trustLevel: r.trust_level as LedgerEntry["trustLevel"],
        trustSource: r.trust_source as string,
        policyRulesMatched: JSON.parse(r.policy_rules_matched as string) as string[],
        decision: r.decision as LedgerEntry["decision"],
        decisionReason: r.decision_reason as string,
        hash: r.hash as string,
        previousEntryHash: r.previous_hash as string,
      }),
    );
  }

  getEvents(_sessionId?: string): SecurityEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM security_events ORDER BY rowid ASC")
      .all() as Array<Record<string, unknown>>;

    return rows.map(
      (r): SecurityEvent => ({
        id: r.id as string,
        timestamp: r.timestamp as string,
        eventType: r.event_type as SecurityEvent["eventType"],
        details: JSON.parse(r.details as string) as Record<string, unknown>,
      }),
    );
  }

  lastHash(): string {
    return this.currentHash;
  }

  verifyChain(): { valid: boolean; brokenAt?: number } {
    const entries = this.getEntries();
    let prev = "0".repeat(64);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.previousHash !== prev) {
        return { valid: false, brokenAt: i };
      }
      const hashInput = JSON.stringify({
        id: entry.id,
        timestamp: entry.timestamp,
        sessionId: entry.sessionId,
        taskId: entry.taskId,
        tool: entry.tool,
        toolInput: JSON.stringify(entry.toolInput),
        trustLevel: entry.trustLevel,
        trustSource: entry.trustSource,
        policyRulesMatched: entry.policyRulesMatched,
        decision: entry.decision,
        decisionReason: entry.decisionReason,
        previousHash: entry.previousHash,
      });
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
    this.db.close();
  }
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
      id: generateId("err"),
      timestamp: new Date().toISOString(),
      eventType: "CHAIN_BROKEN",
      details: { error: String(err) },
    });
  }

  getEntries(sessionId?: string): LedgerEntry[] {
    if (sessionId) {
      return this.entries.filter((e) => e.sessionId === sessionId);
    }
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
