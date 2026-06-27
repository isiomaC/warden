# Warden Hardening Plan

**Objective:** Take Warden from “working prototype with a good README” to “credible open-source project ready for early adopters.”

**Repo:** `https://github.com/isiomaC/warden`
**Current state (post v2 commit d23bb62):** 2 commits, 4 workspace packages (core, hook-server, mcp-gateway, cli) + 1 orphaned plugin (opencode-plugin). ~4,275 lines added in v2 including: CI workflow (`.github/workflows/ci.yml`), Dockerfile + docker-compose, `.env.example`, `.dockerignore`, CHECKLIST.md, approval channels (Slack/Telegram with types interface), auth middleware, QUARANTINE content stripping, 9 prompt injection patterns, config-source module, trust-registry module, ContextStore interface refactor, expanded test suite (e2e, integration, approvals, gateway, config-source, trust-registry, sqlite-ledger, vault, context), CLI commands (config validate, reset, audit chain verification). No published npm packages, no releases, no LICENSE file, no CONTRIBUTING.md, no CHANGELOG.md, no GitHub metadata (topics/description), no SECURITY.md, no examples directory, no docs/ directory, README not updated to reflect v2 changes.

**How to use this file:** Execute each phase in order. Each task has a concrete deliverable and a verification step. Do not skip verification. Phases are designed so that later phases depend on earlier ones.

-----

## Phase 1: Repository Hygiene (Do First)

These are zero-code-change tasks that fix the repo’s credibility on sight.

### 1.1 — Add LICENSE file

Create `LICENSE` in the repo root. Use the MIT license text. Set the copyright year to 2025 and the copyright holder to “isiomaC and contributors.”

**File:** `LICENSE`

```
MIT License

Copyright (c) 2025 isiomaC and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

**Verify:** GitHub detects the license and shows “MIT” in the repo sidebar.

### 1.2 — Add CONTRIBUTING.md

Create `CONTRIBUTING.md` in the repo root.

```markdown
# Contributing to Warden

Thank you for considering a contribution. Warden is an early-stage project and we welcome bug reports, feature requests, and pull requests.

## Development Setup

1. Clone the repo: `git clone https://github.com/isiomaC/warden.git && cd warden`
2. Install dependencies: `npm install`
3. Run type checks: `npx tsc --noEmit`
4. Run tests: `npx vitest run`

## Code Standards

- TypeScript strict mode. No `any`, no implicit returns, no unused locals/params.
- Use `Result<T, E>` error pattern where applicable.
- Kebab-case file naming.
- No unsolicited new dependencies — open an issue first if a new dep is needed.
- Every new module must have accompanying tests.

## Pull Request Process

1. Fork the repo and create a branch from `main`.
2. Ensure `npx tsc --noEmit` passes with zero errors.
3. Ensure `npx vitest run` passes with zero failures.
4. Write a clear PR description explaining what changed and why.
5. One approval required before merge.

## Reporting Security Issues

Do NOT open a public issue for security vulnerabilities. Email chuck.contactme@gmail.com instead.

## Code of Conduct

Be respectful. Be constructive. Assume good intent.
```

**Verify:** File exists at root. Linked from README (see Phase 5).

### 1.3 — Add CHANGELOG.md

Create `CHANGELOG.md` in the repo root. Use Keep a Changelog format.

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (v2 hardening — d23bb62)
- Config-source module with hash-verified policy loading
- Trust-registry module for EXTERNAL content tagging
- Approval channels: real Slack and Telegram implementations with ApprovalChannel interface
- Auth middleware for hook server token verification
- QUARANTINE content stripping in pre-tool-use handler
- 9 prompt injection detection patterns in scanner
- Token lifecycle/scope/TTL enforcement in vault
- CLI commands: config validate, reset, audit chain verification
- ContextStore interface (renamed from ContextManager)
- E2e test suite (1,068 lines)
- Integration tests (+706 lines)
- Approval channel tests (322 lines)
- Gateway tests (+377 lines)
- Config-source tests (84 lines), trust-registry tests (46 lines)
- SQLite ledger tests (109 lines), vault tests (+61 lines), context tests (+19 lines)
- MCP gateway: onToolCall ALLOW/DENY/CONFIRM paths, rate limiting, lateral detection with enabled flag
- Ledger: append-only hash-chained entries with verifyChain()
- Infrastructure: Dockerfile, docker-compose.yml, GitHub Actions CI, .env.example, .dockerignore
- CHECKLIST.md for production hardening tracking

## [0.1.0] - 2025-XX-XX

### Added
- Core policy engine with deterministic ALLOW/DENY/CONFIRM/QUARANTINE evaluation
- Hash-chained append-only audit ledger (better-sqlite3)
- Trust tagger with 4-level model (SYSTEM/AGENT/TOOL/EXTERNAL)
- Ephemeral scoped token vault (jose)
- Per-task context isolation manager
- Injection pattern scanner (regex-based, no LLM)
- Tool description pinning with SHA-256 rug-pull detection
- Secret redaction before ledger writes
- Package integrity / supply-chain verification
- HTTP hook server (Hono) for Claude Code integration on localhost:7429
- Hook handlers: SessionStart, SessionEnd, PreToolUse, PostToolUse, PromptSubmit, ConfigChange
- Fail-closed middleware (any error → DENY)
- MCP gateway with server allowlist and wrapMCP() drop-in enforcement
- OAuth 2.1 token management for remote MCP servers
- Cross-server lateral movement detection
- CLI (citty): init, start, audit, policy test, scan, supply-chain
- OpenCode plugin (standalone, not in workspace)
- YAML-based policy configuration (warden.config.yml)
- Deny-wins precedence model
```

