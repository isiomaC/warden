# Warden UI Plan

## Overview

Warden Console currently has no UI. This plan builds it React-native from the
start using OpenUI (`@openuidev/*`) as the rendering layer, so policy
decisions, audit ledger entries, and approval flows render as live structured
components instead of raw JSON/text.

Stack additions: React 19+, `@openuidev/react-lang` (Phases 1-2),
`@openuidev/react-ui` + `@openuidev/react-headless` (Phase 3 only —
see "Two subsystems" below), `@openuidev/lang-core` (backend). Confirmed
against the real published packages (`@openuidev/react-lang@0.2.8`,
`@openuidev/react-ui@0.12.1`, `@openuidev/react-headless@0.9.2`,
`@openuidev/lang-core@0.2.7`, `sideshow@0.11.0`) before writing this plan —
`defineComponent`/`createLibrary`/`Renderer` all exist with the shapes used
below.

**Scope for Phases 0-3: Tier 1 only** (the hook server — Claude Code,
OpenCode, Codex CLI, Copilot SDK). This is the only tier with full
enforcement + ledger audit today (per README's tier table); `warden proxy`
(Tier 2: Cursor/Windsurf) is out of scope until its transparent-forwarding
rewrite (tracked in ROADMAP.md) lands, since instrumenting it now would be
thrown away. `@warden/mcp-gateway` (Tier 3) is likewise out of scope — no UI
work planned for library consumers' custom integrations.

**Two subsystems inside `@openuidev/*`, only one of which Phases 0-2 need:**
`@openuidev/react-lang`'s `Renderer` renders a plain OpenUI Lang *string*
against a `library` — nothing about it requires an LLM. Warden's backend can
author that string deterministically from a `PolicyDecision`/`LedgerEntry`,
the same way it authors JSON today. That's all Phases 0-2 need.
`@openuidev/react-ui`'s `AgentInterface` and `@openuidev/react-headless`'s
`ChatProvider`, by contrast, are built around an LLM chat transport
(`ChatLLM.send({ messages, signal })`) — only Phase 3's copilot needs them.
Don't install `react-ui`/`react-headless` until Phase 3.

**Guardrail:** Phase 3's copilot is read-only over ledger history. It must
never be able to call `evaluate()` differently, write a ledger entry, or
otherwise influence a live ALLOW/DENY/CONFIRM/QUARANTINE decision — consistent
with Warden's existing invariant "No LLM in the security path." The copilot
answers questions about the past; it does not participate in enforcement.

**What's genuinely additive vs. what needs new plumbing:** the original
framing — "no changes to the core policy engine, ledger, or trust-registry
modules" — is almost true but not quite. Three small, additive changes are
real prerequisites (Phase 1.5 below): `PolicyDecision` needs to carry the
matched rule's id (used for `PolicyDecisionCard.matchedRule`, currently only
embedded in a free-text `reason` string), the ledger needs an event hook (the
hook server is HTTP request/response with Claude Code — there is no existing
channel to a browser), and a new `ApprovalChannel` implementation is needed
for the Console's approve/deny buttons to do anything. None of this touches
`trust-registry.ts`, `config-source.ts`, or the hash-chaining logic itself.

---

## Phase 0 — Sideshow Prototype (week 0, parallel/pre-Phase 1)

**Goal:** Visual proof of policy decisions and audit chain before any
React/OpenUI code exists.

Sideshow (`sideshow.sh`, npm package `sideshow`) is a separate stack from
OpenUI — Node server, own surface format (html/markdown/mermaid/diff/
terminal/trace/image/json), connects over MCP. Not a dependency of the real
Console; a fast demo/review layer that runs alongside it.

**Correction from the original draft: this is not literally zero-code.**
Warden has no existing hook on `ledger.write()` to tap — `handlePreToolUse`
(`packages/hook-server/src/handlers/pre-tool-use.ts`) calls `ledger.write()`
inline and moves on. Posting to a Sideshow board means Warden acts as an MCP
*client* to Sideshow at the same point it's already acting as an MCP
*server/hook target* for Claude Code — a small, real addition, just not a
frontend one.

- [ ] `claude mcp add sideshow` (or equivalent for your agent harness) to
      wire a small reporter to a Sideshow board
- [ ] Add a minimal listener at the `ledger.write()` call site in
      `pre-tool-use.ts` (or wrap `LedgerStore.write` — see Phase 1.5) that
      posts the same evaluation as a `trace` surface: tool call received →
      policy engine evaluation → ledger write → verdict
