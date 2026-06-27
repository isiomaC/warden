# Warden -- Deployment Architecture

## Three Deployment Models

### Model A: Local (Open Source Default)

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
- **This is what ships first.**

### Model B: Central Warden (Enterprise Compliance)

```
┌──────────┐   ┌──────────┐   ┌──────────┐
│ Dev A    │   │ Dev B    │   │ Dev C    │
│ agent ───┼───┤ agent ───┼───┤ agent ───┤
│ :7429    │   │ :7429    │   │ :7429    │
│ POLICY   │   │ POLICY   │   │ POLICY   │   ← local enforcement (never remote)
│ DECISION │   │ DECISION │   │ DECISION │
└────┬─────┘   └────┬─────┘   └────┬─────┘
     │               │               │
     │   audit       │   audit       │   audit   ← central visibility
     └───────────────┼───────────────┘
                     │ HTTPS (mTLS)
              ┌──────┴──────┐
              │   Warden    │  central.warden.internal
              │   Central   │
              │             │
              │  Postgres   │  aggregate audit from all devs
              │  config     │  single policy source, signed, fetched at start
              │  Telegram   │  @company_warden_bot (central bot)
              └─────────────┘
```

- **Enforcement is local** -- each dev machine runs its own Warden, same as Model A. Policy decisions happen in-process, zero network latency.
- **Config is central** -- single policy source fetched at session start via `RemoteConfigSource` (signed, verifiable).
- **Audit is central** -- each local Warden forwards events to central Postgres via `RemoteLedgerStore` or `ForwardingLedgerStore`.
- **Approvals are central** -- Telegram/Slack bot runs on the central server, one bot for the whole org.
- **Tokens are portable** -- `JwtVault` signs tokens with the central server's private key, local instances verify with the public key (no token database lookup needed).
  - DESIGN NOTE: JWTs are stateless, so revocation requires a token blacklist (CRL) or short TTLs (5 min) with refresh. For instant revocation, use `KmsVault` with an introspection endpoint instead.
- **Auth at session-start** -- In Model B, the central `session-start` endpoint requires an API key or mTLS certificate so only authorized devs can obtain tokens. Unlike Model A (open bootstrap), Model B must authenticate the caller.
- SOC2 audit: pull from central Postgres, prove every decision across all developers.
- **Not remote enforcement** -- the central server never makes policy decisions. It collects config, collects audit data, and handles approvals. Policy decisions stay local.

### Model C: Hybrid (Local Enforcement + Central Visibility)

```
┌──────────────────────────────────┐   ┌──────────────────────────────────┐
│          Developer A              │   │          Developer B              │
│                                   │   │                                   │
│  agent → warden:7429 (LOCAL)     │   │  agent → warden:7429 (LOCAL)     │
│            │                      │   │            │                      │
│     .warden/                      │   │     .warden/                      │
│     ├─ledger.db  ──┐              │   │     ├─ledger.db  ──┐              │
│     └─config.yml   │              │   │     └─config.yml   │              │
│            │       │              │   │            │       │              │
│       Forwarder ───┘              │   │       Forwarder ───┘              │
└──────────────┼───────────────────┘   └──────────────┼───────────────────┘
               │                                       │
               │   audit stream (async, fire-and-forget)│
               └───────────────────┬───────────────────┘
                                   │
                          ┌────────┴────────┐
                          │  S3 / Syslog    │  central collector
                          │  / Postgres     │  (no policy decisions)
                          └─────────────────┘
```

- Per-machine enforcement (no latency, fail-closed locally)
- Config distributed via git (hashed at start, verified per call)
- Audit events forwarded to central collector asynchronously
- Central collector aggregates across org
- Developer cannot tamper without detection (hash chain + remote copy)
- Policy changes ship via git, applied on next session

---

## Pluggable Architecture

The design makes these boundaries swappable so Model A can grow into B or C without rewriting core logic.

### Plugin Point 1: `LedgerStore` (already interface-based)

