# Changelog

All notable changes to Warden will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

#### CLI
- `init` now actually writes `warden.config.yml` and `.warden/` instead of only printing a fake hash
- `supply-chain` now reads the project's real `package.json`/`package-lock.json` instead of checking three hardcoded fake dependencies
- Added `packages/cli/tests/` with unit tests asserting `init`'s and `supply-chain`'s actual file-system side effects, not just spawned-binary stdout matching

#### Hook Server
- Fail-closed handling now registered via Hono's `app.onError()` instead of a `try/catch`-around-`next()` middleware — under Hono 4.x's `compose()`, that middleware pattern never observed downstream handler errors, so an unhandled exception previously returned a plain-text "Internal Server Error" instead of the documented structured Warden DENY response; this is now covered by both a unit test and a real-server regression test
- `hookEventName` in fail-closed responses is now resolved via an exact path→name lookup table instead of substring-matching the URL, fixing mislabeling on some routes
- `session-start` now validates `environment` against an explicit enum and rejects empty/non-array `allowedTools` instead of silently defaulting
- `.warden/pins.json` path is now configurable (`pinsPath` option / `warden start --pins`) instead of hardcoded relative to `process.cwd()`
- Slack approval channel relabeled and documented as notify-only (it cannot receive the approval click back) instead of silently always denying while appearing interactive; Telegram approval channel is now the real interactive implementation

#### MCP Gateway
- `OAuthManager` is now actually enforced in `onToolCall` — calls to an `authRequired` server with no stored token are DENYed instead of the OAuth check being dead code

#### Core
- Config-source YAML parser rewritten to fail loudly on unsupported/malformed syntax instead of silently mis-parsing it (block-sequence-of-mappings in particular)
- All ledger and security-event IDs now generated via a shared `generateId()` (ULID-backed) helper instead of `Date.now()`-based string concatenation, removing a collision risk under high throughput
- `TrustRegistry` now logs a warning when a re-registration attempts a different trust level or source for an already-registered value, instead of silently discarding the conflicting attempt

#### Docs
- README/TESTING.md test-count and file-count claims re-synced to the actual suite (307 passed, 3 skipped, 310 total, 23 files)

### Added

#### Core
- Config-source module with hash-verified policy loading
- Trust-registry module for EXTERNAL content tagging
- ContextStore interface (renamed from ContextManager)
- 9 prompt injection detection patterns in scanner
- Token lifecycle, scope, and TTL enforcement in vault

#### Ledger
- Append-only hash-chained entries with `verifyChain()`

#### Hook Server
- Auth middleware for hook server token verification
- QUARANTINE content stripping in pre-tool-use handler

#### Approval Channels
- ApprovalChannel interface with a real (interactive) Telegram implementation and a notify-only Slack webhook implementation

#### MCP Gateway
- `onToolCall` ALLOW/DENY/CONFIRM paths
- Rate limiting
- Lateral movement detection with enabled flag

#### CLI
- `config validate` command
- `config reset` command
- Audit chain verification command

#### Infrastructure
- Dockerfile
- `docker-compose.yml`
- GitHub Actions CI workflow
- `.env.example`
- `.dockerignore`

#### Tests
- End-to-end test suite (1,068 lines)
- Integration tests (+706 lines)
- Approval channel tests (322 lines)
- Gateway tests (+377 lines)
- Config-source tests
- Trust-registry tests
- SQLite ledger tests
- Vault tests
- Context tests

## [0.1.0] - 2025-XX-XX

### Added

#### Core
- Deterministic policy engine with ALLOW/DENY/CONFIRM/QUARANTINE evaluation
- Hash-chained append-only audit ledger via better-sqlite3
- Trust tagger with 4-level model (SYSTEM/AGENT/TOOL/EXTERNAL)
- Ephemeral scoped token vault (jose)
- Per-task context isolation manager
- Injection pattern scanner (regex-based, no LLM in security path)
- Tool description pinning with SHA-256 rug-pull detection
- Secret redaction before ledger writes
- Package integrity / supply-chain verification

#### Hook Server (Hono, localhost:7429)
- All 6 Claude Code hook handlers: SessionStart, SessionEnd, PreToolUse, PostToolUse, PromptSubmit, ConfigChange
- Fail-closed middleware (any error returns DENY)

#### MCP Gateway
- Server allowlist with `MCPRegistry`
- `wrapMCP()` drop-in policy enforcement
- OAuth 2.1 token management for remote MCP servers
- Cross-server lateral movement detection

#### CLI (citty)
- `init` — initialize Warden in current project
- `start` — start hook server
- `audit` — view hash-chained ledger
- `policy test` — dry-run policy evaluation
- `scan` — prompt injection scanning
- `supply-chain` — package integrity verification

#### Platform Integration
- OpenCode plugin
- Claude Code hook configuration

#### Configuration
- YAML-based policy configuration (`warden.config.yml`) — single source of truth, hashed at session start