- [ ] Post ledger writes as `json` surfaces (collapsible tree — hash,
      prevHash, toolCall)
- [ ] Post any policy config changes (`handleConfigChange`) as `diff` surfaces
- [ ] Use the open-as-image action (Cloudflare deployment only) to capture
      PNGs of live decision timelines for pitch decks / Show HN / GTM assets

**Exit criteria:** Can demo deny-wins behavior live to a human, sharable via
board link, with zero Console frontend built.

**Note:** Not a long-term replacement for Phase 1-3. Once the OpenUI Console
ships, Sideshow remains useful as an internal debugging/review board but
customers use the real Console.

---

## Phase 1 — Scaffold + Component Library

**Goal:** Console app exists, Warden-specific components defined.

- [ ] Bootstrap Console via `npx @openuidev/cli@latest create` (Next.js) or
      wire `@openuidev/react-lang` into a standalone React shell. **Do not**
      install `@openuidev/react-ui` / `@openuidev/react-headless` yet — they
      pull in the chat/LLM machinery Phase 3 needs, not Phases 1-2.
- [ ] Install peer deps: `react@^19`, `react-dom@^19`
- [ ] Define a Warden theme (trust-level color coding: SYSTEM/AGENT/TOOL/
      EXTERNAL) — plain CSS/Tailwind is enough at this stage; defer
      `@openuidev/react-ui`'s `ThemeProvider` to Phase 3 if `AgentInterface`
      is adopted then
- [ ] Define Warden domain components with `defineComponent` (Zod props,
      confirmed real API):

  | Component | Props (Zod) | Purpose | Real data source |
  |---|---|---|---|
  | `PolicyDecisionCard` | verdict (allow/deny/quarantine/confirm), matchedRule, trustLevel, timestamp | Render a single deny-wins evaluation result | `PolicyDecision` + `ruleId` (Phase 1.5) |
  | `AuditLedgerEntry` | hash, prevHash, toolCall, verified: bool | Show a hash-chained ledger write | `LedgerEntry` (`packages/core/src/ledger.ts`) |
  | `ApprovalRequest` | requestId, action, requester, status | Human-in-loop approval channel card w/ approve/deny buttons | new `ConsoleApprovalChannel` (Phase 1.5) — no `requestId`/`status` exist on `ApprovalRequest` today |
  | `TrustBadge` | level: SYSTEM\|AGENT\|TOOL\|EXTERNAL | Small inline badge, reused everywhere | `TrustLevel` (`packages/core/src/trust.ts`) |
  | `QuarantineCard` | reason, quarantinedAt, unfreezeAction | Frozen-action state + unfreeze control | `SecurityEvent` (`EXTERNAL_CONTENT_STRIPPED`) |

- [ ] `createLibrary({ components: [...], root: "..." })` per the real
      `react-lang` API (the original draft's `openuiLibrary.root` /
      `componentGroups` spread assumed the `react-ui` preset shape — since
      Phase 1 isn't using `react-ui`, build the library from scratch with
      just these five components)

**Exit criteria:** Console renders each component with mock data via
`<Renderer response={mockOpenUILangString} library={library} />`.

---

## Phase 1.5 — Core/hook-server plumbing (new phase)

**Goal:** The three real prerequisites Phase 2 needs, isolated so they can be
reviewed/tested independently of any OpenUI code.

- [ ] **`ruleId` on `PolicyDecision`.** `packages/core/src/policy.ts`:
      `ruleToDecision()` currently discards the rule after formatting it into
      `reason`. Add an optional `ruleId: string` to each `PolicyDecision`
      variant, populated from `rule.id`. Update `pre-tool-use.ts:85` to write
      the real id into `policyRulesMatched` instead of `[]`. Additive, no
      existing callers break (field is new).
- [ ] **Ledger-write event hook.** The hook server is HTTP request/response
      with Claude Code — there is no channel to a browser today. Add a small
      `EventEmitter` (or equivalent) that `pre-tool-use.ts` notifies alongside
      `ledger.write()`, and an `/console/stream` SSE endpoint on the Hono app
      (`packages/hook-server/src/server.ts`) that the Console subscribes to.
      Keep it decision-level (post-evaluation), not a generic ledger
      subscription — avoids over-engineering `LedgerStore` itself.
- [ ] **`ConsoleApprovalChannel`.** Model on `WebhookApprovalChannel`
      (`packages/hook-server/src/approvals/webhook.ts`) — same fire-then-poll
      shape, but backed by an in-memory pending-request registry instead of
      an external webhook URL: assign a `requestId`, push it over the same
      SSE stream, expose `POST /console/approvals/:id/resolve` for the
      Console's approve/deny buttons (wired via `react-lang`'s confirmed
      `onAction` callback on `<Renderer>`), and have `request()` await that
      resolution the same way `WebhookApprovalChannel.request()` awaits its
      poll loop.

