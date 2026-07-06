# Warden Roadmap

Warden's core promise: a deterministic, fail-closed policy layer for AI agents that runs
entirely on your machine. The enforcement engine is MIT-licensed and stays that way.

Items are ordered by impact. Contributions welcome on any of them — open an issue first
for the larger ones so we can align on design.

## Near term (0.2.x)

- **Transparent forwarding proxy.** `warden proxy` currently enforces policy (ALLOW/DENY)
  but does not relay calls to backing MCP servers — agents must connect to their real
  servers separately. The plan: spawn configured stdio servers as child processes, forward
  ALLOWed calls via the MCP client SDK, and return real results. This completes the
  Cursor/Windsurf story.
- **Wire the ignored YAML config blocks.** `approvalChannels`, `ledger`, `threatDetection`,
  `rateLimits`, and `vault` are parsed but dropped today (documented in the README).
  `warden start` should honor them so the config file is the single source of truth it
  claims to be.
- **Claude Code skill.** A `/warden` skill so agents can invoke `warden audit`, `warden scan`,
  and `warden policy` naturally during a session.

## Mid term (0.3.x+)

- **Persistent vault.** Session tokens currently live in memory and die on restart.
- **Policy packs.** Shareable, versioned policy bundles — `warden init --pack strict-prod`,
  a community registry of curated packs for common stacks.
- **Interactive Slack approvals.** Slack is notify-only today (no public callback endpoint
  to receive button clicks). Telegram and stdout channels are fully interactive.
- **Structured audit export.** `warden audit --export json|csv` for compliance pipelines,
  built on the hash-chained ledger.
- **Windows support validation.** Path handling and CI coverage for win32.

## Distribution (ongoing)

- **npm** is the primary channel — `publish.yml` already publishes the 4 public packages
  with provenance on GitHub release.
- **Docker image on GHCR** — done, publishes alongside npm on release.
- **Agent marketplace listings** — submit to the Claude Code plugin/skill marketplace,
  OpenCode's plugin registry, and any MCP server registries, so Warden is discoverable
  where its target users already look.
- **Homebrew tap** — `brew install warden` for users who don't want to go through npm.
- **Changesets** for version/changelog management across the 4 published packages, once
  release cadence picks up beyond manual version bumps.

## Test hardening (ongoing)

- Real TCP smoke test (bind port, curl `/health`) — current server tests are in-process.
- Tests for `start`, `scan`, `reset`, `policy`, `config-validate` CLI commands.
- Trust-propagation e2e: EXTERNAL-tagged tool output triggering QUARANTINE on the next write.
- Coverage thresholds in `vitest.config.ts` so regressions fail CI.

## Explicit non-goals

- **No LLM in the security path.** Policy evaluation and injection scanning stay
  deterministic pattern matching. An LLM judging your security decisions is an attack surface.
- **No hosted enforcement.** Enforcement runs on your machine. Anything that would require
  routing your tool calls through someone else's server is out of scope for the OSS core.
