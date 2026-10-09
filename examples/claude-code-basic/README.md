# Warden + Claude Code: MCP proxy

This example demonstrates Warden's supported Claude Code boundary: MCP tools
explicitly routed through the local Warden proxy. Claude Code's native HTTP
hooks are not supported for native-tool enforcement because a failed or
unavailable HTTP hook does not block the native tool.

## Prerequisites

- Node.js 22 or later
- Claude Code CLI
- A reviewed `warden.config.yml` with the upstream MCP servers to proxy

The `warden.config.yml` in this directory is a disposable example. Review its
policies and upstream server definition before using it.

## Use the proxy

From this directory, register Warden as a project-scoped MCP server:

```sh
claude mcp add --scope project warden -- npx --yes @stlw/warden-cli@0.2.8 proxy
claude mcp list
```

This is an explicit Claude Code CLI operation that writes its MCP registration
to the selected project scope. It does not configure native Claude tools. For
policy verification, invoke one expected allow and one expected deny through a
Warden-provided MCP tool, then inspect the Warden ledger with:

```sh
npx --yes @stlw/warden-cli@0.2.8 audit --export json
```

The Warden hook server (`warden start`) is a separate HTTP contract for clients
that explicitly implement Warden's hook protocol; it is not Claude Code's
native HTTP hook endpoint.