**Verify:** File exists at root. Update the date when the first actual release is tagged.

### 1.4 — Set GitHub Repository Metadata

This must be done manually via the GitHub UI (Settings tab) or the `gh` CLI:

```bash
gh repo edit isiomaC/warden \
  --description "Policy engine for autonomous agents. Deterministic tool enforcement, fail-closed architecture, hash-chained audit ledger." \
  --homepage "https://github.com/isiomaC/warden" \
  --add-topic agent-security \
  --add-topic mcp \
  --add-topic policy-engine \
  --add-topic claude-code \
  --add-topic tool-enforcement \
  --add-topic ai-safety \
  --add-topic typescript \
  --add-topic developer-tools
```

**Verify:** Repo page shows description, topics, and the og:description matches.

### 1.5 — Add .github/SECURITY.md

Create `.github/SECURITY.md`:

```markdown
# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Warden, please report it responsibly.

**Do NOT open a public GitHub issue.**

Email: chuck.contactme@gmail.com

You will receive an acknowledgment within 48 hours and a detailed response within 5 business days.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Scope

Warden is a security-critical project. We consider the following in scope:
- Policy engine bypasses
- Ledger tampering or chain integrity failures
- Token vault leaks or secret exposure
- Injection scanner evasion
- Fail-open conditions (anything that should DENY but doesn't)
```

**Verify:** GitHub shows “Security policy” link in the Security tab.

-----

## Phase 2: CI/CD Pipeline

### 2.1 — GitHub Actions: Test & Typecheck — ✅ ALREADY EXISTS (from v2 commit)

`.github/workflows/ci.yml` already exists with typecheck, test, and Docker build verification jobs using Bun. **Review and improve:**

1. **Add Node.js matrix testing** — the README says “Node.js >= 22 or Bun” but CI only tests with Bun. Add a parallel job that runs with Node.js 22 using `actions/setup-node@v4` and `npm ci` instead of `bun install`.
1. **Add test coverage reporting** — add `npx vitest run --coverage` as a step (can be `continue-on-error: true` initially).
1. **Pin Bun version** — `bun-version: latest` is non-deterministic. Pin to a specific version (e.g., `1.1.x`).
1. **Add CI badge to README** — see Phase 5.1.

**Verify:** CI runs on both Bun and Node.js 22. Both pass.

### 2.2 — GitHub Actions: Publish to npm

Create `.github/workflows/publish.yml`:

```yaml
name: Publish Packages

on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Test
        run: npx vitest run

      - name: Build packages
        run: |
          cd packages/core && npx tsc && cd ../..
          cd packages/hook-server && npx tsc && cd ../..
          cd packages/mcp-gateway && npx tsc && cd ../..
          cd packages/cli && npx tsc && cd ../..

      - name: Publish @wardenlabs/core
        run: cd packages/core && npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Publish @wardenlabs/hook-server
        run: cd packages/hook-server && npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Publish @wardenlabs/mcp-gateway
        run: cd packages/mcp-gateway && npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Publish @wardenlabs/cli
        run: cd packages/cli && npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

**Prerequisites (manual):**

1. Register the `@wardenlabs` npm scope at https://www.npmjs.com/org/create — claim it before someone else does.
1. Generate an npm automation token and add it as `NPM_TOKEN` in GitHub repo secrets.
1. Each package’s `package.json` must have `"name": "@wardenlabs/core"` (etc.), `"version": "0.1.0"`, `"publishConfig": { "access": "public" }`, and proper `"main"`, `"types"`, `"files"` fields.

**Verify:** Creating a GitHub Release triggers publish. Packages appear on npmjs.com.

-----

## Phase 3: Package Configuration for Publishing

Each package needs its `package.json` updated for npm publishing. These are the required fields that must exist or be added.

### 3.1 — packages/core/package.json

Ensure these fields exist (add or update):

```json
{
  "name": "@wardenlabs/core",
  "version": "0.1.0",
  "description": "Deterministic policy engine for autonomous agent tool enforcement",
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "access": "public"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/isiomaC/warden.git",
    "directory": "packages/core"
  },
  "keywords": ["agent-security", "policy-engine", "mcp", "tool-enforcement", "ai-safety"],
  "engines": {
    "node": ">=22"
  }
}
```

Also ensure `packages/core/tsconfig.json` exists with:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules"]
}
```

