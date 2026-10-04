# Warden agent setup

Warden is a local, deterministic policy layer for agent tool use. It makes no
LLM or remote-service call to decide a policy result.

## Supported runtime

Use Node.js 22 or later. The Warden hook server is **Node-only**. Do not run
`warden start` under Bun: Warden's SQLite-backed ledger depends on
`better-sqlite3`, which is not a supported Bun hook-server runtime.

Install the CLI in the project that owns your Warden configuration:

```bash
npm install --save-dev @stlw/warden-cli@0.2.7
```

## Configure the MCP proxy

Create a configuration only when the project does not already have one:

```bash
npx warden init
```

Review `warden.config.yml`. Add every upstream server Warden may expose under
`mcpServers.allowed`; an empty allowlist makes `warden proxy` refuse to start.
Validate the configuration before connecting an agent:

```bash
npx warden config-validate
```

Point your coding agent at `npx warden proxy`. The proxy is a stdio MCP server
and governs only MCP tools routed through it. Verify expected behavior before
relying on a new policy:

```bash
npx warden policy --tool read_file --environment development
npx warden policy --tool write_file --trust EXTERNAL --environment production
```

Inspect and retain the resulting audit evidence for the CLI's SQLite ledger:

```bash
npx warden audit --db .warden/ledger.db --export json > warden-audit.json
```

The OpenCode plugin writes its own append-only decision ledger at
`.warden/opencode-ledger.jsonl`. Export it with:

```bash
npx warden audit --jsonl .warden/opencode-ledger.jsonl --export json > opencode-audit.json
```

## Agent capability matrix

Choose the integration by the kind of tools you need Warden to govern. An MCP
proxy governs only calls the agent routes through that proxy; it does not
intercept native filesystem, shell, or editor tools.

| Agent / setup | What Warden governs | Current status and limitation |
| --- | --- | --- |
| OpenCode project plugin | Native tools covered by the plugin hooks; MCP tools only when configured through Warden's proxy | **Verified** for allow/deny and destructive-command denial in the 0.2.6 disposable-project test. |
| Codex CLI bundled plugin | No tool path is established by the plugin alone | **Known integration limitation:** in the tested Codex CLI 0.158.0 session, the plugin was enabled but the plugin MCP process does not start. To govern MCP tools, manually merge the Warden server entry below into the project's `.codex/config.toml`; this tested workaround does not govern native Codex tools. |
| Claude Code via MCP proxy | MCP tools registered through `npx warden proxy` | **Documented path; live MCP validation pending.** Native Claude tools are not governed by this proxy. |
| Claude Code native HTTP hooks | Native tools only while hook requests are delivered and handled | **Native HTTP hooks are not outage-safe for enforcement.** A physical outage test showed Claude continued a native tool after the Warden HTTP endpoint refused the connection; [Claude's hook contract](https://code.claude.com/docs/en/hooks) also says hook timeouts do not block. Do not use this path when Warden must guarantee native-tool denial. |
| GitHub Copilot SDK hook example | Intended for the SDK's configured hook path | **Example only; not live-tested.** Do not assume native-tool enforcement until you validate the SDK runtime and failure behavior for your setup. |
| Other MCP clients | MCP tools explicitly registered against `npx warden proxy` | **Wire protocol verified; individual applications may be untested.** Native tools remain outside Warden. |

### Codex CLI: tested project-level MCP workaround

The Codex plugin currently supplies setup guidance, but Codex CLI does not
start its bundled MCP process in the tested version. If you want Warden policy
for Codex MCP calls, add this entry yourself to the project's
`.codex/config.toml`, merging it with the file's existing contents:

```toml
[mcp_servers.warden]
command = "npx"
args = ["--yes", "@stlw/warden-cli@0.2.7", "proxy"]
```

This project-level MCP configuration workaround is the verified Codex path for
now. Then verify one allowed and one denied operation through a proxied MCP tool.
Do not replace the existing config file. Warden's plugin installer does not
edit it. This workaround is for MCP tools only; it does not mediate native
Codex tools such as Bash or `apply_patch`.

## Native tool enforcement boundary

An MCP proxy cannot intercept an agent's native tools. For example, a Codex or
Claude Code integration governs MCP tools routed through Warden; native tools
such as Bash and apply_patch remain outside that proxy. Claude Code's HTTP hook
delivery does not fail closed when Warden is unavailable, so native Claude Code
hooks are not a supported security integration. Never infer native-tool
coverage from a Warden skill, plugin, or MCP configuration alone.

The plugin bundles provided for supported agent ecosystems add only their own
declared resources. They do not rewrite an existing user or project agent
configuration. For an agent without a documented, verified skill format, use
this guide and configure its MCP client directly.
