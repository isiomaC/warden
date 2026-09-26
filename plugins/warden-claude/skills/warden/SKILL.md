---
name: warden
description: Configure and verify Warden's local MCP policy proxy in Claude Code.
---

# Warden setup for Claude Code

Use the canonical setup and verification guide at
[`docs/AGENT_SETUP.md`](../../../../docs/AGENT_SETUP.md). It covers the
Node-only runtime, policy checks, proxy configuration, and audit evidence.

This skill provides setup guidance only. It does not install hooks, create or
rewrite Claude Code configuration, or itself govern native tools. MCP tools
routed through `warden proxy` are governed; native tools need a separately
configured and verified integration.

Before relying on a policy, run one expected allow and one expected deny against
the proxy, then inspect its audit export as described in the canonical guide.
