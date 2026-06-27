# ClawGuard — Implementation Plan

### Developer-first agent security layer for Claude Code / MCP environments

-----

## What We’re Building

A thin, composable security SDK that sits between an AI agent and its tools. It enforces trust-level tagging on context sources, scoped ephemeral credentials per task, MCP gateway policy enforcement, and an immutable action log with provenance — all packaged as a drop-in for Claude Code and OpenClaw.

**Tagline:** `npm install @openclaw/guard` — full-permissions AI, without the blast radius.

-----

## Our Edges Over Existing Players

|Player                            |Gap We Exploit                                                                |
|----------------------------------|------------------------------------------------------------------------------|
|Microsoft Agent Governance Toolkit|Open source but requires Kubernetes, gVisor, OPA/Rego — zero solo-dev adoption|
|Geordie AI / WitnessAI            |Enterprise sales motion, no self-serve, no MCP-native layer                   |
|CaMeL (DeepMind)                  |Research paper, custom Python interpreter, not production-ready or installable|
|TaskShield / DRIFT                |Academic benchmarks only, no SDK                                              |
|Superagent                        |Framework-level, not a drop-in for Claude Code                                |

**Our moat:** MCP-native (nobody built for MCP specifically), developer self-serve, OpenClaw distribution, installable today.

-----

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Agent Runtime                  │
│            (Claude Code / OpenClaw)             │
└─────────────────────┬───────────────────────────┘
                      │ all tool calls
                      ▼
┌─────────────────────────────────────────────────┐
│              ClawGuard Proxy Layer              │
│                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────┐ │
│  │ Trust Tagger│  │Policy Engine │  │ Ledger │ │
│  │             │  │              │  │        │ │
│  │ system=HIGH │  │ allow/deny/  │  │immutable│ │
│  │ tool=MED    │  │ confirm/     │  │ action  │ │
│  │ web=LOW     │  │ quarantine   │  │  log   │ │
│  └─────────────┘  └──────────────┘  └────────┘ │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │         Credential Vault                 │  │
│  │  ephemeral scoped tokens per task        │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────┘
                      │ validated, scoped calls only
                      ▼
┌─────────────────────────────────────────────────┐
│              MCP Servers / Tools                │
│     (filesystem, DB, APIs, shell, etc.)         │
└─────────────────────────────────────────────────┘
```

-----

## Core Primitives

### 1. Trust Levels (borrowed from CaMeL, productized)

Every value in the agent’s context carries a trust tag:

```typescript
enum TrustLevel {
  SYSTEM    = 3,  // user-authored system prompt
  AGENT     = 2,  // agent's own reasoning
  TOOL      = 1,  // output from connected MCP tool
  EXTERNAL  = 0,  // web, email, docs, user uploads
}
```

Rule: a value’s trust level can never be upgraded by agent reasoning alone. External data touching a SYSTEM-level operation requires an explicit human confirmation step.

### 2. Policy Engine (deterministic, not LLM-based)

Policies are JSON/YAML rules, not prompts. Evaluated in <1ms before any tool call executes.

```yaml
# clawguard.config.yml
policies:
  - name: "no-prod-writes"
    match:
      tool: ["db_write", "file_write", "shell"]
      environment: ["production"]
    action: DENY

  - name: "confirm-deletions"
    match:
      tool: ["db_delete", "file_delete", "git_push"]
    action: CONFIRM   # pauses, sends to approval channel

  - name: "quarantine-external"
    match:
      trust_source: EXTERNAL
      next_tool: ["send_email", "post_slack", "api_call"]
    action: QUARANTINE  # strips context, logs, requires re-auth

  - name: "allow-read-only"
    match:
      tool: ["file_read", "db_read", "web_search"]
      trust_source: [SYSTEM, AGENT]
    action: ALLOW