```typescript
// packages/core/src/ledger.ts — existing interface
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

// Model A: already exists
export class MemoryLedgerStore implements LedgerStore { ... }
// Phase 1 adds:
export class SqliteLedgerStore implements LedgerStore { ... }

// Model C: forward to collector
// DESIGN NOTE: LedgerStore.write() is synchronous (void return). The ForwardingLedgerStore
// writes locally first, then enqueues the event for async delivery. If the forwarder fails,
// the local write succeeds and the event is retried from a persistent outbox. This avoids
// adding network latency to the critical path (tool call → policy decision).
export class ForwardingLedgerStore implements LedgerStore {
  constructor(private primary: LedgerStore, private forwarder: EventForwarder) {}
  write(entry) {
    this.primary.write(entry);                              // synchronous local write
    this.forwarder.send(entry).catch(() => { /* retry */ }); // fire-and-forget + outbox
  }
  getEntries(sessionId?) { return this.primary.getEntries(sessionId); }
  verifyChain() { return this.primary.verifyChain(); }      // verify local chain
  close() { this.primary.close(); this.forwarder.flush(); }
}

// Model B: POST to central API
// DESIGN NOTE: Central ledger must serialize writes. The RemoteLedgerStore sends entries
// to the central server, which appends them to a single global hash chain. The client does
// NOT compute the hash -- the server returns the confirmed entry with its hash.
export class RemoteLedgerStore implements LedgerStore {
  constructor(private endpoint: string, private apiKey: string) {}
  write(entry) { /* POST entry, server assigns hash + position in global chain */ }
  getEntries(sessionId?) { /* GET from central, filtered by sessionId */ }
  verifyChain() { /* delegate to central: GET /chain/verify */ }
}
```

### Plugin Point 2: `EventForwarder` (new, for Model C)

```typescript
// packages/core/src/forwarder.ts
export interface EventForwarder {
  send(entry: LedgerEntry): Promise<void>;
  sendEvent(event: SecurityEvent): Promise<void>;
  flush(): Promise<void>;
}

// Model C implementations:
export class SyslogForwarder implements EventForwarder { ... }    // RFC 5424
export class S3Forwarder implements EventForwarder { ... }        // Append to S3 object
export class WebhookForwarder implements EventForwarder { ... }   // POST to collector
export class NoopForwarder implements EventForwarder { ... }      // Model A: drop
```

### Plugin Point 3: `ConfigSource` (new)

```typescript
// packages/core/src/config-source.ts
export interface ConfigSource {
  load(): Promise<PolicyConfig>;

  // DESIGN NOTE: Hash is computed over JSON.stringify(parsedConfig), NOT raw YAML bytes.
  // This ensures whitespace/comment changes don't invalidate the hash for identical configs.
  verify(config: PolicyConfig): Promise<boolean>;

  // Watch for changes (used by Model C git-based and Model B remote)
  onChange(callback: (newConfig: PolicyConfig) => void): void;
}

// Model A:
export class FileConfigSource implements ConfigSource {
  constructor(private path: string) {}
  async load() { /* parse YAML, JSON.stringify, compute SHA-256 hash, cache */ }
}

// Model B/C:
export class RemoteConfigSource implements ConfigSource {
  constructor(private endpoint: string, private apiKey: string) {}
  async load() { /* fetch signed config from central */ }
}

// Model C git-based:
export class GitConfigSource implements ConfigSource {
  async load() { /* read from git-tracked file, verify tag/hash */ }
}
```

### Plugin Point 4: `VaultAdapter` (already interface-based)

```typescript
// packages/core/src/vault.ts — existing interface
export interface VaultAdapter {
  mintToken(params: MintTokenParams): TaskToken;
  verifyToken(tokenId: string): TaskToken | null;
  revokeToken(tokenId: string): void;
  revokeAllForSession(sessionId: string): void;
}

// Model A: already exists
export class LocalVault implements VaultAdapter { ... }

// Model B: external KMS
export class KmsVault implements VaultAdapter { ... }      // HashiCorp, AWS KMS
export class JwtVault implements VaultAdapter { ... }       // JWT with RS256, verify without lookup
```

### Plugin Point 5: `ApprovalChannel` (already interface-based)

