# Warden agent setup

Warden is a local, deterministic policy layer for agent tool use. It makes no
LLM or remote-service call to decide a policy result.

## Supported runtime

Use Node.js 22 or later. The Warden hook server is **Node-only**. Do not run
`warden start` under Bun: Warden's SQLite-backed ledger depends on
`better-sqlite3`, which is not a supported Bun hook-server runtime.

Install the CLI in the project that owns your Warden configuration:

```bash
npm install --save-dev @stlw/warden-cli@0.2.6
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

Inspect and retain the resulting audit evidence when using a persistent ledger:

```bash
npx warden audit --db .warden/ledger.db --export json > warden-audit.json
```

## Enforcement boundary

An MCP proxy cannot intercept an agent's native tools. For example, a Codex
plugin governs MCP tools routed through Warden; native tools such as Bash and
apply_patch remain outside that proxy. A Claude Code hook-server integration is
a separate, explicitly configured integration. Never infer native-tool coverage
from a Warden skill, plugin, or MCP configuration alone.

The plugin bundles provided for supported agent ecosystems add only their own
declared resources. They do not rewrite an existing user or project agent
configuration. For an agent without a documented, verified skill format, use
this guide and configure its MCP client directly.