```

### 3. Ephemeral Scoped Credentials

No long-lived secrets in the agent context. ClawGuard mints a JWT-scoped token at task start:

```typescript
const token = await ClawGuard.mintToken({
  taskId: "task_abc123",
  allowedTools: ["file_read", "db_read"],
  allowedPaths: ["/home/claude/workspace/**"],
  ttlSeconds: 300,  // 5 min, auto-expires
  environment: "staging",
})
```

Token is injected into the Claude Code session. Expires on task completion or timeout. No token = no tool access.

### 4. Immutable Action Ledger

Every tool call is logged with full provenance before execution:

```typescript
{
  id: "act_xyz",
  timestamp: "2026-05-09T12:00:00Z",
  taskId: "task_abc123",
  tool: "file_write",
  args: { path: "/tmp/output.txt", content: "..." },
  trustChain: ["SYSTEM→AGENT→TOOL"],
  contextSources: ["system_prompt", "tool:file_read"],
  policy: "allow-read-only",
  decision: "ALLOW",
  hash: "sha256:abc123..."  // tamper-evident chain
}
```

Stored locally (SQLite) by default, pluggable to S3/Cloudflare R2 for teams.

### 5. MCP Gateway (our differentiator)

ClawGuard wraps each MCP server connection and enforces tool-level scoping:

```typescript
// Instead of raw MCP client:
const guard = new ClawGuard({
  config: "./clawguard.config.yml",
  vault: { type: "local" },  // or "cloudflare-kv", "hashicorp"
})

// Wrap any MCP server
const safeFilesystem = guard.wrapMCP("filesystem", {
  allowedTools: ["read_file", "list_directory"],
  trustLevel: TrustLevel.TOOL,
  maxCallsPerMinute: 60,
})

