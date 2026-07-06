# Prototype: Warden CLI on incur

A spike proving out the `citty` → [`incur`](https://github.com/wevm/incur) migration
tracked in [ROADMAP.md](../../ROADMAP.md). `warden-incur.ts` reimplements three real
`packages/cli` commands (`policy`, `scan`, `audit`) against the same `@warden/core`
primitives (`evaluate`, `scanForInjection`, `MemoryLedgerStore`/`SqliteLedgerStore`) —
only the CLI framework changes, not the enforcement logic.

Every claim below was run against `incur@0.4.10`, not assumed from the README.

## Setup

```bash
npm install   # incur is already a root devDependency + npm override, see below
npm run build --workspace=packages/core   # warden-incur.ts imports @warden/core
```

> **Known issue found during this spike:** incur's `package.json` depends on
> `@modelcontextprotocol/server: ^2.0.0-alpha.2`, but that range is currently
> satisfied by `2.0.0-beta.2` (newer prerelease, same `2.0.0` tuple). Beta.2 moved
> `StdioServerTransport` out of the package root and into the `/stdio` subpath, so
> `incur`'s compiled `--mcp` handler (`dist/Mcp.js`, which destructures
> `StdioServerTransport` from the root import) crashes with `StdioServerTransport is
> not a constructor` on a plain `npm install`. The root `package.json` in this repo
> pins around it with:
> ```json
> "overrides": { "incur": { "@modelcontextprotocol/server": "2.0.0-alpha.2" } }
> ```
> This is a real upstream packaging bug (loose prerelease range), not a
> misconfiguration on our side — worth reporting upstream, and worth re-checking
> (and removing the override) once `incur` bumps its dependency.

## What each feature demonstrates

### 1. Zod schemas replace the hand-rolled `trustMap` fallback

`packages/cli/src/commands/policy.ts:76-91` and `scan.ts:22-29` map `--trust` through
a `Record<string, TrustLevel>` and silently fall back to a default on an unrecognized
value — a bad flag becomes a different trust level instead of an error, which matters
because trust level changes the ALLOW/DENY outcome.

```bash
# citty CLI: --trust BOGUS silently becomes TrustLevel.TOOL, decision proceeds
npx tsx packages/cli/src/index.ts policy --tool write_file --trust BOGUS --environment production

# incur prototype: rejected before run() executes
npx tsx examples/incur-cli/warden-incur.ts policy --tool write_file --trust BOGUS --environment production
# → code: VALIDATION_ERROR
# → message: "Invalid option: expected one of \"SYSTEM\"|\"AGENT\"|\"TOOL\"|\"EXTERNAL\""
```

### 2. MCP auto-registration replaces the hand-rolled server in `proxy.ts`

`packages/cli/src/commands/proxy.ts:99-147` constructs a raw
`@modelcontextprotocol/sdk` `Server`, wires `ListToolsRequestSchema` /
`CallToolRequestSchema` by hand, and exposes tools with a placeholder
`inputSchema: { type: "object" }` — no real validation on the way in. incur gets
this for free from the same Zod schemas used for argument parsing:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | npx tsx examples/incur-cli/warden-incur.ts --mcp
```

Returns real per-command JSON Schema (enums, `required`, `outputSchema`) —
compare to `proxy.ts`'s `{ type: "object" }` stub:

```json
{"name":"policy","inputSchema":{"type":"object","properties":{"tool":{"type":"string"},"trust":{"enum":["SYSTEM","AGENT","TOOL","EXTERNAL"],...}},"required":["tool"]},"outputSchema":{...}}
```

And `tools/call` actually executes the command and returns `structuredContent`:

```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"policy","arguments":{"tool":"write_file","trust":"SYSTEM","environment":"production"}}}' \
  | npx tsx examples/incur-cli/warden-incur.ts --mcp
```

No hand-written `Server`/request-schema plumbing at all — `proxy.ts`'s ~50 lines of
MCP SDK wiring (lines 99-147) become the built-in `--mcp` flag.

### 3. `--llms` manifest + skill-file discovery

```bash
npx tsx examples/incur-cli/warden-incur.ts --llms
```

```
# warden

Warden — Security layer for MCP-connected AI agents (incur prototype)

| Command | Description |
|---------|-------------|
| `warden audit` | View and verify the action ledger |
| `warden policy` | Dry-run policy evaluation |
| `warden scan` | Scan a prompt for injection patterns |
```

An agent driving `warden` (Claude Code, OpenCode, etc.) can load this once instead
of parsing `--help` output or README prose. `npx tsx examples/incur-cli/warden-incur.ts skills add`
generates the equivalent Claude Code/OpenCode skill file on disk (not run in this
spike to avoid writing into a shared agent config directory — see incur's own docs).

### 4. TOON output vs. hand-formatted strings

`packages/cli/src/commands/audit.ts:24-53` builds output with manual
`process.stdout.write()` template strings. Returning a plain object instead gets
TOON by default, `--format json/yaml/md` for free, and measurably fewer tokens:

```bash
npx tsx examples/incur-cli/warden-incur.ts audit --demo --token-count          # → 85
npx tsx examples/incur-cli/warden-incur.ts audit --demo --format json --token-count  # → 107
```

## Not migrated in this spike

- `init`, `start`, `supply-chain`, `config-validate`, `reset` — not touched; the spike
  only covers the three commands most illustrative of the four features above.
- The `.command('proxy')` / real MCP-forwarding path is not reimplemented here — only
  `--mcp`'s tool exposure is demonstrated. Actual policy-gated forwarding to backing
  MCP servers is tracked separately in ROADMAP.md ("Transparent forwarding proxy").
- `warden skills add` was inspected via `--help` but not executed, since it writes
  into `~/.claude/skills` or similar shared agent config — run it manually if you
  want to see the generated skill file.
