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
2. **MCP auto-registration can eventually simplify the CLI command surface.**
   The transparent proxy must remain a dedicated MCP gateway because it discovers and forwards upstream tools. Its `0.2.0` implementation already exposes the upstream JSON Schemas; incur's `--mcp` remains relevant only to making Warden's own CLI commands agent-callable.
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
- [ ] Use incur's `--mcp` for Warden's own CLI commands once the upstream dependency issue is resolved; do not replace the transparent upstream gateway with command auto-registration.
- [ ] Ship `warden skills add` / `--llms` so Claude Code and OpenCode can discover
      `warden` commands without reading docs — folds into the existing "Claude Code
      skill" item below.
- [ ] Adopt TOON as the default output format for agent-invoked commands; keep a
      human-readable path (`--format md` or a TTY-detection print) for `warden audit`
      run interactively.
- [ ] Drop the `incur` npm override once upstream fixes the dependency range.

## Near term (0.2.x)

### Implemented for 0.2

- **Transparent forwarding proxy.** `warden proxy` connects to configured stdio or Streamable HTTP MCP servers, discovers real tool schemas, exposes only the configured allowlist, forwards ALLOWed calls, and returns upstream results. DENYed and unknown calls do not reach the upstream.
- **Runtime YAML contract.** The CLI validates proxy endpoints and runtime values; `warden start` honors ledger and vault settings; and `warden proxy` applies ledger, rate-limit, lateral-movement, path/tool allowlist, and Telegram approval settings.

### Remaining
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

Done: a real TCP smoke test for `warden start` (binds an actual port, curls `/health`
over real HTTP, not just `server.fetch()` in-process); test coverage for `policy`, `scan`,
`reset`, `start`, and `proxy`; a trust-propagation e2e test; and coverage thresholds in
`vitest.config.ts` (85% on `packages/core`, 78% floor elsewhere), enforced in CI.

Along the way, writing those tests surfaced real bugs and gaps, now fixed or tracked below:

- **Fixed:** `policy`/`scan` silently fell back to `TrustLevel.TOOL`/`EXTERNAL` on an
  invalid `--trust` value instead of rejecting it — a bad flag silently changed the
  enforcement outcome instead of erroring.
- **Fixed:** `config-validate`'s hash-verification branch was dead code — it called
  `source.verify(config)` on the exact object `source.load()` had just returned, which
  can never fail. The only real check was always duplicate-rule-ID detection.
- **Fixed:** `reset --all` only ever deleted the ledger — identical to `--ledger` — despite
  being documented as resetting "ledger + config". Now also clears `.warden/pins.json` and
  `.warden/supply-chain-pins.json` (still leaves `warden.config.yml` alone; deleting a
  hand-authored policy file on `--all` seemed like the wrong default to guess at).
  `reset`'s usage line also no longer prints after a real `--ledger`/`--all` run.
- **New, higher priority than "add a test":** `better-sqlite3` does not load under Bun's
  runtime (a native-binding limitation — see
  [oven-sh/bun#4290](https://github.com/oven-sh/bun/issues/4290)). Any spawned `warden`
  command that opens the SQLite ledger (`audit --db`, `start`) crashes if actually
  executed via `bun run`, which is how this repo's own test harness invokes the CLI
  when Bun is present — and Bun is the README's stated primary runtime. Needs either an
  upstream Bun fix, a pure-JS/WASM SQLite fallback, or a documented "run `warden start`
  under Node" caveat so this isn't discovered in production.
- **New:** nothing in the real request-handling path ever registers a value as EXTERNAL
  trust. `PostToolUse` always tags tool output via `tagValue(output, \`mcp__${tool}\`, ...)`,
  and `inferTrust()` returns `TOOL` for any `mcp__`-prefixed source unconditionally —
  `trustRegistry.register()` has exactly one call site in the whole codebase, and it's
  that one, always with `TOOL`. The QUARANTINE-on-EXTERNAL story only exists in tests that
  seed the registry directly; there's no code path that would ever do this from a real
  tool call today. Needs a real external-content classifier (e.g. tools that fetch URLs or
  read arbitrary paths marked as EXTERNAL-sourcing) before this protection is real.
- **New:** `TrustRegistry.register()` is first-write-wins (a second registration for an
  already-seen value just logs a conflict warning and keeps the original trust). This means
  even a future external-content classifier could not retroactively correct a value's trust
  after `PostToolUse` has already registered it as `TOOL` — it would have to run first.
- **New:** the QUARANTINE policy match and the actual sanitization step check the trust
  registry at different granularities. `quarantine-external` fires off a whole-object
  `trustRegistry.lookup(tool_input)` hit, but `sanitizeExternalValues` only strips fields
  whose *individual* values are separately registered as EXTERNAL. Registering only the
  whole input object triggers QUARANTINE but leaves the output completely unsanitized —
  confirmed by running the new e2e test with just the whole-object registration.

## Explicit non-goals

- **No LLM in the security path.** Policy evaluation and injection scanning stay
  deterministic pattern matching. An LLM judging your security decisions is an attack surface.
- **No hosted enforcement.** Enforcement runs on your machine. Anything that would require
  routing your tool calls through someone else's server is out of scope for the OSS core.