Copy the root `LICENSE` file into `packages/core/LICENSE`.

**Verify:** `cd packages/core && npx tsc` produces a `dist/` folder with `.js` and `.d.ts` files.

### 3.2 — packages/hook-server/package.json

Same pattern as 3.1 but with:

```json
{
  "name": "@wardenlabs/hook-server",
  "version": "0.1.0",
  "description": "HTTP hook server for Claude Code, Codex CLI, and Copilot SDK integration",
  "peerDependencies": {
    "@wardenlabs/core": "^0.1.0"
  }
}
```

Copy LICENSE into `packages/hook-server/LICENSE`.
Add package-local `tsconfig.json` extending root.

### 3.3 — packages/mcp-gateway/package.json

Same pattern:

```json
{
  "name": "@wardenlabs/mcp-gateway",
  "version": "0.1.0",
  "description": "MCP proxy gateway with policy enforcement, server allowlist, and lateral movement detection",
  "peerDependencies": {
    "@wardenlabs/core": "^0.1.0"
  }
}
```

Copy LICENSE. Add local tsconfig.

### 3.4 — packages/cli/package.json

```json
{
  "name": "@wardenlabs/cli",
  "version": "0.1.0",
  "description": "Developer CLI for Warden — init, start, audit, policy test, scan",
  "bin": {
    "warden": "dist/src/index.js"
  },
  "peerDependencies": {
    "@wardenlabs/core": "^0.1.0",
    "@wardenlabs/hook-server": "^0.1.0"
  }
}
```

Ensure `packages/cli/src/index.ts` has a shebang line at the top:

```typescript
#!/usr/bin/env node
```

Copy LICENSE. Add local tsconfig.

### 3.5 — Bring opencode-plugin into the workspace

1. Add `"packages/opencode-plugin"` to the root `package.json` `workspaces` array.
1. Create `packages/opencode-plugin/package.json`:

```json
{
  "name": "@wardenlabs/opencode-plugin",
  "version": "0.1.0",
  "description": "Warden policy enforcement plugin for OpenCode",
  "main": "warden-plugin.ts",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/isiomaC/warden.git",
    "directory": "packages/opencode-plugin"
  },
  "peerDependencies": {
    "@wardenlabs/core": "^0.1.0"
  }
}
```

1. Remove the explicit exclude of `packages/opencode-plugin/warden-plugin.ts` from the root `tsconfig.json`. Instead, give it its own `tsconfig.json` that extends root.
1. Add at least 3 tests for the plugin in `packages/opencode-plugin/tests/`:
- Test that policy evaluation triggers on `tool.execute.before`
- Test that injection scan triggers on `tui.prompt.append`
- Test that session lifecycle mints/revokes tokens

**Verify:** `npx tsc --noEmit` still passes. `npx vitest run` now includes opencode-plugin tests.

-----

## Phase 4: Missing Documentation

The README references docs that don’t appear to exist in the repo. Either they’re missing or in a different branch. Create them.

### 4.1 — docs/USER_DEPLOYMENT.md

Create `docs/USER_DEPLOYMENT.md` covering:

1. **Prerequisites**: Node.js >= 22, npm or Bun, git
1. **Install from npm** (once published): `npm install -g @wardenlabs/cli`
1. **Install from source**: clone, npm install, link
1. **Initialize**: `warden init --environment development` — what files it creates, what each does
1. **Configure policies**: Full annotated `warden.config.yml` walkthrough with common patterns:
- Block all writes in production
- Allow reads everywhere
- Require human approval for destructive ops
- Quarantine external content
1. **Start the hook server**: `warden start` — expected output, port config, background daemon setup
1. **Connect to Claude Code**: Full `.claude/settings.json` hooks config (copy from README)
1. **Connect to OpenCode**: Plugin copy instructions
1. **Verify it works**: `warden audit`, `warden policy test`, `warden scan`
1. **Background daemon setup**: systemd unit file for Linux, launchd plist for macOS
1. **Troubleshooting**: Common issues (port conflict, permission denied, hook server not responding, ledger corruption)

Target length: 300-400 lines.

### 4.2 — docs/DEPLOYMENT.md

Create `docs/DEPLOYMENT.md` covering developer/contributor deployment:

1. **Workspace structure**: What each package does, dependency graph
1. **Build process**: `npx tsc` per package, build order (core → hook-server → mcp-gateway → cli)
1. **Hook server internals**: Hono routes, middleware chain, handler lifecycle
1. **MCP gateway internals**: Registry, wrapMCP flow, OAuth token lifecycle
1. **Running in development**: Watch mode, hot reload, debug flags
1. **Production checklist**: Config hashing, ledger backup, token rotation, monitoring
1. **Docker deployment** (optional): Dockerfile for hook server as a container

