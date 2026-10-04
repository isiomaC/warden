---
name: warden-policy
description: Configure and verify local Warden policy enforcement for MCP tools in Codex.
---

# Warden MCP policy for Codex

Follow the canonical setup and verification guide at
[`docs/AGENT_SETUP.md`](../../../../docs/AGENT_SETUP.md). It is the source of
truth for the Node-only runtime, policy checks, proxy configuration, and audit
evidence.

The Codex plugin provides this setup guide, but physical validation with Codex
CLI 0.158.0 found that Codex does not start the plugin-bundled MCP process. Until
that host integration is resolved, add the following server to the project's
`.codex/config.toml` yourself, merging it without replacing existing settings:

```toml
[mcp_servers.warden]
command = "npx"
args = ["--yes", "@stlw/warden-cli@0.2.6", "proxy"]
```

Then verify one expected allow and one expected deny through a proxied MCP
tool before relying on the policy.

The plugin does not create, merge, or overwrite `.codex/config.toml`. It governs
only MCP tools routed through Warden's proxy; it does not govern native tools
such as Bash or apply_patch. Warden policy evaluation is local and deterministic;
it does not use an LLM or a remote judgment service. The hook server is Node-only.
