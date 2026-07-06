# Monetization Strategy (tracked working copy)

> This is a tracked (non-gitignored) copy of the section kept in
> `docs/internal/ENTERPRISE_ROADMAP.md` § "Monetization Strategy (Tailscale Model)", so it
> survives even though `docs/internal/` itself is gitignored and local-only. Note this file
> is **not** hidden from anyone who can see this branch/PR — unlike `docs/internal/`, it will
> ship if this branch merges to `main`. Move it back under `docs/internal/` (or delete this
> copy) once you've captured whatever you need from it, if you don't want it public long-term.

## Monetization Strategy (Tailscale Model)

**The wedge:** Warden's differentiation is local-first, no LLM in the security path, zero
infrastructure — the opposite of enterprise MCP gateways (AWS AgentCore, Kong, Tyk, etc.).
**The enforcement engine (`packages/core`, the hook server, the MCP gateway) stays MIT
forever** — that's the trust story that drives adoption for a security tool. Never gate
local enforcement behind a license key.

**The paid boundary is anything that crosses machine boundaries.** Single-machine
enforcement is free forever; multi-user/team coordination is the paid product, because it
genuinely requires hosted infrastructure users can't trivially self-host:

| Phase | Timing | What | Revenue model |
|---|---|---|---|
| 1. Launch | Now | OSS on npm + GitHub. GitHub Sponsors / Polar.sh for donations. Goal is adoption, not revenue. | ~$0 |
| 2. Pro (hosted control plane) | After traction (~3–6 mo post-launch) | **Interactive approvals relay** — Slack/Telegram/mobile approvals need a public webhook endpoint to receive the button click back; this is exactly why `SlackApprovalChannel` is notify-only today (see README) and exactly the kind of thing that's annoying to self-host (TLS cert, public DNS, uptime). Also: hosted audit-ledger aggregation across a dev's multiple machines/CI runners. | ~$10–20/dev/month |
| 3. Team/Enterprise | 12mo+ | Org-wide policy distribution + versioning, SSO/RBAC, compliance exports (SOC 2 evidence generated from the hash-chained ledger), fleet dashboard, support SLA. This is what `docs/internal/ENTERPRISE_ARCHITECTURE.md` (Models B/C, phases 2–5) is designing toward. | Per-seat + contracts |

**Explicit anti-patterns to avoid:**
- License-key gating of anything that runs purely locally — kills the trust story a security
  tool depends on.
- Building a hosted *enforcement* gateway (routing tool calls through our servers) — that's
  the exact model Warden is positioned against (see README "Why Warden"). The hosted product
  is coordination/visibility (config distribution, audit aggregation, approvals), never
  policy decisions themselves — consistent with the "Enforcement is always local" invariant
  in `docs/ARCHITECTURE.md`.

**Naming/packaging risk:** see the npm scope availability check in
`docs/todo/PRE_LAUNCH_CHECKLIST.md` — relevant here too since the Pro/Enterprise tier would
likely want a matching scope or domain.