```typescript
// packages/hook-server/src/approvals/types.ts — existing
export interface ApprovalChannel {
  request(req: ApprovalRequest): Promise<boolean>;
}

// Models A/B/C: all use same channels. Bot instance varies.
export class StdoutApprovalChannel implements ApprovalChannel { ... }    // Model A
export class TelegramApprovalChannel implements ApprovalChannel { ... }  // A/B/C
export class SlackApprovalChannel implements ApprovalChannel { ... }     // A/B/C
```

### Plugin Point 6: `ContextManager` (needs interface extraction)

```typescript
// packages/core/src/context.ts — interface to extract
export interface ContextStore {
  createTask(sessionId: string, ttlMinutes?: number): TaskContext;
  getTask(taskId: string): TaskContext | undefined;
  recordToolCall(taskId: string, serverName: string): void;
  checkLateralMovement(taskId: string, config: WardenConfig): boolean;
  expireTask(taskId: string): void;
  expireAllForSession(sessionId: string): void;
}

// Model A: already exists
export class ContextManager implements ContextStore { ... }

// Model B/C: optional distributed context via Redis
export class RedisContextStore implements ContextStore { ... }
// Model B/C: optional persistent context via Postgres
export class PostgresContextStore implements ContextStore { ... }
```

---

## Composition: How Each Model Wires Together

```typescript
// Model A: Local (default)
function createLocalWarden(configPath: string): WardenServer {
  return createHookServer({
    config: await new FileConfigSource(configPath).load(),
    ledger: new SqliteLedgerStore(".warden/ledger.db"),
    vault: new LocalVault(),
    contextManager: new ContextManager(),
    approvalChannel: new StdoutApprovalChannel(),
    forwarder: new NoopForwarder(),
  });
}

// Model C: Hybrid (local enforcement + central visibility)
function createHybridWarden(configPath: string): WardenServer {
  const localLedger = new SqliteLedgerStore(".warden/ledger.db");
  return createHookServer({
    config: await new FileConfigSource(configPath).load(),
    ledger: new ForwardingLedgerStore(localLedger, new SyslogForwarder("syslog.internal:514")),
    vault: new LocalVault(),
    contextManager: new ContextManager(),
    approvalChannel: new TelegramApprovalChannel(process.env.TELEGRAM_BOT_TOKEN!),
    forwarder: new SyslogForwarder("syslog.internal:514"),
  });
}

// Model B: Central (local enforcement + central config/audit/approvals)
function createCentralWarden(configPath: string): WardenServer {
  return createHookServer({
    config: await new RemoteConfigSource("https://warden.internal/api/config", apiKey).load(),
    ledger: new RemoteLedgerStore("https://warden.internal/api/ledger", apiKey),
    vault: new JwtVault({ publicKey: readFile("/etc/warden/public.pem") }),  // verify central tokens
    contextManager: new ContextManager(),
    approvalChannel: new TelegramApprovalChannel(process.env.TELEGRAM_BOT_TOKEN!),
    forwarder: new NoopForwarder(), // audit goes directly to central via RemoteLedgerStore
  });
}

// The CENTRAL SERVER (separate process, not the dev machine):
function createCentralCollector(): CentralServer {
  return {
    configEndpoint: serveConfig(configRepo),              // serve signed config to devs
    ledgerEndpoint: serveLedger(postgresPool),             // accept audit events, serialize chain
    approvalBot: new TelegramBot(token),                   // handle /approve /deny
    tokenSigner: new JwtSigner(privateKey),                // sign tokens that devs verify locally
    metrics: serveMetricsDashboard(),                      // aggregate across all devs
  };
}
```

---

## Config for Multi-Model

`warden.config.yml` additions to support Models B and C:

