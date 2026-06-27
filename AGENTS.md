# Warden — Agent Instructions

## What This Repo Is

A monorepo for **Warden** — a security layer for Claude Code / MCP-connected AI agents. Built with Bun + TypeScript strict mode. See `README.md` for usage, `docs/planV2.md` for the implementation spec.

## Authoritative Spec

- **`docs/planV2.md`** is the canonical implementation spec. Every architectural decision in it is a hard requirement. The implementing agent must follow its patterns and never deviate without flagging a conflict.
- `docs/planV1.md` is the earlier draft — superseded, retained for reference only.

## Multi-Agent Workflow

Agents are defined in `agents/*.agent.md`. Each has a specific role and phase:

| Agent | File | Phase | Purpose |
|---|---|---|---|
| architect | `agents/architect.agent.md` | 1 — Design | Designs architecture, interfaces, data flow, test strategy. Does NOT implement. |
| designer | `agents/designer.agent.md` | 1 — Design | Designs UI/UX, components, states, accessibility. Does NOT implement. |
| ml-engineer | `agents/ml-engineer.agent.md` | 1 — Design | Builds ML pipeline, feature engineering, training. |
| coder | `agents/coder.agent.md` | 2 — Build | Implements from architect's plan. Does NOT design. |
| tester | `agents/tester.agent.md` | 3 — QA | Writes tests. Does NOT implement features. |
| reviewer | `agents/reviewer.agent.md` | 3 — QA | Two-stage: spec compliance first, then code quality. |
| ops | `agents/ops.agent.md` | 4 — Deploy | Deploys, CI/CD, monitoring. Does NOT build features. |

**Order matters:** architect before coder, reviewer before ops. The reviewer runs Stage 1 (spec compliance) before Stage 2 (code quality).

Dispatch templates in `dispatch/*.md` are designed to be pasted into OpenCode's `task` tool as prompts for subagent invocations.

## Tech Stack (Locked — from docs/planV2.md)

- **Runtime:** Bun + TypeScript strict mode (no `any`, no implicit returns)
- **HTTP server:** Hono ^4 (hook server on localhost:7429)
- **Policy schema:** Zod ^3
- **JWT/tokens:** jose ^5
- **SQLite:** better-sqlite3 ^9
- **MCP:** @modelcontextprotocol/sdk
- **IDs:** ulid ^2
- **Crypto:** built-in `crypto.subtle` (no dep for SHA-256)
- **Telegram bot:** grammy ^1
- **CLI:** citty ^0.1
- **Test:** Vitest ^2

## Key Architectural Invariants

From docs/planV2.md § "Architectural Commandments":

1. **DENY is the default.** Every unmatched policy case returns DENY. No implicit ALLOW.
2. **No LLM in the security path.** Policy engine and hook handlers are pure deterministic code.
3. **Fail closed, not open.** If Warden crashes, times out, or errors — the tool call is blocked.
4. **Trust flows downward only.** EXTERNAL-tagged content can never be promoted upward.
5. **No static secrets anywhere.** All secrets go through the Vault as ephemeral scoped tokens.
6. **Hash everything.** Tool descriptions, policy files, and ledger entries carry SHA-256 hashes. Mismatch = tamper event → QUARANTINE.
7. **Context is scoped per task**, not per session. Tool output from task A cannot bleed into task B.
8. **Single source of truth for policy:** `warden.config.yml`. Hashed at session start. Runtime mutation triggers ConfigChange block.
9. **Ledger is append-only and hash-chained.** Every entry contains the previous entry's hash.
10. **Approval channels are async but bounded.** CONFIRM decisions wait max 60s, then auto-DENY.

## Implementation Order

Build in this exact sequence to avoid forward dependencies (from docs/planV2.md § "Implementation Sequence"):

1. `packages/core/src/errors.ts` → `trust.ts` → `redact.ts` → `ledger.ts` → `policy.ts` → `vault.ts` → `context.ts` → `scanner.ts` → `pins.ts` → `supply-chain.ts` → core tests
2. `packages/hook-server/` — middleware first, then handlers, then approvals, then server
3. `packages/mcp-gateway/` — registry → oauth → lateral → gateway
4. `packages/cli/` — commands and index

## Monorepo Structure

```
warden/
├── packages/core/         # Pure enforcement logic (trust, policy, ledger, vault, context, scanner, pins, supply-chain)
├── packages/hook-server/  # HTTP hook server for Claude Code (Hono on :7429)
├── packages/mcp-gateway/  # MCP connection wrapper (wrapMCP, registry, OAuth, lateral detection)
└── packages/cli/          # Developer-facing CLI (warden init, audit, policy, supply-chain, scan)
```

## Verification Commands

All sub-agents must run these before reporting done:

| Command | What it does |
|---|---|
| `npx tsc --noEmit` | TypeScript strict mode typecheck — must exit 0 |
| `npx vitest run` | Full test suite — must exit 0 with no failures |

## Package Name

`@wardenlabs/sdk` (from docs/planV2.md). Not `@openclaw/guard` — that was the V1 name, now superseded.
