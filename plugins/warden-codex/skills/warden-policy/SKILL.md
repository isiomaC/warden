---
name: warden-policy
description: Configure and verify local Warden policy enforcement for MCP tools in Codex.
---

# Warden MCP policy for Codex

Follow the canonical setup and verification guide at
[`docs/AGENT_SETUP.md`](../../../../docs/AGENT_SETUP.md). It is the source of
truth for the Node-only runtime, policy checks, proxy configuration, and audit
evidence.

For Codex, install and enable the Warden Codex plugin. It contributes Warden's
stdio MCP proxy; then verify one expected allow and one expected deny through a
proxied MCP tool before relying on the policy.

The plugin does not create, merge, or overwrite `.codex/config.toml`. It governs
only MCP tools routed through Warden's proxy; it does not govern native tools
such as Bash or apply_patch. Warden policy evaluation is local and deterministic;
it does not use an LLM or a remote judgment service. The hook server is Node-only.