Target length: 200-300 lines.

### 4.3 — docs/TESTING.md

Create `docs/TESTING.md` covering:

1. **Test philosophy**: Every enforcement path must have a test. Tests are the specification.
1. **Test structure**: Unit tests (core), integration tests (hook-server with mock HTTP), gateway tests
1. **Running tests**: Full suite, per-package, watch mode, coverage
1. **Mock LLM corpus**: What it is (the 15 hook-server tests use a corpus of mock agent interactions), how to extend it
1. **Writing new tests**: Template for a policy test, template for a hook handler test
1. **Live testing with Claude Code**: How to run a real Claude Code session against Warden and verify ledger entries
1. **CI expectations**: What the CI workflow runs, what must pass before merge

Target length: 150-200 lines.

### 4.4 — docs/NPM_PUBLISHING.md

Create `docs/NPM_PUBLISHING.md` covering:

1. **Package names and scope**: `@wardenlabs/core`, `@wardenlabs/hook-server`, `@wardenlabs/mcp-gateway`, `@wardenlabs/cli`, `@wardenlabs/opencode-plugin`
1. **Publish order**: core first (no deps), then hook-server + mcp-gateway (peer dep on core), then cli (peer deps on core + hook-server)
1. **Version strategy**: All packages share the same version number (lockstep), semver
1. **Build before publish**: `npx tsc` in each package, verify `dist/` output
1. **npm provenance**: Using `--provenance` flag with GitHub Actions OIDC
1. **Authentication**: npm automation token in GitHub secrets
1. **Release workflow**: Create a GitHub Release → triggers publish workflow
1. **Verify**: `npm info @wardenlabs/core` shows the published version

Target length: 100-150 lines.

### 4.5 — Verify planV2.md and AGENTS.md exist

The README links to `planV2.md` and `AGENTS.md` at the repo root. Verify they exist. If they don’t:

- `planV2.md`: Recreate from the original implementation spec. It should contain the authoritative architecture, all data structures (Zod schemas for policy config, ledger entries, trust tags, token claims), hook contracts (request/response shapes for all 6 Claude Code hooks), and the 10 architectural invariants.
- `AGENTS.md`: Recreate as the multi-agent workflow instructions for building Warden with Claude Code / orchestrator agents. Include the agent roles (architect, coder, designer, ml-engineer, ops, reviewer, tester), their responsibilities, handoff protocol, and file ownership boundaries.

-----

## Phase 5: README Improvements

### 5.1 — Add badges at the top of README.md

Insert immediately after the `# Warden` heading:

```markdown
[![CI](https://github.com/isiomaC/warden/actions/workflows/ci.yml/badge.svg)](https://github.com/isiomaC/warden/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@wardenlabs/core)](https://www.npmjs.com/package/@wardenlabs/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
```

### 5.2 — Add Contributing and License links

At the bottom of the README, before the current `## License` section, add:

```markdown
## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and pull request guidelines.

## Security

See [SECURITY.md](.github/SECURITY.md) for reporting vulnerabilities.
```

### 5.3 — Add positioning statement

Add a new section after the “Works With” table and before “How It Works”:

```markdown
## Why Warden

Enterprise MCP gateways (AWS AgentCore, Google Agent Gateway, Kong, Tyk) solve policy enforcement at the infrastructure layer. Warden solves it at the developer layer — local-first, zero-infrastructure, running on your machine as part of your agent's tool chain.

- **No server to deploy.** Warden runs as a local hook server or in-process plugin.
- **No vendor lock-in.** Works with Claude Code, OpenCode, Codex CLI, Copilot SDK, and any MCP-connected agent.
- **No LLM in the security path.** Policy decisions are deterministic pattern matching, not probabilistic.
- **Complements gateways.** Use Warden locally during development; use a gateway in production. Or use both.
```

### 5.4 — Add scanner limitations notice

In the “Configuration” section, after the `block-shell-injection` policy example, add a note:

```markdown
> **Note:** The injection scanner uses regex pattern matching, which catches common attack patterns but can be bypassed by obfuscation (e.g., string concatenation, hex encoding, Unicode homoglyphs). For shell command safety, consider combining Warden with AST-level command parsing. Contributions to improve scanner coverage are welcome.
```

-----

## Phase 6: Code Improvements

### 6.1 — Pluggable Ledger Storage Interface — PARTIALLY DONE (v2 added SqliteLedgerStore + tests)

The v2 commit added `sqlite-ledger.test.ts` (109 lines) and `verifyChain()`. **Verify the following and fix if missing:**

1. There is an exported `LedgerStore` interface in `packages/core/src/ledger.ts` (not just the concrete class).
1. Both `SqliteLedgerStore` and `MemoryLedgerStore` implement the same interface.
1. The interface is exported from `packages/core/src/index.ts` so consumers can implement custom backends.

