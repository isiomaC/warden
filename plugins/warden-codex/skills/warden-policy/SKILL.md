---
name: warden-policy
description: Configure and verify local Warden policy enforcement for Codex tools and MCP servers.
---

# Warden policy for Codex

1. Install Node.js 22+ and `@stlw/warden-cli@0.2.2`.
2. Run `warden init` only if this project has no `warden.config.yml`.
3. Configure each upstream MCP server under `mcpServers.allowed` in `warden.config.yml`.
4. Start the local policy server with `warden start` in a separate terminal.
5. Install and enable the Warden Codex plugin.
6. Verify one expected allow and one expected deny before relying on the policy.

The plugin does not create, merge, or overwrite `.codex/config.toml`. If the local policy server cannot be reached, PreToolUse fails closed and denies the action. Warden policy evaluation is local and deterministic; it does not use an LLM or a remote judgment service.