**Exit criteria:** `curl` can subscribe to `/console/stream` and see a JSON
event within ~100ms of a `warden policy`-triggered decision; a manual
`curl -X POST /console/approvals/<id>/resolve -d '{"approved":true}'`
unblocks a pending `CONFIRM` decision end to end, no Console frontend
involved yet.

---

## Phase 2 — Hook Server → OpenUI Lang Wiring

**Goal:** Warden's hook server emits OpenUI Lang over the Phase 1.5 SSE
stream, and the Console renders it live.

**Scope: Tier 1 (hook server) only** — see "Scope" note above.

- [ ] Add `@openuidev/lang-core` to the hook-server package (framework-
      agnostic, no Node/React dependency needed server-side — confirmed via
      the published package's peer deps)
- [ ] At the Phase 1.5 event-hook point, serialize the same evaluation result
      into two outputs: the existing `hookSpecificOutput` JSON response to
      Claude Code (unchanged), and an OpenUI Lang string
      (`PolicyDecisionCard(...)`) pushed over `/console/stream` — same
      evaluation, two serializations, no duplicated policy logic
- [ ] Push `ApprovalRequest` cards when a `CONFIRM` decision opens a pending
      request via `ConsoleApprovalChannel`; push an updated card when it
      resolves
- [ ] Push `QuarantineCard` updates on `EXTERNAL_CONTENT_STRIPPED` security
      events

**Exit criteria (corrected):** From ledger write to Console card render is a
single SSE push, not a poll — measure and record actual latency (target
<250ms local) instead of the original "same request/response cycle" framing,
which doesn't apply once the Console is a separate browser client from
Claude Code.

---

## Phase 3 — Copilot / Query Layer

**Goal:** Natural-language querying of policy history, not just live-stream
viewing. **This is the phase that actually needs `@openuidev/react-ui` +
`@openuidev/react-headless`** — install them here, not in Phase 1.

- [ ] Add `ChatProvider` (`@openuidev/react-headless`) for thread/message
      state
- [ ] Wire a query endpoint (read-only over `LedgerStore.getEntries()` /
      `getEvents()`) that lets a human ask things like "show denied actions
      in the last hour" or "why was this call quarantined" and returns
      `AuditLedgerEntry[]` / `PolicyDecisionCard[]` via OpenUI Lang
- [ ] Use `AgentInterface` or a custom layout built on `useThread()` for the
      query surface
- [ ] Enforce the guardrail above in code, not just docs: the query
      endpoint's handler should have no import path to `evaluate()`,
      `LedgerStore.write()`, or any `ApprovalChannel` — a read-only client of
      `@warden/core`'s exported types only

**Exit criteria:** This becomes the primary demo surface for the
prompt-injection / deny-wins credibility demo (GTM asset).

---

## Phase 4 — Portfolio Reuse

Not blocking Warden ship, but sequence after Phase 2 stabilizes:

- **Setle** — reuse `TrustBadge` / `ApprovalRequest` pattern for spend-policy
  dashboards (`SpendPolicyCard`, transaction cards, live USDC balance).
  Deny-wins → approval → ledger model overlaps directly.
- **MCP App Studio** — bundle the Warden component patterns as an optional
  "MCP App with OpenUI rendering" scaffold template, since Studio's purpose
  is scaffolding MCP Apps generally.
- **MemStack** — no action. Backend SDK, no natural UI surface unless a
  memory-inspector Console gets built later.

---

## Notes

- `trust-registry.ts`, `config-source.ts`, and the hash-chaining logic in
  `ledger.ts` are untouched by this plan. The one real core-package change is
  additive (`ruleId` on `PolicyDecision`, Phase 1.5) — everything else lives
  in `packages/hook-server` and the new Console app.
- Tier 2 (`warden proxy`) and Tier 3 (`@warden/mcp-gateway`) get no Console
  wiring in this plan. Revisit once the transparent-forwarding proxy rewrite
  (ROADMAP.md, "Near term") lands — instrumenting `proxy.ts` before that
  rewrite would be thrown away.
- Token efficiency (OpenUI Lang vs JSON, ~67% fewer tokens per their
  benchmarks) is a secondary benefit here, not the primary reason — the
  primary reason is turning ledger/policy state into something demoable.
