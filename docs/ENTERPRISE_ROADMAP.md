# Warden -- Enterprise Roadmap

## Status Assessment (June 2026)

**What exists:** A working proof-of-concept with 151 passing tests. Core policy engine, trust tagger, hash-chained ledger, injection scanner, MCP gateway, hook server (6 endpoints), CLI (6 commands).

**What's missing for enterprise:** Persistent storage, real approval channels, richer policy language, runtime integrity, OS-layer hardening, deployment artifacts, structured observability, multi-model support.

**Architecture reference:** See `docs/ARCHITECTURE.md` for the three deployment models (A: Local, B: Central, C: Hybrid) and the pluggable interface design that supports all three.

---

## Architecture Summary

```
                          ┌─────────────────┐
                          │  Warden Core     │  (never changes)
                          │  ─────────────  │
                          │  PolicyEngine    │
                          │  TrustTagger     │
                          │  InjectionScanner│
                          └───┬───┬───┬───┬─┘
                              │   │   │   │
                    ┌─────────┘   │   │   └──────────┐
                    ▼             ▼   ▼              ▼
              LedgerStore    VaultAdapter  ContextStore  ApprovalChannel
              (swappable)    (swappable)   (swappable)   (swappable)
                    │             │              │              │
         ┌──────────┼──┐   ┌─────┼─────┐  ┌─────┼─────┐  ┌─────┼─────┐
         │    │     │  │   │     │     │  │     │     │  │     │     │
       Memory SQLite Remote Local JWT KMS Memory Redis PG stdout tg slack
        (A)   (A)   (B)  (A)  (B) (B)  (A)   (B)  (B)  (A) (A/B) (B)

         ConfigSource      EventForwarder
         (swappable)       (swappable)
              │                  │
     ┌────────┼──────┐    ┌─────┼──────┐
     │        │      │    │     │      │
   File   Remote   Git  Noop  Syslog  Webhook
   (A)     (B)     (C)  (A)   (C)     (C)
```

Model letters show which model uses which implementation. A = local (default), B = central, C = hybrid.

---

## Gap Analysis (ordered by severity)

### 1. CRITICAL: QUARANTINE Is Broken in the Primary Path

**Bug:** `handlePreToolUse()` tags all tool input as `tagValue(input, "mcp__${toolName}", taskId)` which resolves to TOOL trust. The QUARANTINE policy rule checks for EXTERNAL trust on the input source. Result: the most important architectural invariant ("external content can never flow into writes") cannot fire through the HTTP hook handler.

**Root cause:** The hook handler has no mechanism to propagate trust from prior context. When an agent reads a file (EXTERNAL content) and then tries to write it, Warden only sees the second call -- and tags it as TOOL input, not EXTERNAL.

**Fix:** The hook handler needs a trust propagation table. After `PostToolUse`, store the trust level of the output keyed by the data. Before `PreToolUse`, check if any input values carry external trust from prior calls.

| Task | Effort | File |
|---|---|---|
| Add `TrustRegistry` class to core -- tracks value hashes → trust levels across a task | 2h | `packages/core/src/trust-registry.ts` |
| Wire `PostToolUse` handler to register output trust levels | 1h | `packages/hook-server/src/handlers/post-tool-use.ts` |
| Wire `PreToolUse` handler to check TrustRegistry for external lineage | 1h | `packages/hook-server/src/handlers/pre-tool-use.ts` |
| Integration tests for QUARANTINE flow: read file → write file (blocked) | 2h | `packages/hook-server/tests/integration.test.ts` |
| Gateway `onToolCall` same treatment | 1h | `packages/mcp-gateway/src/gateway.ts` |

### 2. CRITICAL: No Persistent Storage

**Bug:** `MemoryLedgerStore` loses all audit data on restart. For a security product claiming auditability, this is a fatal gap.

**Fix:** Implement `SqliteLedgerStore` using `better-sqlite3` (already in tech stack). Must maintain hash chain integrity across restarts.

| Task | Effort | File |
|---|---|---|
| `SqliteLedgerStore` class: write, getEntries, getEvents, verifyChain, close | 3h | `packages/core/src/ledger.ts` |
| Schema migration: `CREATE TABLE ledger_entries (id, prev_hash, ...)` | 1h | same |
| Hook server CLI `--db-path` flag, `warden start --db .warden/ledger.db` | 1h | `packages/cli/src/commands/start.ts` |
| `warden audit --db` to read from SQLite | 1h | `packages/cli/src/commands/audit.ts` |
| Tests: persist across server restart, chain survives process kill | 2h | new test file |