If the interface doesn’t exist as a separate export, extract it:

```typescript
export interface LedgerStore {
  write(entry: LedgerEntry): void;
  read(id: string): LedgerEntry | null;
  readAll(): LedgerEntry[];
  verifyChain(): { valid: boolean; brokenAt?: string };
  getLastHash(): string | null;
}
```

**Add tests:**

- Test that a mock custom implementation works when passed to the policy engine

**Verify:** `npx tsc --noEmit` passes. Existing tests still pass.

### 6.2 — Pluggable Approval Channel Interface — PARTIALLY DONE (v2 added Slack/Telegram/types)

The v2 commit added `approvals/types.ts`, `approvals/slack.ts`, `approvals/telegram.ts`, and `approvals/index.ts` with an `ApprovalChannel` interface and 322 lines of tests. **Remaining work:**

1. **Add WebhookApprovalChannel** — a generic webhook-based approval channel that POSTs to a configurable URL and polls for response. This is the extensibility escape hatch for users who don’t use Slack or Telegram.
1. **Verify the existing interface** is exported from the package’s public API so third-party consumers can implement custom channels.

Add a `WebhookApprovalChannel` that POSTs to a configurable URL and polls for response:

```typescript
export class WebhookApprovalChannel implements ApprovalChannel {
  readonly name = "webhook";

  constructor(private readonly webhookUrl: string, private readonly pollUrl: string) {}

  async requestApproval(context: ApprovalRequest): Promise<ApprovalResult> {
    // POST to webhookUrl with context
    // Poll pollUrl until approved/denied or timeout
    // Return result
  }
}
```

Add `channel: "webhook"` support in `warden.config.yml` policy schema:

```yaml
- id: "confirm-destructive"
  action: CONFIRM
  channel: "webhook"
  webhookUrl: "https://your-server.com/warden/approve"
  pollUrl: "https://your-server.com/warden/approve/status"
  timeoutSeconds: 60
```

**Add tests:**

- Test webhook channel with a mock HTTP server
- Test timeout behavior
- Test that custom channels can be registered

**Verify:** Existing stdout/telegram/slack tests still pass. New webhook tests pass.

### 6.3 — QUARANTINE Action Specification — ✅ DONE (v2 commit, CHECKLIST item 1.2)

The v2 commit implemented QUARANTINE content stripping in `pre-tool-use.ts`: external-trust values are stripped from input, non-external values are preserved, and the call is allowed through with sanitized input and `additionalContext` warning.

**Remaining:** Update the README’s QUARANTINE description to match the implementation. Add this to the README’s QUARANTINE description:

```markdown
**QUARANTINE** strips the tool output and replaces it with a sentinel value 
(`[QUARANTINED: ...]`). The original content is preserved in the ledger for 
audit purposes but is never passed to downstream tools or the agent's context. 
The trust level is forced to EXTERNAL (0).
```

**Add tests:**

- Test that quarantined output is replaced with sentinel
- Test that original content appears in ledger
- Test that quarantined content cannot flow to a downstream tool call

### 6.4 — Rate Limiter Enhancement

Replace the simple `maxCallsPerMinute` counter with a sliding window rate limiter.

In `packages/core/src/`, create `rate-limiter.ts`:

```typescript
export interface RateLimiterConfig {
  /** Max calls in the window */
  maxCalls: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Optional: per-tool limits override the global limit */
  perToolLimits?: Record<string, { maxCalls: number; windowMs: number }>;
}

export class SlidingWindowRateLimiter {
  private windows: Map<string, number[]> = new Map();

  constructor(private config: RateLimiterConfig) {}

  /** Returns true if the call is allowed, false if rate-limited */
  check(key: string): { allowed: boolean; retryAfterMs?: number } {
    // Implementation: sliding window log algorithm
    // key format: "global", "tool:read_file", "session:abc123"
  }

  record(key: string): void {
    // Record a call timestamp
  }

  reset(key?: string): void {
    // Clear windows
  }
}
```

Integrate into the MCP gateway’s `wrapMCP()` — check rate limit before policy evaluation, return DENY with a rate-limit reason if exceeded.

Update `warden.config.yml` schema to support:

```yaml
rateLimits:
  global:
    maxCalls: 1000
    windowMs: 60000    # 1 minute
  perTool:
    write_file:
      maxCalls: 10
      windowMs: 60000
    shell:
      maxCalls: 5
      windowMs: 60000
```

**Add tests:**

- Test sliding window correctly allows/denies at boundary
- Test per-tool overrides
- Test window expiry (calls outside window don’t count)

**Verify:** Existing tests pass. New rate limiter tests pass. `npx tsc --noEmit` clean.

### 6.5 — Structured Logging

Add structured JSON logging throughout the hook server and gateway. Currently log output is likely `console.log` strings.

Create `packages/core/src/logger.ts`:

