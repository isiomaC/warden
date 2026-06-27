# Changelog

All notable changes to Warden will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- ApprovalChannel interface with real Slack and Telegram implementations

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
