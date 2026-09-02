# @stlw/warden-mcp-gateway

Policy enforcement for custom MCP integrations. `MCPRegistry` defines which servers and tools may be reached; `WardenGateway` checks each call for allowlist, path, OAuth, rate-limit, lateral-movement, and policy violations before your MCP client executes it.

## Install

```bash
npm install @stlw/warden-mcp-gateway @stlw/warden
```

## Quick start

Create a registry, construct the gateway with a ledger and context manager, then wrap an allowed server:

```ts
import { ContextManager, MemoryLedgerStore, TrustLevel } from "@stlw/warden";
import { MCPRegistry, WardenGateway } from "@stlw/warden-mcp-gateway";

const registry = new MCPRegistry([
  {
    name: "filesystem",
    type: "local",
    transport: "stdio",
    allowedTools: ["read_file"],
    authRequired: false,
  },
]);

const gateway = new WardenGateway({
  config,
  ledger: new MemoryLedgerStore(),
  contextManager: new ContextManager(),
  registry,
});

const filesystem = gateway.wrapMCP("filesystem", {
  serverName: "filesystem",
  allowedTools: ["read_file"],
  trustLevel: TrustLevel.TOOL,
  maxCallsPerMinute: 120,
});

const decision = await filesystem.onToolCall(
  "read_file",
  { path: "./README.md" },
  "session-1",
  "task-1",
);
if (decision.action !== "ALLOW") throw new Error(decision.reason);
```

`config` is the `PolicyConfig` loaded from your Warden configuration. Keep the registry restrictive: an unlisted server or tool is denied before policy evaluation. Use `allowedPaths` for filesystem boundaries and `authRequired: true` for servers that need OAuth credentials.

## Prefer the CLI when possible

If you do not need a custom MCP client, `@stlw/warden-cli` provides the ready-to-run `warden proxy` stdio server. See the [public manual](https://github.com/isiomaC/warden/blob/main/docs/MANUAL.md) for client configuration and the [CLI package](https://www.npmjs.com/package/@stlw/warden-cli).
