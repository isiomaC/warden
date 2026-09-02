# Warden MCP Gateway

`@stlw/warden-mcp-gateway` adds deterministic, fail-closed policy enforcement to custom MCP tool integrations.

```bash
npm install @stlw/warden-mcp-gateway @stlw/warden
```

```ts
import { MCPRegistry, WardenGateway } from "@stlw/warden-mcp-gateway";

const gateway = new WardenGateway({ config, registry: new MCPRegistry() });
```

Use `@stlw/warden-cli` for the ready-to-run stdio proxy. See the [Warden repository](https://github.com/isiomaC/warden) for integration guides.