// Use exactly like normal MCP — drop-in replacement
```

-----

## Tech Stack

|Layer           |Choice                                       |Reason                                 |
|----------------|---------------------------------------------|---------------------------------------|
|Runtime         |Bun + TypeScript strict                      |Your existing preference, fast startup |
|Policy eval     |Custom rule engine (JSON schema)             |Avoid OPA complexity, deterministic    |
|Credential store|Local: encrypted JSON / Team: Cloudflare KV  |Zero infra to start                    |
|Action ledger   |better-sqlite3 (local) / Cloudflare D1 (team)|Serverless-compatible                  |
|MCP integration |`@modelcontextprotocol/sdk`                  |Official SDK                           |
|Claude Code hook|CLAUDE.md + hooks config                     |Existing mechanism                     |
|Approval channel|Telegram bot (MVP) / Slack webhook           |Matches tweet author’s workflow exactly|

-----

## Build Phases

### Phase 0 — Repo Setup (30 min)

- [ ] Init monorepo: `packages/core`, `packages/cli`, `packages/claude-code-hook`
- [ ] Bun workspace config
- [ ] TypeScript strict mode
- [ ] Vitest setup
- [ ] `clawguard.config.yml` schema + validator

### Phase 1 — Core Engine (2–3 hrs)

- [ ] `TrustLevel` enum + tagger
- [ ] Policy engine: load config, match rules, return `ALLOW | DENY | CONFIRM | QUARANTINE`
- [ ] Action ledger: SQLite writer with hash chaining
- [ ] Unit tests: policy edge cases (external→prod write = DENY, etc.)

### Phase 2 — MCP Gateway (2–3 hrs)

- [ ] `guard.wrapMCP(serverName, options)` — wraps MCP client calls
- [ ] Pre-call hook: trust tag injection, policy eval, ledger write
- [ ] Post-call hook: trust tag on output, quarantine check
- [ ] Test with `@modelcontextprotocol/server-filesystem` as target

### Phase 3 — Credential Vault (1–2 hrs)

- [ ] `mintToken({ taskId, allowedTools, ttlSeconds })` — generates signed JWT
- [ ] Token verification middleware in MCP gateway
- [ ] Auto-expiry + revocation
- [ ] Local encrypted store (MVP), Cloudflare KV adapter

### Phase 4 — Claude Code Integration (1 hr)

- [ ] `clawguard init` CLI command — generates `CLAUDE.md` additions + `clawguard.config.yml`
- [ ] Claude Code hooks: `PreToolUse` + `PostToolUse` event handlers
- [ ] Session-scoped token minting on Claude Code startup
- [ ] Test: run Claude Code session, verify all tool calls flow through ledger

### Phase 5 — Approval Channel (1 hr)

- [ ] Telegram bot adapter: CONFIRM decision → sends tool call summary to Telegram
- [ ] User replies `approve` / `deny` → unblocks or cancels
- [ ] 60s timeout → auto-deny
- [ ] Slack webhook adapter (same interface)

### Phase 6 — CLI + DX (1 hr)

- [ ] `clawguard init` — interactive setup
- [ ] `clawguard audit` — pretty-print action ledger
- [ ] `clawguard policy test <tool> <trust_level>` — dry-run policy eval
- [ ] `clawguard token mint --task <id> --tools <list> --ttl 300`

-----

## File Structure

```
clawguard/
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   ├── trust.ts          # TrustLevel enum + tagger
│   │   │   ├── policy.ts         # Policy engine
│   │   │   ├── ledger.ts         # Action ledger (SQLite)
│   │   │   ├── vault.ts          # Credential vault
│   │   │   ├── gateway.ts        # MCP wrapper
│   │   │   ├── approvals.ts      # CONFIRM channel adapters
│   │   │   └── index.ts
│   │   ├── tests/
│   │   └── package.json
│   ├── cli/
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── init.ts
│   │   │   │   ├── audit.ts
│   │   │   │   ├── policy.ts
│   │   │   │   └── token.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── claude-code-hook/
│       ├── src/
│       │   ├── hooks.ts          # PreToolUse / PostToolUse handlers
│       │   └── index.ts
│       └── package.json
├── clawguard.config.yml          # Example config
├── CLAUDE.md                     # ClawGuard's own CLAUDE.md for dogfooding
├── package.json                  # Bun workspace root
└── README.md
```

-----

## Leverage What Already Exists

|Component     |Existing Library           |Don’t Rebuild       |
|--------------|---------------------------|--------------------|
|MCP protocol  |`@modelcontextprotocol/sdk`|Official, maintained|
|JWT tokens    |`jose` (zero-dep)          |Battle-tested       |
|SQLite ledger |`better-sqlite3`           |Fast, embedded      |
|Config parsing|`zod` schema               |Type-safe validation|
|CLI framework |`citty` (Bun-native)       |Lightweight         |
|Telegram bot  |`grammy`                   |Minimal, TS-native  |
|Policy logic  |Custom (50 lines)          |OPA is overkill     |
|Test harness  |Vitest                     |Your stack          |

-----

## OpenClaw Integration Path

Once core is stable:

1. ClawGuard becomes the default security layer for all OpenClaw agents
1. Every OpenClaw tool registration goes through `guard.wrapMCP()` automatically
1. OpenClaw dashboard surfaces the action ledger as a UI
1. ClawGuard config lives in the OpenClaw agent manifest

This makes OpenClaw the only agent platform with security built in by default — a direct sales angle vs. raw Claude Code usage.

-----

## MVP Success Criteria

- [ ] Claude Code session runs with ClawGuard hooked in
- [ ] A simulated prompt injection (malicious content in a file the agent reads) is blocked before it can call `send_email` or `shell`
- [ ] A production write attempt triggers a Telegram approval request
- [ ] Full action ledger written and readable via `clawguard audit`
- [ ] Total overhead: <50ms per tool call

-----

## Positioning for Launch

**Who it’s for:** teams and solo devs running Claude Code / MCP setups who can’t give the agent full permissions yet.

**What it does in one line:** “Full-permissions AI agent with a blast-radius kill switch.”

**Distribution:**

- npm package (`@openclaw/guard`) — instant
- Claude Code community / forums — exact audience
- OpenClaw bundled — captive install base
- GitHub README targeting “Claude Code security” search

-----

## What Makes This a Goldmine

1. **Timing** — Microsoft just dropped their toolkit April 2026, proving institutional validation. You can ship something installable in a weekend.
1. **Nobody owns the developer-first tier** — enterprise vendors (Geordie, WitnessAI) have an SDR on the other end of the contact form. You have `npm install`.
1. **MCP is the new attack surface and nobody built for it natively** — every Claude Code user is exposed, none of them have a fix.
1. **Regulatory forcing function** — EU AI Act August 2026, Colorado June 2026 — every company deploying agents needs an audit log. You ship one for free.
1. **OpenClaw synergy** — bundled security makes OpenClaw defensible as a platform, not just a framework.