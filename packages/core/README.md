# @stlw/warden

Deterministic, fail-closed authorization for autonomous agent actions. Use the core library when your application needs to decide whether an agent may perform an action without putting an LLM in the security path.

## Install

```bash
npm install @stlw/warden
```

## Quick start

Define a policy, evaluate a request, and inspect the decision:

```ts
import { createWarden, definePolicy } from "@stlw/warden";

const policy = definePolicy({
  id: "project-policy",
  version: 1,
  rules: [
    { id: "allow-reads", effect: "ALLOW", conditions: [{ name: "action.toolName", value: "read_file" }] },
    { id: "deny-writes", effect: "DENY", conditions: [{ name: "action.toolName", value: "write_file" }] },
  ],
});

const warden = createWarden({
  extensions: [{
    name: "tool-conditions",
    version: "1.0.0",
    conditions: [{
      name: "action.toolName",
      evaluate: (request, expected) => request.action === expected,
    }],
  }],
});
const decision = await warden.evaluate(policy, {
  subject: { id: "agent-1" },
  action: "read",
  resource: { id: "document-1" },
});

console.log(decision.effect); // ALLOW
```

Rules are evaluated deterministically. A request with no matching rule, an invalid policy, or an evaluation error is denied; add conditions to distinguish actions, subjects, resources, or context in your application.

## Use Warden with an agent

- Use [`@stlw/warden-cli`](https://www.npmjs.com/package/@stlw/warden-cli) to create a `warden.config.yml`, validate policies, run the hook server, or expose an MCP proxy.
- Use [`@stlw/warden-hook-server`](https://www.npmjs.com/package/@stlw/warden-hook-server) for Claude Code, Codex CLI, or Copilot SDK HTTP hooks.
- Use [`@stlw/warden-mcp-gateway`](https://www.npmjs.com/package/@stlw/warden-mcp-gateway) to enforce an MCP server allowlist in a custom integration.

See the [public manual](https://github.com/isiomaC/warden/blob/main/docs/MANUAL.md) for policy configuration and integration examples.