### 3. HIGH: Approval Channels Are Placeholders

**Current:** `StdoutApprovalChannel` auto-approves everything. `TimeoutApprovalChannel` blocks everything after 60s. No real human-in-the-loop exists.

**Fix:** Implement Telegram bot approval using `grammy` (already in tech stack).

| Task | Effort | File |
|---|---|---|
| `TelegramApprovalChannel` class: send message → wait for reply → return bool | 3h | `packages/hook-server/src/approvals/telegram.ts` |
| Telegram bot setup: `/approve`, `/deny` commands, callback buttons | 2h | same |
| Config: `warden.config.yml` approval section with Telegram bot token (from env) | 1h | config schema |
| `SlackApprovalChannel` (Web API, interactive messages) | 2h | `packages/hook-server/src/approvals/slack.ts` |
| Tests: mock Telegram/Slack API, verify request/response cycle | 2h | new test file |

### 4. HIGH: Policy Language Too Shallow

**Current:** Match on: tool name, environment, trust source, input regex, next tool.

**Missing:** Time-based rules, path-based rules, rate-based rules, content-type rules, file metadata rules.

| Task | Effort |
|---|---|
| Add `match.paths: ["**/secrets/**", "**/.env"]` → block writes to sensitive paths | 2h |
| Add `match.timeWindow: { after: "17:00", before: "09:00", days: ["Sat","Sun"] }` → weekend block | 2h |
| Add `match.rateLimit: { maxCalls: 5, windowSeconds: 3600 }` → per-rule rate caps | 2h |
| Add `match.fileMetadata: { maxSizeBytes: 1048576, extensions: ["*.sql", "*.pem"] }` | 1h |
| Add `match.serverType: ["remote"]` → block all remote for sensitive envs | 1h |
| Zod schema updates for new match fields | 1h |
| Precedence/conflict resolution when multiple rules match with different match types | 1h |

### 5. HIGH: Token Scoping Stored But Never Enforced

**Bug:** `MintTokenParams` has `allowedPaths` and `allowedQueryPatterns`, the `LocalVault` stores them, but `authMiddleware` only checks that the token *exists* -- it never checks if the current tool call matches the token's scope. A token minted for `["read_file"]` can call `write_file`.

**Fix:** `authMiddleware` must check `token.allowedTools` against the incoming `tool_name`. Path-based enforcement needs the tool input path against `token.allowedPaths`.

| Task | Effort | File |
|---|---|---|
| `authMiddleware` checks `token.allowedTools` against `c.req.json().tool_name` | 1h | `packages/hook-server/src/middleware/auth.ts` |
| `authMiddleware` checks tool input path against `token.allowedPaths` | 1h | same |
| Tests: scoped token for `["read_file"]` calling `write_file` → 403 DENY | 1h | integration test |

### 6. HIGH: Session TTL Not Enforced

**Bug:** `ContextManager.createTask()` sets `expiresAt` (default 30 min), but `handlePreToolUse` never checks if the task has expired. An expired task can still make tool calls.

**Fix:** `handlePreToolUse` calls `contextManager.getTask(taskId)` and denies if it returns undefined.

| Task | Effort | File |
|---|---|---|
| `handlePreToolUse` checks `getTask()` returns non-null before evaluating policy | 0.5h | `packages/hook-server/src/handlers/pre-tool-use.ts` |
| Same check in gateway `onToolCall` | 0.5h | `packages/mcp-gateway/src/gateway.ts` |

### 7. MEDIUM: Token TTL Inconsistency

**Bug:** `server.ts` line 49 mints tokens with `ttlSeconds: 3600` (1 hour). `session-start.ts` line 20 mints with `ttlSeconds: 300` (5 minutes). Two handlers, two different values. No configurable TTL.

**Fix:** Standardize to a single configurable value from `warden.config.yml`: `vault.tokenTTLSeconds: 3600`.

| Task | Effort | File |
|---|---|---|
| Add `vault.tokenTTLSeconds` to config schema | 0.5h | `packages/core/src/policy.ts` |
| Both session-start handlers read from config | 0.5h | `server.ts`, `session-start.ts` |

**Risk:** Hook server binary, config file, or core module can be tampered with between sessions.

