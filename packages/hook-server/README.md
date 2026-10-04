# @stlw/warden-hook-server

Local HTTP server implementing Warden's hook contract for clients and adapters that explicitly send it. It handles session lifecycle, prompt submission, pre-tool decisions, post-tool output tagging, and an auditable ledger.

## Install

```bash
npm install @stlw/warden-hook-server @stlw/warden
```

## Start a server in Node.js

`startHookServer` reads your `PolicyConfig`, defaults to port `7429`, and returns the server handle:

```ts
import { startHookServer } from "@stlw/warden-hook-server";
import type { PolicyConfig } from "@stlw/warden";

const config: PolicyConfig = {
  version: "2",
  meta: { environment: "development", sessionApprovalRequired: false },
  policies: [
    {
      id: "allow-reads",
      description: "Allow read tools during development",
      match: { tools: ["read_file", "list_directory"], environment: ["development"] },
      action: "ALLOW",
    },
  ],
};

startHookServer({ config, dbPath: ".warden/ledger.db", port: 7429 });
```

Set `WARDEN_AUTH_TOKEN` (or pass `authToken`) to require `X-Warden-Auth` on hook requests. `/health` remains available for readiness checks:

```bash
curl http://localhost:7429/health
```

## Connect an agent

Claude Code's native HTTP hooks are not supported for native-tool enforcement: Claude Code continues through a native tool when an HTTP hook cannot connect. Route Claude Code MCP tools through `warden proxy` instead. `warden start` serves Warden's own hook contract for integrations that explicitly implement that contract; it is not a Claude Code native-hook endpoint.

See the [public manual](https://github.com/isiomaC/warden/blob/main/docs/MANUAL.md) for supported integration boundaries and setup.
