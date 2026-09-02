# @stlw/warden-hook-server

Local HTTP hooks that apply Warden policy to Claude Code, Codex CLI, and Copilot SDK tool calls. The server handles session lifecycle, prompt submission, pre-tool decisions, post-tool output tagging, and an auditable ledger.

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

For Claude Code, point its HTTP hooks at `http://localhost:7429/hooks/...` and include the shared-secret header. The CLI configures the same server with `warden start`; use that for the quickest setup.

See the [public manual](https://github.com/isiomaC/warden/blob/main/docs/MANUAL.md) for the complete Claude Code settings example and OpenCode integration.