| Task | Effort | File |
|---|---|---|
| `warden verify` command: hash binary + config + core module, compare to known good | 2h | `packages/cli/src/commands/verify.ts` |
| Config hash stored in ledger on SessionStart, verified on each tool call | 1h | `packages/hook-server/src/handlers/session-start.ts` |
| Tamper → immediate shutdown, security event, notify approval channel | 1h | middleware |

### 6. MEDIUM: No Watchdog or Health Monitoring

| Task | Effort |
|---|---|
| `GET /health` endpoint: returns 200 if server is up, 503 if degraded | 1h |
| `GET /metrics` endpoint: tool calls/min, decisions by type, chain status, uptime | 2h |
| Systemd unit file: `warden.service` with `Restart=always`, `RestartSec=5` | 0.5h |
| Dockerfile: multi-stage build, readonly rootfs, non-root user, healthcheck | 1h |
| `warden start --daemon` with PID file | 1h |

### 7. MEDIUM: No Audit Export or Structured Logging

| Task | Effort |
|---|---|
| `warden export --format json --output audit.json` | 1h |
| `warden export --format csv` | 0.5h |
| `warden export --format syslog` (RFC 5424) | 0.5h |
| Structured logging: JSON log format with correlation IDs (sessionId, taskId) | 1h |

### 8. LOW: Cross-Platform MCP Proxy Is Untested

---

## Implementation Phases

### Phase 1: Solidify Model A (Week 1-2)

Close the critical gaps so the open-source default is production-usable on a single machine.

| # | Task | Effort | Depends On |
|---|---|---|---|
| 1.1 | `TrustRegistry` class — tracks value lineage for QUARANTINE | 6h | — |
| 1.2 | Wire `PostToolUse` to register output trust, `PreToolUse` to check | 2h | 1.1 |
| 1.3 | `SqliteLedgerStore` — persistent ledger via better-sqlite3 | 4h | — |
| 1.4 | Wire SQLite into `createHookServer` with `--db-path` option | 2h | 1.3 |
| 1.5 | `warden audit` reads from SQLite | 1h | 1.4 |
| 1.6 | `warden config validate` — validate YAML schema + rule conflicts before start | 1h | — |
| 1.7 | `warden reset --ledger` + `warden reset --all` for corrupted state | 0.5h | — |
| 1.8 | `FileConfigSource` — formalize config loading with canonical JSON hash | 2h | — |
| 1.9 | Extract `ContextStore` interface from `ContextManager` | 1h | — |
| 1.10 | Enforce token scope: `authMiddleware` checks `token.allowedTools` against tool | 2h | — |
| 1.11 | Enforce session TTL: `handlePreToolUse` denies expired tasks | 0.5h | — |
| 1.12 | Standardize token TTL: single configurable `vault.tokenTTLSeconds` | 1h | — |
| 1.13 | Tests: QUARANTINE flow E2E + persistence + scoping + expiry | 4h | 1.1-1.12 |

**Deliverable:** QUARANTINE works end-to-end. Audit trail survives restart. Token scoping enforced. Session expiry enforced. Config validated before start. Clean config loading path. ContextStore interface ready for future backends.

### Phase 2: Real Approval Channels (Week 2)

| # | Task | Effort | Depends On |
|---|---|---|---|
| 2.1 | `TelegramApprovalChannel` — bot with `/approve` `/deny` + inline buttons | 4h | — |
| 2.2 | `SlackApprovalChannel` — interactive messages | 3h | — |
| 2.3 | Config schema: `approvals.channel`, `approvals.telegram.*`, `approvals.slack.*` | 1h | 1.8 |
| 2.4 | Structured error codes: `WARDEN_TOKEN_EXPIRED`, `WARDEN_POLICY_DENY`, `WARDEN_INJECTION_DETECTED`, etc. | 2h | — |
| 2.5 | Integration tests with mock Telegram/Slack API | 2h | 2.1-2.4 |

**Deliverable:** Real human-in-the-loop on CONFIRM decisions. Structured, machine-readable error responses for enterprise integration.

### Phase 3: Richer Policy Language (Week 2-3)

| # | Task | Effort |
|---|---|---|
| 3.1 | `match.paths` — glob-based path blocking (`**/secrets/**`, `**/.env`) | 1h |
| 3.2 | `match.timeWindow` — time/day-based rules (after 5pm, weekends) | 2h |
| 3.3 | `match.rateLimit` — per-rule rate caps | 1h |
| 3.4 | `match.serverType` — block remote servers in sensitive environments | 1h |
| 3.5 | Zod schema updates + `warden config validate` | 2h |
| 3.6 | Conflict detection and policy dry-run with new match types | 1h |

