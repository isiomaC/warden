# @stlw/warden-cli

The Warden command-line interface for protecting local AI-agent projects. It manages policy configuration, starts the hook server, runs dry-run checks, and exposes a policy-enforced MCP proxy.

## Install

```bash
npm install --global @stlw/warden-cli
warden --help
```

## Quick start

Run these commands from the project you want to protect:

```bash
warden init --environment development
warden config-validate
warden policy --tool read_file --trust SYSTEM --environment development
warden start
```

`init` creates `warden.config.yml` and `.warden/`. Edit the policy file before starting Warden. Use `development` while tuning rules, then validate the same policy in `staging` or `production` before rollout.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `warden config-validate` | Validate the YAML schema and detect rule conflicts. |
| `warden policy --tool <name> --trust <level> --environment <env>` | Dry-run one tool decision. |
| `warden scan --prompt "<text>"` | Check a prompt for injection patterns. |
| `warden start` | Start the HTTP hook server on port 7429. |
| `warden proxy` | Run a stdio MCP server for Cursor, Windsurf, and other MCP clients. |
| `warden audit` | View and verify the tamper-evident action ledger. |
| `warden supply-chain` | Check dependencies against pinned package hashes. |

For MCP-only clients, register `warden proxy` as a stdio server and keep the target servers in `mcpServers.allowed` in `warden.config.yml`.

See the [public manual](https://github.com/isiomaC/warden/blob/main/docs/MANUAL.md) for the config schema and Claude Code, OpenCode, Cursor, and Windsurf setup.