```typescript
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  component: string;
  message: string;
  sessionId?: string;
  taskId?: string;
  toolName?: string;
  decision?: string;
  durationMs?: number;
  [key: string]: unknown;
}

export class WardenLogger {
  constructor(
    private component: string,
    private minLevel: LogLevel = LogLevel.INFO,
  ) {}

  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (level < this.minLevel) return;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      component: this.component,
      message,
      ...context,
    };
    // Output as single-line JSON to stdout
    process.stdout.write(JSON.stringify(entry) + "\n");
  }
}
```

Replace all `console.log` / `console.error` calls in hook-server and mcp-gateway with `WardenLogger` instances.

**Verify:** Hook server output is valid JSON lines. Can be piped to `jq` for filtering.

-----

## Phase 7: Examples

### 7.1 — Create examples/ directory

Create `examples/claude-code-basic/` with a minimal working setup:

**examples/claude-code-basic/README.md:**

```markdown
# Warden + Claude Code: Basic Setup

This example shows the minimum configuration to run Warden with Claude Code.

## Files
- `warden.config.yml` — Policy configuration
- `.claude/settings.json` — Claude Code hook registrations

## Usage

1. Start Warden: `npx @wardenlabs/cli start`
2. Start Claude Code: `claude`
3. Try a blocked operation: Ask Claude to `rm -rf /tmp/test`
4. Check the audit log: `npx @wardenlabs/cli audit`
```

**examples/claude-code-basic/warden.config.yml:**

```yaml
version: "2"

meta:
  environment: "development"

mcpServers:
  allowed:
    - name: "filesystem"
      type: local
      transport: stdio
      allowedTools: ["read_file", "list_directory", "write_file"]
      authRequired: false

policies:
  - id: "block-shell-injection"
    description: "Block dangerous shell patterns"
    match:
      tool: "Bash"
      inputPatterns:
        - "rm\\s+-rf"
        - "curl.*\\|.*sh"
        - "eval\\s*\\("
    action: DENY

  - id: "confirm-writes"
    description: "Human approval for file writes"
    match:
      tools: ["write_file"]
    action: CONFIRM
    channel: "stdout"
    timeoutSeconds: 30

  - id: "allow-reads"
    description: "Allow all read operations"
    match:
      tools: ["read_file", "list_directory"]
      environment: ["development"]
    action: ALLOW
```

**examples/claude-code-basic/.claude/settings.json:**

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "http", "url": "http://localhost:7429/hooks/pre-tool-use", "timeout": 10 }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "http", "url": "http://localhost:7429/hooks/post-tool-use", "timeout": 5, "async": true }] }],
    "SessionStart": [{ "matcher": "", "hooks": [{ "type": "http", "url": "http://localhost:7429/hooks/session-start", "timeout": 10 }] }],
    "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "http", "url": "http://localhost:7429/hooks/session-end", "timeout": 10, "async": true }] }]
  }
}
```

### 7.2 — Create MCP proxy example

Create `examples/mcp-proxy-cursor/` with:

- `README.md` — How to use Warden as an MCP proxy with Cursor
- `warden-proxy.ts` — Minimal proxy setup using `@wardenlabs/mcp-gateway`
- `warden.config.yml` — Policy config with server allowlist

### 7.3 — Create programmatic usage example

Create `examples/programmatic/` with:

- `README.md` — Using Warden as a library in your own agent
- `index.ts` — Complete example importing from `@wardenlabs/core`, creating a policy config, evaluating decisions, writing to ledger, verifying chain integrity

-----

## Phase 8: Git History Restructure

**Important:** This must be done carefully. The current repo has 1 squashed commit. This task creates a more natural commit history.

### Option A: Interactive rebase (if you want to preserve the current branch)

This is complex with a single commit. Better to use Option B.

### Option B: Fresh branch with logical commits

1. Create a new branch: `git checkout -b restructure`
1. Soft-reset to before the initial commit: `git reset --soft HEAD~1`
1. Unstage everything: `git reset HEAD .`
1. Re-commit in logical order:

```bash
# Commit 1: Project scaffolding
git add package.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: initialize monorepo with workspace configuration"

# Commit 2: Core package — types and trust
git add packages/core/package.json packages/core/tsconfig.json
git add packages/core/src/trust.ts
git commit -m "feat(core): add trust level model — SYSTEM/AGENT/TOOL/EXTERNAL"

# Commit 3: Core — policy engine
git add packages/core/src/policy.ts
git commit -m "feat(core): add deterministic policy engine with deny-wins precedence"

# Commit 4: Core — ledger
git add packages/core/src/ledger.ts
git commit -m "feat(core): add hash-chained append-only audit ledger"