**Deliverable:** Policy can express real-world enterprise rules.

### Phase 4: Plugin Points for B/C (Week 3)

Make the architecture extensible without touching core logic.

| # | Task | Effort |
|---|---|---|
| 4.1 | `EventForwarder` interface + `NoopForwarder` (used by Model A) | 1h |
| 4.2 | `SyslogForwarder` — RFC 5424 structured syslog | 2h |
| 4.3 | `WebhookForwarder` — HTTP POST to collector | 1h |
| 4.4 | `ForwardingLedgerStore` — dual-write wrapper (local + forward) | 2h |
| 4.5 | `RemoteConfigSource` — fetch config from HTTP endpoint | 2h |
| 4.6 | `JwtVault` — stateless RS256 token verification | 2h |
| 4.7 | `warden start --mode hybrid --forwarder syslog://...` | 1h |

**Deliverable:** All three models (A/B/C) achievable through config + plugin composition. Model C tested E2E.

### Phase 5: Ops & Hardening (Week 4)

| # | Task | Effort |
|---|---|---|
| 5.1 | Dockerfile — multi-stage, readonly rootfs, non-root, healthcheck | 2h |
| 5.2 | systemd unit — `warden.service` with auto-restart | 0.5h |
| 5.3 | `GET /health` + `GET /metrics` endpoints | 3h |
| 5.4 | `warden export --format {json,csv,syslog}` | 2h |
| 5.5 | `warden verify` — hash binary + config, compare to known good | 3h |
| 5.6 | Structured logging — JSON format with sessionId/taskId/decision | 1h |
| 5.7 | Real MCP proxy E2E test | 3h |
| 5.8 | Live Claude Code + OpenCode integration test pass | 4h |
| 5.9 | Operator identity: add `operatorId` to `MintTokenParams` + ledger entries | 2h |
| 5.10 | Supply chain enforcement at SessionStart (verify deps against pinned hashes) | 2h |
| 5.11 | CI/CD pipeline: GitHub Actions workflow (typecheck + test on push/PR) | 1h |

**Deliverable:** Deployable, observable, auditable, tested with real agents.

---

## Test Coverage Targets

| Layer | Now | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|---|---|---|---|---|---|---|---|
| Core unit | 84 | +16 | — | +8 | +6 | — |
| Hook server | 41 | +12 | +6 | — | — | — |
| MCP gateway | 23 | +6 | — | — | +2 | — |
| E2E | 6 | +5 | — | — | +4 | — |
| CLI | — | +3 | — | — | — | +4 |
| **Total** | **151** | **190** | **196** | **204** | **216** | **220** |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| QUARANTINE fix changes trust model assumptions | Medium | High | TrustRegistry as optional at first, test backward compat |
| SQLite migration breaks existing MemoryLedgerStore | Low | Medium | Keep both stores, Memory for dev, SQLite for prod |
| Token scope enforcement breaks existing sessions | Medium | Medium | Default wildcard scope for existing tokens, gradual rollout |
| Session TTL enforcement blocks long-running tasks | Medium | Medium | Configurable TTL, refresh token on activity |
| JWT token revocation without CRL | Medium | High | Short TTL (5 min) + token introspection endpoint for Model B |
| Telegram/Slack API rate limits | Medium | Low | Approval channels are async, bounded at 60s |
| Policy language complexity → conflicting rules | Medium | Medium | `warden config validate` + conflict detection |
| Real MCP proxy introduces latency | Low | High | Measure, baseline, <5ms overhead target |
| ForwardingLedgerStore fire-and-forget data loss | Medium | Medium | Persistent outbox queue, retry with backoff |

---

## What NOT to Build

| Item | Why Skip |
|---|---|
| ML-based anomaly detection | Premature. Need baseline data first. Pattern-based scanner is correct for MVP. |
| Multi-node consensus (Raft/Paxos) | Single-node is correct architecture for a per-machine hook server. |
| Web dashboard | CLI + approval channels are sufficient. Dashboard is polish, not security. |
| Cloud-hosted SaaS | On-prem/self-hosted is the security model. Hosting it defeats the purpose. |
| Custom policy DSL | YAML + regex is good enough. Don't build a language. |
| Agentic policy generation | "LLM writes your security policy" is circular and dangerous. Explicitly out of scope. |
