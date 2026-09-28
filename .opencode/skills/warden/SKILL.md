---
name: warden
description: Configure and verify Warden's local policy enforcement in OpenCode.
---

# Warden setup for OpenCode

Follow the canonical setup and verification guide at
[`docs/AGENT_SETUP.md`](../../../docs/AGENT_SETUP.md). It is the source of
truth for the Node-only runtime, policy checks, proxy configuration, and audit
evidence.

OpenCode's existing Warden plugin is a separately configured enforcement
integration. This skill provides guidance only: it does not alter the plugin,
add hooks, or change any agent settings. MCP tools routed through Warden's
proxy are governed; native tools require a separately configured and verified
integration.

Before relying on a policy, run one expected allow and one expected deny, then
inspect the audit export described in the canonical guide.
