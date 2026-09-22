---
name: warden-policy
description: Configure and verify local Warden policy enforcement for MCP tools in Codex.
---

# Warden MCP policy for Codex

1. Install Node.js 22+ and the matching `@stlw/warden-cli` release.
2. Run `warden init` only if this project has no `warden.config.yml`.
3. Configure each upstream MCP server under `mcpServers.allowed` in `warden.config.yml`.
4. Install and enable the Warden Codex plugin; it starts `warden proxy` as its stdio MCP server.
5. Verify one expected allow and one expected deny through a proxied MCP tool before relying on the policy.

The plugin does not create, merge, or overwrite `.codex/config.toml`. It governs only MCP tools routed through Warden's proxy; it does not govern native Codex tools such as Bash or apply_patch. Warden policy evaluation is local and deterministic; it does not use an LLM or a remote judgment service.
