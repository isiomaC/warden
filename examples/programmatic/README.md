# Programmatic Usage Example

Demonstrates using `@warden/core` directly in your own Node.js or Bun project — no hook server, no MCP gateway. Just pure deterministic policy evaluation with hash-chained audit logging.

## What This Shows

| Concept | Where |
|---|---|
| **Policy config** | Defining rules with match criteria (tools, trust levels, environments, input patterns) |
| **Policy evaluation** | Calling `evaluate()` with tool name, input, trust sources, and environment |
| **Policy outcomes** | ALLOW, CONFIRM, DENY — with precedence: DENY > QUARANTINE > CONFIRM > ALLOW |
| **Ledger write** | Recording every decision in an append-only, hash-chained ledger |
| **Chain verification** | Validating that no ledger entry has been tampered with |
| **Context isolation** | Creating per-task contexts that prevent cross-task data bleed |
| **Structured logging** | Using `WardenLogger` for JSON-structured output |

## Prerequisites

- **Node.js >= 22** (or Bun >= 1.1)
- npm (or bun)

## Setup

```bash
# Install the core package
npm install @warden/core
```

## Run

```bash
# From the repo root (local package)
npx tsx examples/programmatic/index.ts

# Or from any project with @warden/core installed
npx tsx examples/programmatic/index.ts
```

Expected output:

```
{"timestamp":"...","level":"INFO","component":"example","message":"Policy engine initialised","environment":"development","ruleCount":3}
{"timestamp":"...","level":"INFO","component":"example","message":"Task created","taskId":"...","sessionId":"session-demo-001",...}
{"timestamp":"...","level":"INFO","component":"example","message":"Decision","tool":"read_file","action":"ALLOW","reason":"Policy: allow-reads ..."}
{"timestamp":"...","level":"INFO","component":"example","message":"Decision","tool":"list_directory","action":"ALLOW",...}
{"timestamp":"...","level":"INFO","component":"example","message":"Decision","tool":"write_file","action":"CONFIRM",...}
{"timestamp":"...","level":"INFO","component":"example","message":"Decision","tool":"Bash","action":"DENY",...}
{"timestamp":"...","level":"INFO","component":"example","message":"Decision","tool":"send_email","action":"DENY",...}
{"timestamp":"...","level":"INFO","component":"example","message":"Verifying ledger chain integrity"}
{"timestamp":"...","level":"INFO","component":"example","message":"Ledger chain is VALID","entryCount":5}
=== AUDIT TRAIL ===
    0. [✓] ALLOW      | tool=read_file          trust=2 hash=a1b2c3d4...
    1. [✓] ALLOW      | tool=list_directory     trust=1 hash=b2c3d4e5...
    2. [?] CONFIRM    | tool=write_file         trust=2 hash=c3d4e5f6...
    3. [✗] DENY       | tool=Bash               trust=2 hash=d4e5f6a7...
    4. [✗] DENY       | tool=send_email         trust=2 hash=e5f6a7b8...
{"timestamp":"...","level":"INFO","component":"example","message":"Summary","totalEvaluations":5,"allowed":2,"denied":2,"confirm":1,...}
```

## How It Works

### 1. Policy Configuration

```typescript
const config: PolicyConfig = {
  version: "2",
  meta: { environment: "development", sessionApprovalRequired: false },
  policies: [
    { id: "allow-reads", match: { tools: ["read_file"], ... }, action: "ALLOW" },
    { id: "confirm-writes", match: { tools: ["write_file"], ... }, action: "CONFIRM" },
    { id: "block-shell-injection", match: { tool: "Bash", inputPatterns: [...] }, action: "DENY" },
  ],
};
```

### 2. Evaluation

```typescript
import { evaluate } from "@warden/core";

const decision = evaluate(config, {
  toolName: "read_file",
  toolInput: { path: "/tmp/notes.txt" },
  environment: "development",
  trustSources: [{ source: "agent", trust: 2 }],
  serverInAllowlist: true,
});
// → { action: "ALLOW", reason: "Policy: allow-reads — ..." }
```

### 3. Ledger (Hash-Chained Audit Trail)

```typescript
import { MemoryLedgerStore } from "@warden/core";

const ledger = new MemoryLedgerStore();

// Write every decision to the ledger
ledger.write({
  id: "entry_01",
  previousHash: ledger.lastHash(),
  timestamp: new Date().toISOString(),
  sessionId: "session-001",
  taskId: "task-001",
  tool: "read_file",
  toolInput: { path: "/tmp/notes.txt" },
  trustLevel: 2,
  trustSource: "agent",
  policyRulesMatched: ["allow-reads"],
  decision: "ALLOW",
  decisionReason: "Policy: allow-reads — ...",
  hash: "",
  previousEntryHash: ledger.lastHash(),
});

// Verify the chain — detects tampering
const { valid } = ledger.verifyChain();
// → { valid: true }
```

### 4. Context Isolation

```typescript
import { ContextManager } from "@warden/core";

const ctx = new ContextManager();
const task = ctx.createTask("session-001");

// Each task is isolated — tool output from task A cannot bleed into task B
ctx.recordToolCall(task.taskId, "filesystem");
```

## Trust Levels

| Level | Value | Meaning |
|---|---|---|
| `TrustLevel.SYSTEM` | 3 | System prompt, Warden config |
| `TrustLevel.AGENT` | 2 | Agent reasoning |
| `TrustLevel.TOOL` | 1 | Tool output (MCP servers) |
| `TrustLevel.EXTERNAL` | 0 | Untrusted (web, email, user input) |

Trust flows downward only. EXTERNAL content can never be promoted upward.

## Next Steps

- See [`README.md`](../../README.md) for the full project overview
- See [`docs/internal/docs/internal/planV2.md`](../../docs/internal/docs/internal/planV2.md) for the authoritative implementation spec
- For programmatic MCP gateway usage: use `@warden/mcp-gateway` (wraps real MCP servers)
- For hook server integration: see the CLI `warden start` command