# Commit 5: Core — vault, context, scanner, pins, redact, supply-chain
git add packages/core/src/vault.ts packages/core/src/context.ts
git add packages/core/src/scanner.ts packages/core/src/pins.ts
git add packages/core/src/redact.ts packages/core/src/supply-chain.ts
git commit -m "feat(core): add vault, context isolation, injection scanner, tool pins, redaction, supply-chain checks"

# Commit 6: Core — index and exports
git add packages/core/src/index.ts
git commit -m "feat(core): add public API exports"

# Commit 7: Core tests
git add packages/core/tests/
git commit -m "test(core): add 84 unit tests covering all enforcement paths"

# Commit 8: Hook server
git add packages/hook-server/
git commit -m "feat(hook-server): add Hono HTTP hook server with fail-closed middleware and approval channels"

# Commit 9: Hook server tests
git add packages/hook-server/tests/
git commit -m "test(hook-server): add 15 integration tests with mock LLM corpus"

# Commit 10: MCP gateway
git add packages/mcp-gateway/
git commit -m "feat(mcp-gateway): add MCP proxy with server allowlist, OAuth 2.1, lateral movement detection"

# Commit 11: MCP gateway tests
git add packages/mcp-gateway/tests/
git commit -m "test(mcp-gateway): add 8 gateway tests"

# Commit 12: CLI
git add packages/cli/
git commit -m "feat(cli): add developer CLI — init, start, audit, policy test, scan, supply-chain"

# Commit 13: OpenCode plugin
git add packages/opencode-plugin/
git commit -m "feat(opencode-plugin): add Warden plugin for OpenCode with all 6 hook events"

# Commit 14: Documentation
git add README.md CHANGELOG.md CONTRIBUTING.md LICENSE .github/ docs/ AGENTS.md
git commit -m "docs: add README, CHANGELOG, CONTRIBUTING, LICENSE, SECURITY, deployment and testing guides"

# Commit 15: CI
git add .github/workflows/
git commit -m "ci: add GitHub Actions for test, typecheck, and npm publish"

# Commit 16: Examples
git add examples/
git commit -m "docs: add Claude Code, MCP proxy, and programmatic usage examples"

# Commit 17: Config files
git add warden.config.yml .claude/
git commit -m "chore: add default warden.config.yml and Claude Code hook settings"

# Commit 18: Lock file
git add package-lock.json
git commit -m "chore: add package-lock.json"
```

1. Force push the restructured branch: `git push origin restructure --force`
1. If satisfied, reset main: `git checkout main && git reset --hard restructure && git push origin main --force`

**Warning:** Force-pushing to main rewrites history. Since there are 0 stars, 0 forks, and 0 watchers, this is safe. Do NOT do this once other people have cloned.

**Verify:** `git log --oneline` shows 15+ logical commits. Each commit compiles and tests pass at that point in history (ideally).

-----

## Phase 9: First Release

### 9.1 — Tag and release

After all phases are complete:

```bash
# Ensure everything is clean
npx tsc --noEmit
npx vitest run