```yaml
version: "2"

meta:
  environment: "development"

# NEW: deployment mode
deployment:
  mode: "local"  # local | hybrid | central

# NEW: config source (overrides file-based loading)
configSource:
  type: "file"        # file | remote | git
  path: "warden.config.yml"
  # remote:
  #   endpoint: "https://warden.internal/api/config"
  #   apiKey: "${WARDEN_API_KEY}"
  # git:
  #   repo: "git@github.com:company/warden-policy.git"
  #   ref: "main"

# NEW: ledger backend
ledger:
  backend: "sqlite"   # memory | sqlite | remote
  path: ".warden/ledger.db"
  # remote:
  #   endpoint: "https://warden.internal/api/ledger"
  #   apiKey: "${WARDEN_API_KEY}"

# NEW: event forwarding (Model C)
forwarding:
  enabled: false
  targets:
    - type: "syslog"
      host: "syslog.internal"
      port: 514
    - type: "webhook"
      url: "https://warden-collector.internal/api/events"
      apiKey: "${WARDEN_COLLECTOR_KEY}"

# NEW: approval channel config
approvals:
  channel: "stdout"    # stdout | telegram | slack
  telegram:
    botToken: "${TELEGRAM_BOT_TOKEN}"
    chatId: "${TELEGRAM_CHAT_ID}"
  slack:
    botToken: "${SLACK_BOT_TOKEN}"
    channel: "#warden-approvals"

# NEW: token provider
vault:
  provider: "local"    # local | jwt | kms
  # jwt:
  #   algorithm: "RS256"
  #   privateKeyPath: "/etc/warden/private.pem"
  # kms:
  #   provider: "aws"
  #   keyId: "arn:aws:kms:..."

# existing
policies:
  - id: "block-prod-writes"
    ...
```

---

## Implementation Order

Matching the phases defined in `docs/ENTERPRISE_ROADMAP.md`:

### Phase 1: Solidify Model A
- `SqliteLedgerStore` -- persistent local storage
- `TrustRegistry` -- fix QUARANTINE propagation through hook handler
- `ContextStore` interface extraction -- prepare for future Redis/Postgres backends
- `FileConfigSource` -- formalize config loading with canonical JSON hash
- Config schema additions: `deployment.mode: local`
- `NoopForwarder` -- stub for future forwarding
- `warden config validate` -- basic quality-of-life CLI command

### Phase 2: Real Approval Channels + Structured Errors
- `TelegramApprovalChannel` -- bot with `/approve` `/deny` + inline buttons
- `SlackApprovalChannel` -- interactive messages
- Structured error codes: `WARDEN_TOKEN_EXPIRED`, `WARDEN_POLICY_DENY`, etc.
- Config schema: `approvals.*`

### Phase 3: Richer Policy Language
- `match.paths`, `match.timeWindow`, `match.rateLimit`, `match.serverType`
- Zod schema updates + conflict detection
- Path-based token scoping enforcement in `authMiddleware`

### Phase 4: Plugin Points for B/C
- `EventForwarder` interface + `SyslogForwarder` + `WebhookForwarder`
- `ForwardingLedgerStore` -- dual-write with async outbox
- `RemoteConfigSource` -- fetch signed config from HTTP
- `RemoteLedgerStore` -- post entries to central collector (server serializes chain)
- `JwtVault` -- stateless RS256 token verification + public key distribution
- `RedisContextStore` -- optional distributed context for multi-machine sessions
- `warden start --mode hybrid --forwarder syslog://...`

### Phase 5: Ops & Hardening
- Dockerfile, systemd unit, health/metrics endpoints
- `warden export`, `warden verify`, structured logging
- Model C end-to-end test, MCP proxy test
- Live Claude Code + OpenCode integration pass
- Central collector server (Model B) -- config serving, audit collection, approval bot, token signing

---

## Design Principle

**Enforcement is always local.** The `PolicyEngine.evaluate()` call runs in-process, no matter the model. A network roundtrip for every tool call is unacceptable latency for an agent. Even in Model B (central), each dev machine runs its own Warden for policy decisions -- the central server handles config distribution, audit collection, and approvals only.

What varies is:
- Where the audit record lands (local file, remote DB, syslog)
- Where the config comes from (local file, git, remote API)
- Where the approval request goes (local stdout, Telegram, Slack)
- How tokens are verified (local lookup, JWT signature, KMS)
- How context is stored (in-memory, Redis, Postgres)

The `LedgerStore`, `ConfigSource`, `ApprovalChannel`, `VaultAdapter`, `ContextStore`, and `EventForwarder` interfaces make these swappable without touching the policy engine or hook handlers.
