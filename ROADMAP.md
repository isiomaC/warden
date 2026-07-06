# Warden Roadmap

Warden's core promise: a deterministic, fail-closed policy layer for AI agents that runs
entirely on your machine. The enforcement engine is MIT-licensed and stays that way.

Items are ordered by impact. Contributions welcome on any of them — open an issue first
for the larger ones so we can align on design.

## Now: CLI framework migration, citty → incur

A prototype at [`examples/incur-cli/`](examples/incur-cli/) rebuilds `policy`, `scan`,
and `audit` on [incur](https://github.com/wevm/incur) instead of citty and verifies,
end to end, four concrete wins over the current `packages/cli`:

1. **Schema-validated args replace hand-rolled trust-level fallbacks.**
   `policy.ts`/`scan.ts` map `--trust` through a `Record<string, TrustLevel>` that
   silently defaults to `TOOL` on an unrecognized value — confirmed live: `--trust
   BOGUS` today prints `Trust: BOGUS` but *enforces* as `TOOL`, with exit code 0 and
   no warning. Zod schemas reject it before `run()` executes.
2. **MCP auto-registration replaces the hand-rolled server in `proxy.ts`.**
   `proxy.ts:99-147` hand-wires `@modelcontextprotocol/sdk`'s `Server` +
   `ListToolsRequestSchema`/`CallToolRequestSchema` and exposes tools with a
   placeholder `inputSchema: { type: "object" }` — no real input validation.
   incur's built-in `--mcp` flag generates real per-command JSON Schema (enums,
   `required`, `outputSchema`) from the same Zod schemas used for arg parsing, with
   zero SDK plumbing.
3. **`--llms` manifest + `skills add` for agent discovery.** Lets Claude
   Code/OpenCode/Codex load one command manifest instead of parsing `--help` or
   README prose — the same token-efficiency goal Warden already applies to its own
   ledger/quarantine output.
4. **TOON default output** measured at ~20% fewer tokens than the equivalent JSON
   for `audit` (85 vs. 107 tokens in the prototype) — no more hand-formatted
   `process.stdout.write()` template strings.

**Known blocker found during the spike:** incur 0.4.10 depends on
`@modelcontextprotocol/server: ^2.0.0-alpha.2`, a range currently satisfied by
`2.0.0-beta.2`, which moved `StdioServerTransport` out of the package root — this
breaks incur's `--mcp` flag on a plain `npm install` (`StdioServerTransport is not a
constructor`). Worked around locally with an npm `overrides` pin to the exact alpha
version; needs to be reported upstream and re-checked before this ships for real
users, since we can't ask every Warden consumer to carry that override indefinitely.

**Plan:**

- [ ] Report the `@modelcontextprotocol/server` version-range bug upstream to incur.
- [ ] Migrate `packages/cli` commands one at a time (`policy`, `scan`, `audit` first,
      matching the prototype; then `init`, `start`, `supply-chain`, `config-validate`,
      `reset`), keeping `warden` as the single binary name throughout — no user-facing
      break mid-migration.
- [ ] Replace `proxy.ts`'s hand-rolled MCP `Server` with incur's `--mcp` once the
      upstream dependency issue is resolved (or vendored around) for production use;
      wire real tool-input validation into the forwarding path.
- [ ] Ship `warden skills add` / `--llms` so Claude Code and OpenCode can discover
      `warden` commands without reading docs — folds into the existing "Claude Code
      skill" item below.
- [ ] Adopt TOON as the default output format for agent-invoked commands; keep a
      human-readable path (`--format md` or a TTY-detection print) for `warden audit`
      run interactively.
- [ ] Drop the `incur` npm override once upstream fixes the dependency range.

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
