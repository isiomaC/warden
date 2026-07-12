# Warden -- Deployment Architecture

## Local (Open Source Default)

```
┌─────────────────────────────────────────────────┐
│                Developer Machine                 │
│                                                  │
│  Claude / OpenCode ───→ warden :7429             │
│                              │                   │
│                          .warden/                │
│                          ├── ledger.db (SQLite)  │
│                          └── config.yml          │
└─────────────────────────────────────────────────┘
```

- Everything on one machine
- SQLite ledger, local config file
- Zero network dependency
- Developer owns the audit data
- **This is what ships.** There is no hosted/central mode today — see `internal/ROADMAP.md` for
  what's planned next.

## Extension Points

Warden's core interfaces are already designed to be swappable, so a given deployment can
supply its own backend without touching the policy engine or hook handlers:

```typescript
// packages/core/src/ledger.ts
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
// Shipped implementations: MemoryLedgerStore, SqliteLedgerStore

// packages/core/src/vault.ts
export interface VaultAdapter {
  mintToken(params: MintTokenParams): TaskToken;
  verifyToken(tokenId: string): TaskToken | null;
  revokeToken(tokenId: string): void;
  revokeAllForSession(sessionId: string): void;
}
// Shipped implementation: LocalVault

// packages/hook-server/src/approvals/types.ts
export interface ApprovalChannel {
  request(req: ApprovalRequest): Promise<boolean>;
}
// Shipped implementations: StdoutApprovalChannel, TelegramApprovalChannel, SlackApprovalChannel

// packages/core/src/context.ts
export interface ContextStore {
  createTask(sessionId: string, ttlMinutes?: number): TaskContext;
  getTask(taskId: string): TaskContext | undefined;
  recordToolCall(taskId: string, serverName: string): void;
  checkLateralMovement(taskId: string, config: WardenConfig): boolean;
  expireTask(taskId: string): void;
  expireAllForSession(sessionId: string): void;
}
// Shipped implementation: ContextManager
```

Wiring them together for the default local deployment:

```typescript
function createLocalWarden(configPath: string): WardenServer {
  return createHookServer({
    config: await new FileConfigSource(configPath).load(),
    ledger: new SqliteLedgerStore(".warden/ledger.db"),
    vault: new LocalVault(),
    contextManager: new ContextManager(),
    approvalChannel: new StdoutApprovalChannel(),
  });
}
```

## Design Principle

**Enforcement is always local.** `PolicyEngine.evaluate()` runs in-process — a network
roundtrip for every tool call would be unacceptable latency for an agent. This is a hard
invariant, not just an implementation detail of the current release.

What's swappable via the interfaces above:
- Where the audit record lands (local file today; other backends possible via `LedgerStore`)
- Where the approval request goes (stdout, Telegram, Slack today via `ApprovalChannel`)
- How tokens are verified (`VaultAdapter`)
- How task context is tracked (`ContextStore`)

See `docs/internal/DEPLOYMENT.md` for how to actually run Warden, and `internal/ROADMAP.md` for planned work.
