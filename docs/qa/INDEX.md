# Warden QA Index

Master log of live end-to-end testing — what was tested, when, status, and
pointers to detailed reports.

| Surface | Date | Status | Report | Open Findings |
|---|---|---|---|---|
| **A — CLI walkthrough** | 2026-07-10 | PASS | [surface-a-cli.md](2026-07-10/surface-a-cli.md) | 0 |
| **B — MCP proxy** | 2026-07-10 | PASS | [surface-b-mcp.md](2026-07-10/surface-b-mcp.md) | 0 |
| **C1 — Claude Code HTTP hooks** | 2026-07-10 | PASS | [surface-c1-rest-claude.md](2026-07-10/surface-c1-rest-claude.md) | 0 |
| **C2 — OpenCode plugin** | 2026-07-10 | PASS | [surface-c2-rest-opencode.md](2026-07-10/surface-c2-rest-opencode.md) | 2 (core must be built, prompt inject visibility) |
| **E — Core unit/integration** | 2026-07-10 | PASS | [surface-e-core.md](2026-07-10/surface-e-core.md) | 0 |
| **F — Telegram approval** | 2026-07-10 | PASS | [surface-f-telegram.md](2026-07-10/surface-f-telegram.md) | 0 |

## Summary

| Metric | Value |
|---|---|
| Total test files | 30 |
| Total tests passed | 365 |
| Test failures | 0 |
| Duration | 36.78s |
| Pass rate | 100% |

## Live e2e Findings

1. **OpenCode plugin enforcement CONFIRMED** — `opencode run` with `@warden/opencode-plugin` blocks unauthorized tools with `Warden BLOCKED` errors
2. **Claude Code headless CONFIRMED** — `claude -p` fires PreToolUse/PostToolUse hooks when using `--output-format stream-json --include-hook-events --verbose`
3. **`warden proxy` wire protocol CONFIRMED** — spawned process, `tools/list` + `tools/call` over stdio JSON-RPC, ALLOW/DENY enforced
4. **`--auto-approve` flag added** — `warden start --auto-approve` uses `AutoApproveApprovalChannel` to auto-approve all CONFIRM prompts
5. **QUARANTINE wired up** — PostToolUse scans output for injection patterns and registers EXTERNAL trust. Trust registry allows downgrade. PreToolUse checks field-level values.
6. **Telegram approval channel CONFIRMED** — live bot with inline Approve/Deny buttons, human click confirmed working

## Agent Integration Test Status

| Agent | Path | Status | Evidence |
|---|---|---|---|
| Claude Code | `claude -p` (headless) | **Verified** | ALLOW/DENY in ledger, 2026-07-10 |
| Claude Code | `claude` (interactive TUI) | Documented | Same hook protocol; TTY automation not implemented |
| OpenCode | `opencode run` (headless) | **Verified** | `Warden BLOCKED` confirmed, 2026-07-10 |
| OpenCode | `opencode` (interactive TUI) | Documented | Same plugin runtime; TTY automation not implemented |
| Cursor/Windsurf/etc. | `warden proxy` (MCP wire) | **Verified** | Spawned process tests, 2026-07-10 |
| Cursor/Windsurf/etc. | Actual GUI apps | Untested | Needs Electron UI automation — out of scope |
| Copilot SDK | Hook handler in `agent.json` | Documented | Code example exists, never run live |
| Codex CLI | Hook script via `codex hooks set` | Documented | Code example exists, never run live |
| Continue.dev / Cody / Amazon Q | `warden proxy` (MCP stdio) | Documented | Same proxy path as Cursor/Windsurf |
| Aider | Process-level proxy | Documented | No integration built |

## Coverage Summary

| Surface | What it covers | Mapped to e2e-plan.md |
|---|---|---|
| A — CLI | `warden init`, `audit`, `start`, `proxy`, `policy`, `scan`, `reset`, `config-validate`, `supply-chain` | Phase 3 |
| B — MCP | `warden proxy` — tools/list, tools/call over stdio JSON-RPC | Phase 2 |
| C1 — Claude Code | `claude -p` headless with HTTP hooks → `warden start` | Phase 1 |
| C2 — OpenCode | `opencode run` with `@warden/opencode-plugin` loaded | Phase 1 |
| E — Core | `packages/core/tests/` unit tests + `packages/hook-server/tests/` integration | Layer 1 + 2 |
| F — Telegram | `TelegramApprovalChannel` — real bot, real button clicks, CONFIRM flow | Approval channels |

## Out of Scope

| Surface | Reason |
|---|---|
| D — Docker | No Docker deployment artifacts tested; deployment handled by docs/internal/DEPLOYMENT.md |
| Cursor/Windsurf GUI | Requires UI automation of third-party Electron apps; MCP wire protocol (Surface B) is the faithful substitute |
| Slack live CONFIRM | Requires real Slack bot account + workspace; already unit-tested with mocked APIs |

## Resolved Gaps

- **QUARANTINE** — Wired up 2026-07-10. Three fixes: (1) trust registry now allows downgrade (TOOL→EXTERNAL), (2) PostToolUse scans tool output with `scanForInjection` and registers EXTERNAL trust, (3) PreToolUse recursively checks individual field values for EXTERNAL trust.
- **Hook server build** — Fixed 2026-07-10 with composite project references in tsconfigs. Full `tsc --build` now succeeds.
- **Claude Code headless hooks** — Resolved 2026-07-10. `claude -p` fires PreToolUse/PostToolUse when using `--output-format stream-json --include-hook-events --verbose`. Session auto-created from Claude's `session_id`.
- **CONFIRM from YAML** — Resolved 2026-07-10. `approvalChannels` in `warden.config.yml` now wired to `warden start`. Supports `${VAR}` env var substitution. Telegram channel confirmed working live.
- **CLI argv parsing layer** — Resolved 2026-07-10. Added spawned smoke tests for `policy`, `scan`, `reset`, `config-validate`, `supply-chain` (6 new tests, 365/365 pass).

## Known Gaps

- **`@warden/core` must be built** for opencode plugin — source imports don't resolve in opencode's runtime. `npm run build --workspace=packages/core` required before plugin testing.

## Quick Links

- [Full e2e test plan](../e2e-plan.md)
- [Unit/integration test docs](../TESTING.md)
- [ROADMAP.md](../internal/ROADMAP.md)
- [Latest session bugs](2026-07-10/bugs.md)
- [Session summary](2026-07-10/summary.md)