# Tag
git tag -a v0.1.0 -m "v0.1.0: Initial public release"
git push origin v0.1.0
```

### 9.2 — Create GitHub Release

Go to GitHub → Releases → Create a new release. Use tag `v0.1.0`. Title: `v0.1.0 — Initial Release`. Body: copy the CHANGELOG entry for 0.1.0.

This triggers the publish workflow (Phase 2.2), which publishes all packages to npm.

### 9.3 — Post-release verification

```bash
npm info @wardenlabs/core
npm info @wardenlabs/cli
npm info @wardenlabs/hook-server
npm info @wardenlabs/mcp-gateway
```

All should show version `0.1.0` with correct metadata.

Test install from npm:

```bash
mkdir /tmp/warden-test && cd /tmp/warden-test
npm init -y
npm install @wardenlabs/core @wardenlabs/cli
npx warden init --environment development
npx warden policy test read_file --trust AGENT --environment development
```

-----

## Execution Checklist

|# |Task                                                       |Phase  |Status                                          |
|--|-----------------------------------------------------------|-------|------------------------------------------------|
|1 |Add LICENSE file                                           |1.1    |☐                                               |
|2 |Add CONTRIBUTING.md                                        |1.2    |☐                                               |
|3 |Add CHANGELOG.md                                           |1.3    |☐                                               |
|4 |Set GitHub repo metadata (topics, description)             |1.4    |☐                                               |
|5 |Add .github/SECURITY.md                                    |1.5    |☐                                               |
|6 |Improve CI workflow (add Node.js matrix, pin Bun, coverage)|2.1    |🔶 CI exists, needs improvements                 |
|7 |Add publish workflow (.github/workflows/publish.yml)       |2.2    |☐                                               |
|8 |Update packages/core/package.json for publishing           |3.1    |☐                                               |
|9 |Update packages/hook-server/package.json                   |3.2    |☐                                               |
|10|Update packages/mcp-gateway/package.json                   |3.3    |☐                                               |
|11|Update packages/cli/package.json with bin field            |3.4    |☐                                               |
|12|Bring opencode-plugin into workspace + add tests           |3.5    |☐                                               |
|13|Create docs/USER_DEPLOYMENT.md                             |4.1    |☐                                               |
|14|Create docs/DEPLOYMENT.md                                  |4.2    |☐                                               |
|15|Create docs/TESTING.md                                     |4.3    |☐                                               |
|16|Create docs/NPM_PUBLISHING.md                              |4.4    |☐                                               |
|17|Verify/create planV2.md and AGENTS.md                      |4.5    |☐                                               |
|18|Add CI badge and npm badge to README                       |5.1    |☐                                               |
|19|Add Contributing/Security links to README                  |5.2    |☐                                               |
|20|Add positioning statement to README                        |5.3    |☐                                               |
|21|Add scanner limitations notice to README                   |5.4    |☐                                               |
|22|Verify LedgerStore interface is properly exported          |6.1    |🔶 Implementation exists, verify interface export|
|23|Add WebhookApprovalChannel                                 |6.2    |🔶 Slack/Telegram done, webhook channel needed   |
|24|Update README QUARANTINE description                       |6.3    |✅ Implementation done, README update needed     |
|25|Implement sliding window rate limiter                      |6.4    |☐                                               |
|26|Add structured JSON logging                                |6.5    |☐                                               |
|27|Create examples/claude-code-basic/                         |7.1    |☐                                               |
|28|Create examples/mcp-proxy-cursor/                          |7.2    |☐                                               |
|29|Create examples/programmatic/                              |7.3    |☐                                               |
|30|Restructure git history into logical commits               |8      |☐                                               |
|31|Tag v0.1.0 and create GitHub Release                       |9.1-9.2|☐                                               |
|32|Verify npm packages published correctly                    |9.3    |☐                                               |

-----

## Notes for LLM Execution

- **Do not add dependencies** unless explicitly listed in this plan. Warden’s constraint is minimal deps.
- **Do not refactor existing code** beyond what this plan specifies. The scope is additive.
- **Run `npx tsc --noEmit` after every file change.** If it fails, fix before moving on.
- **Run `npx vitest run` after every test addition.** All tests must pass before proceeding.
- **File naming convention:** kebab-case for all new files (e.g., `rate-limiter.ts`, not `rateLimiter.ts`).
- **Error pattern:** Use `Result<T, E>` where applicable in new code. Do not throw exceptions in core package functions.
- **Phase 8 (git history) should be done last**, after all code and file changes are committed. Otherwise you’ll be restructuring incomplete work.
- **Phase 1 and Phase 2 can be done in parallel** since they don’t touch the same files.
- **Manual steps** (GitHub UI settings, npm scope registration, secrets) are marked clearly — an LLM cannot do these, flag them for the human.

-----

## Phase 10: V2-Specific Issues to Address

These are new concerns introduced by or revealed in the v2 commit (d23bb62).

### 10.1 — Docker config uses minimal config schema that may not match app expectations

The CI workflow creates a smoke-test config with `rules: []` and `defaults: { decision: DENY }` but the app expects `warden.config.yml` with `version`, `meta`, `mcpServers`, `policies` keys (per README). **Verify** the config-source module handles both schemas gracefully, or update the CI smoke-test config to match the real schema.

### 10.2 — CHECKLIST.md in repo root is internal process, not user-facing

`CHECKLIST.md` is a production hardening checklist with agent dispatch instructions (`@implementer`, `@reviewer`). This is internal tooling that shouldn’t be in the published package or repo root long-term. Move it to `docs/internal/CHECKLIST.md` or `.github/CHECKLIST.md` and add it to `.npmignore`.

### 10.3 — README not updated to reflect v2 architecture changes

The v2 commit renamed `ContextManager` to `ContextStore`, added `config-source.ts`, `trust-registry.ts`, and significantly expanded the approval system. The README still references the old names and doesn’t document the new modules. **Update:**

- Architecture tree to include `config-source.ts` and `trust-registry.ts`
- ContextManager references → ContextStore
- Approval channels section to mention the typed interface
- Test counts (no longer 104 — significantly more after +4,171 lines)

### 10.4 — Verify test counts and all tests pass

The v2 commit claims extensive new tests but the commit was one big squash. Run `npx vitest run --reporter=verbose` and record the actual passing test count. Update the README Testing section with the real number.

### 10.5 — Dockerfile should have a non-root user

The Dockerfile was added but review it for security best practices:

- Runs as non-root user (add `USER node` or equivalent)
- Uses a specific Node/Bun base image tag (not `latest`)
- Multi-stage build (if not already)
- No secrets baked into the image

### 10.6 — .env.example references LOG_LEVEL but no structured logging exists yet

`.env.example` has `# LOG_LEVEL=info` but there’s no logging module that reads this. Either remove it from `.env.example` until Phase 6.5 (structured logging) is implemented, or implement a minimal log-level check now.