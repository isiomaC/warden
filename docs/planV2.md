# Warden v2 — Production-Ready Implementation Plan

### One-shot build reference for LLM-assisted implementation

> **This document is the authoritative implementation spec. Every architectural decision below is a hard requirement, not a suggestion. The implementing LLM must follow these patterns religiously and never deviate without flagging a conflict.**

-----

## Self-Assessment: V1 Gaps Fixed in This Plan

|Gap                                     |Fix in V2                                                                 |
|----------------------------------------|--------------------------------------------------------------------------|
|No tool shadowing / rug pull detection  |§ MCP Gateway: tool description pinning + hash verification               |
|Hook API was vague                      |§ Hook Layer: exact `hookSpecificOutput` schema, exit codes, HTTP mode    |
|No context isolation per task           |§ Context Isolation: per-task context windows, TTL-scoped memory          |
|No supply chain defense                 |§ Supply Chain: SBOM generation, package signature verification           |
|Policy engine had no conflict resolution|§ Policy Engine: explicit precedence rules, deny-wins semantics           |
|Vault underspecced                      |§ Credential Vault: OAuth 2.1, short-lived tokens, no static secrets ever |
|No lateral movement detection           |§ Threat Detection: MCP chain analysis, cross-server aggregation alerts   |
|Missing `UserPromptSubmit` hook         |§ Hook Layer: prompt-layer injection scanning before agent even reasons   |
|Missing `ConfigChange` hook             |§ Hook Layer: agent config mutation blocked unless explicitly allowed     |
|No test strategy                        |§ Testing: AgentDojo integration, injection corpus, policy dry-run harness|
|No error handling spec                  |§ Architectural Rules: fail-closed everywhere, explicit fallback behavior |

-----

## Architectural Commandments

### The implementing LLM must treat these as invariants

1. **DENY is the default.** Every unmatched policy case returns DENY. There is no implicit ALLOW. If a rule is missing, the action is blocked.
1. **No LLM in the security path.** The policy engine, trust tagger, and hook handlers are pure deterministic code. No model call, no semantic evaluation inside the enforcement loop. A compromised or hallucinating model cannot bypass a deterministic gate.
1. **Fail closed, not open.** If Warden crashes, times out, or errors — the tool call is blocked. Never fail open. Non-2xx HTTP hook responses must be treated as DENY.
1. **Trust can only flow downward.** A value tagged EXTERNAL can never be promoted to TOOL or SYSTEM trust by agent reasoning. Trust promotion requires an explicit human confirmation event.
1. **No static secrets anywhere.** No API keys, tokens, or credentials in prompts, config files, environment variables passed to agent context, or log entries. All secrets go through the Vault and are injected as short-lived scoped tokens at task boundary.
1. **Hash everything at rest and in transit.** Tool descriptions, policy files, and ledger entries all carry a SHA-256 hash. Any mismatch is treated as a tamper event and triggers QUARANTINE.
1. **Context is scoped to a task, not a session.** Each task gets an isolated context window. Tool outputs from task A cannot bleed into task B’s context.
1. **One source of truth for policy.** `warden.config.yml` is the single policy file. It is loaded once at session start, its hash is recorded in the ledger, and any runtime mutation triggers a `ConfigChange` block.
1. **Logs are append-only and tamper-evident.** Every ledger entry contains the SHA-256 of the previous entry (hash chain). Any broken chain is a forensic event.
1. **Approval channels are async but bounded.** CONFIRM decisions pause execution and wait max 60 seconds. After timeout, the decision is auto-DENY, logged, and the agent receives the reason.

-----

## Full Threat Model (OWASP MCP Top 10 Coverage)

|OWASP ID|Threat                               |Warden Control                                                                |
|--------|-------------------------------------|------------------------------------------------------------------------------|
|MCP01   |Token Mismanagement & Secret Exposure|Vault: no static secrets, scoped ephemeral tokens, ledger redacts secrets     |
|MCP02   |Excessive Permission Scopes          |Policy engine: allowlist-only tool grants per task                            |
|MCP03   |Tool Poisoning (shadowing, rug pulls)|Tool description pinning: hash on connect, re-verify on every call            |
|MCP04   |Supply Chain / Dependency Tampering  |SBOM generation, package lock enforcement, signature check at install         |
|MCP05   |Command Injection                    |PreToolUse hook: input sanitization, pattern blocklist on Bash/shell tools    |
|MCP06   |Prompt Injection via Tool Context    |Trust tagger: all tool outputs tagged TOOL-level, never promoted              |
|MCP07   |Insufficient Auth                    |OAuth 2.1 enforced on all MCP server connections, mTLS for local              |
|MCP08   |Insufficient Logging                 |Ledger: hash-chained, append-only, every tool call logged pre-execution       |
|MCP09   |Shadow MCP Servers                   |MCP registry: allowlist of approved servers, unknown server = DENY            |
|MCP10   |Context Oversharing                  |Task-scoped context isolation, per-task memory TTL, cross-task bleed detection|

Plus OWASP LLM Top 10 indirect injection (LLM01) via UserPromptSubmit hook scanning.

-----

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    LAYER 0: PROMPT LAYER                         │
│                                                                  │
│  UserPromptSubmit Hook → Injection Scanner → Trust Classifier   │
│  (fires before agent reasons — catches injection at source)      │
└────────────────────────────┬─────────────────────────────────────┘
                             │ clean prompt + trust context
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    LAYER 1: AGENT RUNTIME                        │
│              (Claude Code / OpenClaw agent loop)                 │
│                                                                  │
│  Agent reasons, plans tool calls, operates within task context   │
│  Context window is TASK-SCOPED — no cross-task bleed             │
└────────────────────────────┬─────────────────────────────────────┘
                             │ tool call intention
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    LAYER 2: WARDEN GATE                       │
│                                                                  │
│  ┌─────────────────┐   ┌──────────────────┐   ┌──────────────┐  │
│  │  Trust Tagger   │   │  Policy Engine   │   │    Ledger    │  │
│  │                 │→  │                  │→  │              │  │
│  │ tag every value │   │ ALLOW/DENY/      │   │ hash-chained │  │
│  │ with TrustLevel │   │ CONFIRM/         │   │ append-only  │  │
│  │ before eval     │   │ QUARANTINE       │   │ pre-exec log │  │
│  └─────────────────┘   └──────────────────┘   └──────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Credential Vault                         │ │
│  │   OAuth 2.1 · scoped tokens · TTL enforced · no static     │ │
│  └─────────────────────────────────────────────────────────────┘ │
└────────────────────────────┬─────────────────────────────────────┘
                             │ validated call OR block
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    LAYER 3: MCP GATEWAY                          │
│                                                                  │
│  ┌──────────────────┐   ┌───────────────────┐   ┌────────────┐  │
│  │  Server Registry │   │  Description Pin  │   │  Lateral   │  │
│  │                  │   │                   │   │  Movement  │  │
│  │  allowlist only  │   │  hash on connect  │   │  Detector  │  │
│  │  unknown = DENY  │   │  verify each call │   │            │  │
│  │  OAuth 2.1 auth  │   │  rug pull = block │   │ chain alert│  │
│  └──────────────────┘   └───────────────────┘   └────────────┘  │
└────────────────────────────┬─────────────────────────────────────┘
                             │ authenticated, verified call
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                  LAYER 4: MCP SERVERS / TOOLS                    │
│         filesystem · database · shell · GitHub · email           │
└──────────────────────────────────────────────────────────────────┘
                             │ tool output
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                 LAYER 5: POST-EXECUTION GATE                     │
│                                                                  │
│  PostToolUse Hook → Output Trust Tag → Exfiltration Check        │
│  (output tagged TOOL-level, scanned before entering context)     │
└──────────────────────────────────────────────────────────────────┘
                             │ tagged output → task context only
                             ▼
                        Agent continues (within task scope)
```

-----

## Core Data Structures

### TrustLevel (trust.ts)

```typescript
// INVARIANT: Never add a promotion path. Trust only flows downward.
export const TrustLevel = {
  SYSTEM:   3,  // User-authored system prompt, Warden config
  AGENT:    2,  // Agent's own reasoning output
  TOOL:     1,  // MCP tool output, API response
  EXTERNAL: 0,  // Web content, email, docs, file reads from disk
} as const;

export type TrustLevel = typeof TrustLevel[keyof typeof TrustLevel];

export interface TrustedValue<T = unknown> {
  value: T;
  trust: TrustLevel;
  source: string;         // e.g. "system_prompt" | "mcp__filesystem__read_file"
  taskId: string;         // context isolation key
  hash: string;           // SHA-256 of serialized value
  timestamp: string;      // ISO 8601
}

// RULE: any value originating from a tool output is TOOL-level max.
// RULE: any value from web/email/file-read is EXTERNAL-level.
// RULE: these are assigned at ingestion — the agent cannot change them.
export function tagValue<T>(
  value: T,
  source: string,
  taskId: string,
): TrustedValue<T> {
  const trust = inferTrust(source);
  return {
    value,
    trust,
    source,
    taskId,
    hash: sha256(JSON.stringify(value)),
    timestamp: new Date().toISOString(),
  };
}

function inferTrust(source: string): TrustLevel {
  if (source === "system_prompt" || source === "warden_config") {
    return TrustLevel.SYSTEM;
  }
  if (source.startsWith("mcp__")) {
    return TrustLevel.TOOL;
  }
  // web, email, file reads from outside workspace, user uploads
  return TrustLevel.EXTERNAL;
}
```

### PolicyDecision (policy.ts)

```typescript
export type PolicyDecision =
  | { action: "ALLOW"; reason: string }
  | { action: "DENY";  reason: string }
  | { action: "CONFIRM"; reason: string; channel: "telegram" | "slack" | "stdout" }
  | { action: "QUARANTINE"; reason: string; strippedContext: string[] };

// INVARIANT: Default is always DENY. No fallthrough to ALLOW.
// INVARIANT: If multiple rules match, DENY beats CONFIRM beats QUARANTINE beats ALLOW.
// This is deny-wins precedence — most restrictive always wins.
export function resolveConflicts(decisions: PolicyDecision[]): PolicyDecision {
  if (decisions.some(d => d.action === "DENY"))       return decisions.find(d => d.action === "DENY")!;
  if (decisions.some(d => d.action === "QUARANTINE")) return decisions.find(d => d.action === "QUARANTINE")!;
  if (decisions.some(d => d.action === "CONFIRM"))    return decisions.find(d => d.action === "CONFIRM")!;
  if (decisions.some(d => d.action === "ALLOW"))      return decisions.find(d => d.action === "ALLOW")!;
  // Catchall — no rule matched
  return { action: "DENY", reason: "No matching policy rule. Default deny." };
}
```

### LedgerEntry (ledger.ts)

```typescript
export interface LedgerEntry {
  id: string;                 // ulid()
  previousHash: string;       // hash of previous entry — enables chain verification
  timestamp: string;          // ISO 8601
  sessionId: string;
  taskId: string;
  tool: string;               // e.g. "mcp__filesystem__write_file"
  toolInput: unknown;         // REDACTED for secrets via pattern match before write
  trustLevel: TrustLevel;
  trustSource: string;
  policyRulesMatched: string[];
  decision: PolicyDecision["action"];
  decisionReason: string;
  hash: string;               // SHA-256 of this entry (excluding this field)
}

// INVARIANT: Written BEFORE tool execution. If write fails, tool call is blocked.
// INVARIANT: Secrets redacted before write using pattern match on common secret shapes.
// INVARIANT: Chain is verified on every read. Broken chain = QUARANTINE mode.
```

-----

## Config Schema (warden.config.yml)

```yaml
version: "2"

# INVARIANT: This file is hashed at session start.
# Any runtime mutation triggers ConfigChange block.
# Hash is stored in first ledger entry of every session.

meta:
  environment: "development"   # development | staging | production
  sessionApprovalRequired: false

vault:
  type: "local"                # local | cloudflare-kv | hashicorp
  # No secrets stored here. Vault handles its own auth at runtime.

mcpServers:
  # INVARIANT: Only servers listed here are allowed. Unknown server = DENY.
  # type: local | remote
  # transport: stdio | http
  # authRequired: must be true for all remote servers
  allowed:
    - name: "filesystem"
      type: local
      transport: stdio
      allowedTools: ["read_file", "list_directory", "write_file"]
      allowedPaths: ["/home/claude/workspace/**"]
      authRequired: false      # local stdio exempt

    - name: "github"
      type: remote
      transport: http
      allowedTools: ["get_file_contents", "create_or_update_file", "search_code"]
      authRequired: true       # OAuth 2.1 enforced
      pinDescriptions: true    # enable tool description hash pinning

    - name: "postgres"
      type: remote
      transport: http
      allowedTools: ["query"]
      allowedQueryPatterns: ["^SELECT"]  # read-only: only SELECT allowed
      authRequired: true

policies:
  # INVARIANT: Rules evaluated top-to-bottom. First match wins UNLESS deny-wins.
  # INVARIANT: Unmatched = DENY (default deny, not listed here).

  - id: "block-prod-writes"
    description: "No writes to production environment"
    match:
      tools: ["write_file", "db_write", "git_push", "create_or_update_file"]
      environment: ["production"]
    action: DENY

  - id: "block-shadow-mcp"
    description: "Block any MCP server not in allowlist"
    match:
      serverNotInAllowlist: true
    action: DENY

  - id: "confirm-destructive"
    description: "Human approval required for destructive ops"
    match:
      tools: ["delete_file", "drop_table", "git_push", "send_email", "post_slack"]
    action: CONFIRM
    channel: "telegram"
    timeoutSeconds: 60

  - id: "quarantine-external-to-write"
    description: "External content cannot flow into write operations"
    match:
      trustSource: EXTERNAL
      nextTool: ["write_file", "send_email", "post_slack", "shell", "db_write"]
    action: QUARANTINE

  - id: "block-shell-injection-patterns"
    description: "Block known shell injection patterns"
    match:
      tool: "Bash"
      inputPatterns:
        - "rm\\s+-rf"
        - "--trust-all-tools"
        - "--no-interactive"
        - "curl.*\\|.*sh"
        - "wget.*\\|.*sh"
        - "eval\\s*\\("
        - "base64.*decode"
    action: DENY

  - id: "allow-read-staging"
    description: "Read operations allowed in staging"
    match:
      tools: ["read_file", "list_directory", "query", "search_code"]
      trustSource: [SYSTEM, AGENT]
      environment: ["staging", "development"]
    action: ALLOW

approvalChannels:
  telegram:
    botToken: "${WARDEN_TELEGRAM_TOKEN}"   # env var only, never hardcoded
    chatId: "${WARDEN_TELEGRAM_CHAT_ID}"
  slack:
    webhookUrl: "${WARDEN_SLACK_WEBHOOK}"

ledger:
  type: "sqlite"               # sqlite | cloudflare-d1
  path: ".warden/ledger.db"
  retentionDays: 90
  redactPatterns:              # regex patterns for secrets to redact before write
    - "sk-[a-zA-Z0-9]{32,}"   # OpenAI keys
    - "ghp_[a-zA-Z0-9]{36}"   # GitHub PATs
    - "Bearer\\s+[\\w\\-\\.]+\\.[\\w\\-\\.]+\\.[\\w\\-\\.]*"  # JWTs

threatDetection:
  lateralMovement:
    enabled: true
    maxMCPServersPerTaskChain: 4   # alert if single task touches > N servers
    alertAction: CONFIRM

  toolDescriptionPinning:
    enabled: true
    # On first connect to an MCP server, hash all tool descriptions.
    # On every subsequent call, re-verify. Mismatch = rug pull detected = DENY.
    storePath: ".warden/tool-pins.json"

  rugPullDetection:
    enabled: true
    # Compare tool descriptions across sessions. Alert on silent changes.
    alertAction: DENY
```

-----

## Hook Layer: Exact Implementation Spec

### Claude Code Hook Config (.claude/settings.json)

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7429/hooks/prompt-submit",
            "timeout": 5,
            "headers": { "Authorization": "Bearer ${WARDEN_SESSION_TOKEN}" }
          }
        ]
      }
    ],

    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7429/hooks/pre-tool-use",
            "timeout": 10,
            "headers": { "Authorization": "Bearer ${WARDEN_SESSION_TOKEN}" }
          }
        ]
      }
    ],

    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7429/hooks/post-tool-use",
            "timeout": 5,
            "async": true,
            "headers": { "Authorization": "Bearer ${WARDEN_SESSION_TOKEN}" }
          }
        ]
      }
    ],

    "ConfigChange": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7429/hooks/config-change",
            "timeout": 5,
            "headers": { "Authorization": "Bearer ${WARDEN_SESSION_TOKEN}" }
          }
        ]
      }
    ],

    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7429/hooks/session-start",
            "timeout": 10,
            "headers": { "Authorization": "Bearer ${WARDEN_SESSION_TOKEN}" }
          }
        ]
      }
    ],

    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "http",
            "url": "http://localhost:7429/hooks/session-end",
            "timeout": 10,
            "async": true,
            "headers": { "Authorization": "Bearer ${WARDEN_SESSION_TOKEN}" }
          }
        ]
      }
    ]
  }
}
```

### Hook Server Response Schemas

**PreToolUse — ALLOW:**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Policy: allow-read-staging matched"
  }
}
```

**PreToolUse — DENY (exit kills the tool call):**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Policy: block-prod-writes — writes to production are not permitted."
  }
}
```

**PreToolUse — Input Sanitization (modify before execute):**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Input sanitized: dry-run flag injected",
    "updatedInput": {
      "command": "git push --dry-run origin main"
    },
    "additionalContext": "Warden injected --dry-run. Approve via Telegram to execute for real."
  }
}
```

**UserPromptSubmit — injection detected:**

```json
{
  "decision": "block",
  "reason": "Warden: Indirect prompt injection pattern detected in submitted prompt. The phrase 'Ignore previous instructions' was found in content originating from an EXTERNAL trust source. Session logged."
}
```

**ConfigChange — always block:**

```json
{
  "decision": "block",
  "reason": "Warden: Runtime config mutation is not permitted. Warden policy is locked at session start. Restart session to apply new config."
}
```

### Hook Server (hooks/server.ts) — Required Behavior

```typescript
// INVARIANT: Server runs on localhost:7429 only. Never exposed externally.
// INVARIANT: All endpoints authenticated via session token (checked on every request).
// INVARIANT: Any handler that throws must return DENY, not 500.
// INVARIANT: Timeout on approval wait = 60s hard cap, then auto-DENY.

// Endpoint: POST /hooks/pre-tool-use
// Input: Claude Code PreToolUse JSON payload
// Output: hookSpecificOutput with permissionDecision
async function handlePreToolUse(payload: PreToolUsePayload): Promise<HookResponse> {
  try {
    const { tool_name, tool_input, session_id } = payload;

    // 1. Tag trust level of all input values
    const trustedInput = tagToolInput(tool_input, tool_name, session_id);

    // 2. Run policy engine
    const decisions = evaluatePolicies(tool_name, trustedInput, getEnvironment());
    const final = resolveConflicts(decisions);

    // 3. Write to ledger BEFORE deciding (pre-execution log)
    await ledger.write({
      tool: tool_name,
      toolInput: redactSecrets(tool_input),
      decision: final.action,
      decisionReason: final.reason,
      // ...other fields
    });

    // 4. Handle each decision type
    switch (final.action) {
      case "ALLOW":
        return buildAllowResponse(final.reason);

      case "DENY":
        return buildDenyResponse(final.reason);

      case "CONFIRM":
        // Block execution, send to approval channel, wait
        const approved = await approvalChannel.request({
          tool: tool_name,
          input: redactSecrets(tool_input),
          reason: final.reason,
          timeoutMs: 60_000,
        });
        return approved
          ? buildAllowResponse("Human approved via " + final.channel)
          : buildDenyResponse("Approval timed out or denied");

      case "QUARANTINE":
        // Strip the offending context from input, inject warning
        const sanitized = stripExternalContext(tool_input, final.strippedContext);
        return buildModifiedInputResponse(sanitized,
          "Warden: EXTERNAL-trust context stripped before tool execution.");
    }
  } catch (err) {
    // INVARIANT: Any error = DENY. Never fail open.
    await ledger.writeError(err);
    return buildDenyResponse("Warden internal error. Failing closed.");
  }
}
```

-----

## MCP Gateway: Tool Description Pinning

```typescript
// pins.ts
// INVARIANT: Called once when MCP server first connects.
// INVARIANT: Called again on every tools/list refresh.
// INVARIANT: Hash mismatch = rug pull detected = session QUARANTINE.

export interface ToolPin {
  serverName: string;
  toolName: string;
  descriptionHash: string;    // SHA-256 of full description JSON
  pinnedAt: string;           // ISO 8601
  schemaHash: string;         // SHA-256 of inputSchema JSON
}

export async function pinToolDescriptions(
  serverName: string,
  tools: MCPTool[],
): Promise<void> {
  const existing = await loadPins(serverName);

  for (const tool of tools) {
    const descHash = sha256(JSON.stringify(tool.description));
    const schemaHash = sha256(JSON.stringify(tool.inputSchema));
    const key = `${serverName}__${tool.name}`;

    if (existing[key]) {
      // Re-verification pass
      if (existing[key].descriptionHash !== descHash) {
        await ledger.writeSecurityEvent("RUG_PULL_DETECTED", {
          server: serverName,
          tool: tool.name,
          previousHash: existing[key].descriptionHash,
          newHash: descHash,
        });
        throw new SecurityError(
          `RUG PULL DETECTED: Tool description for ${key} changed silently. ` +
          `Previous hash: ${existing[key].descriptionHash}. ` +
          `New hash: ${descHash}. Session quarantined.`
        );
      }
    } else {
      // First-time pin
      existing[key] = { serverName, toolName: tool.name, descriptionHash: descHash,
                        pinnedAt: new Date().toISOString(), schemaHash };
    }
  }

  await savePins(serverName, existing);
}

// INVARIANT: MCP server not in config allowlist = instant DENY, no tool calls possible.
export function assertServerAllowed(serverName: string, config: WardenConfig): void {
  const allowed = config.mcpServers.allowed.map(s => s.name);
  if (!allowed.includes(serverName)) {
    throw new SecurityError(
      `Shadow MCP server blocked: "${serverName}" is not in the allowed server list. ` +
      `Add it to warden.config.yml mcpServers.allowed to permit.`
    );
  }
}
```

-----

## Credential Vault Spec

```typescript
// vault.ts
// INVARIANT: No static secrets. Tokens are always ephemeral, scoped, TTL-bounded.
// INVARIANT: Vault token is never passed to agent context directly.
//            It is used internally by Warden to mint tool-scoped session tokens.

export interface TaskToken {
  tokenId: string;
  taskId: string;
  sessionId: string;
  allowedTools: string[];       // exact tool names, no wildcards
  allowedPaths?: string[];      // for filesystem tools
  allowedQueryPatterns?: string[]; // for DB tools
  environment: string;
  issuedAt: string;
  expiresAt: string;            // TTL enforced, default 5 min
  revoked: boolean;
}

export interface VaultAdapter {
  mintToken(params: MintTokenParams): Promise<TaskToken>;
  verifyToken(tokenId: string): Promise<TaskToken | null>;
  revokeToken(tokenId: string): Promise<void>;
  revokeAllForSession(sessionId: string): Promise<void>;
}

// INVARIANT: Token verified on every PreToolUse, not just at task start.
// INVARIANT: Token revoked automatically at SessionEnd.
// INVARIANT: If token is expired or revoked, tool call = DENY.
// INVARIANT: Tokens never logged (only tokenId is logged, never the token value).
```

-----

## Context Isolation Spec

```typescript
// context.ts
// Implements per-task context isolation to prevent cross-task bleed (OWASP MCP10)

export interface TaskContext {
  taskId: string;           // ulid() — unique per task, not per session
  sessionId: string;
  startedAt: string;
  expiresAt: string;        // context TTL
  trustBudget: Map<string, TrustLevel>;  // source → max trust level allowed
  toolCallCount: number;
  mcpServersContacted: Set<string>;   // for lateral movement detection
}

// INVARIANT: Tool output from task A is never accessible in task B.
// INVARIANT: Context expires after task completion or TTL (default 30 min).
// INVARIANT: If mcpServersContacted.size > config.lateralMovement.max,
//            trigger CONFIRM before next cross-server call.

export class ContextManager {
  private contexts = new Map<string, TaskContext>();

  createTask(sessionId: string): TaskContext {
    const taskId = ulid();
    const ctx: TaskContext = {
      taskId,
      sessionId,
      startedAt: new Date().toISOString(),
      expiresAt: addMinutes(new Date(), 30).toISOString(),
      trustBudget: new Map(),
      toolCallCount: 0,
      mcpServersContacted: new Set(),
    };
    this.contexts.set(taskId, ctx);
    return ctx;
  }

  recordToolCall(taskId: string, serverName: string): void {
    const ctx = this.getOrThrow(taskId);
    ctx.toolCallCount++;
    ctx.mcpServersContacted.add(serverName);
  }

  checkLateralMovement(taskId: string, config: WardenConfig): boolean {
    const ctx = this.getOrThrow(taskId);
    return ctx.mcpServersContacted.size > config.threatDetection.lateralMovement.maxMCPServersPerTaskChain;
  }

  expireTask(taskId: string): void {
    this.contexts.delete(taskId);
  }
}
```

-----

## Supply Chain Defense Spec

```typescript
// supply-chain.ts
// Defends against OWASP MCP04: dependency tampering, typosquatting, silent updates

export interface PackagePin {
  name: string;
  version: string;            // pinned version, no ranges
  integrity: string;          // sha512 from package-lock / bun.lockb
  approvedAt: string;
  approvedBy: string;
}

// INVARIANT: Generated at `warden init` and updated only via `warden supply-chain approve`.
// INVARIANT: Any package not in this file blocks Warden from starting.
// INVARIANT: Version ranges (^, ~, *) are rejected. Exact versions only.

// warden supply-chain check — run in CI and pre-session
export async function checkSupplyChain(lockFile: string): Promise<SupplyChainReport> {
  const deps = parseLockFile(lockFile);
  const pinned = await loadPackagePins();
  const violations: SupplyChainViolation[] = [];

  for (const dep of deps) {
    const pin = pinned[dep.name];
    if (!pin) {
      violations.push({ type: "UNPINNED", package: dep.name, version: dep.version });
      continue;
    }
    if (pin.version !== dep.version) {
      violations.push({ type: "VERSION_DRIFT", package: dep.name,
                        pinned: pin.version, current: dep.version });
    }
    if (pin.integrity !== dep.integrity) {
      violations.push({ type: "INTEGRITY_MISMATCH", package: dep.name });
    }
  }

  return { violations, clean: violations.length === 0 };
}
```

-----

## Injection Scanner Spec (UserPromptSubmit layer)

```typescript
// scanner.ts
// Scans user prompts before agent reasons — catches injection at source
// INVARIANT: Runs on every UserPromptSubmit. Cannot be disabled.
// INVARIANT: Uses pattern matching + heuristics, NOT an LLM call.
//            (LLM in the security path can itself be injected.)

const INJECTION_PATTERNS = [
  /ignore\s+(previous|above|all)\s+instructions/i,
  /you\s+are\s+now\s+a/i,
  /disregard\s+(your|the)\s+(system\s+)?prompt/i,
  /new\s+instructions?\s*:/i,
  /\[system\]/i,
  /override\s+your\s+(safety|security|policy)/i,
  /act\s+as\s+(if\s+you\s+are|a)\s+(?!an?\s+AI)/i,  // "act as [not an AI]"
  /do\s+not\s+follow\s+(the\s+)?rules/i,
  /pretend\s+(you\s+)?(are|have\s+no)/i,
] as const;

// External content patterns — content from outside the session
// that looks like it's trying to embed instructions
const INDIRECT_INJECTION_PATTERNS = [
  /\[INST\]/i,            // Llama instruction format injection
  /<\|system\|>/i,        // Phi-style
  /###\s*System:/i,
  /\{\{.*instructions.*\}\}/i,
] as const;

export function scanForInjection(prompt: string, trustLevel: TrustLevel): ScanResult {
  if (trustLevel === TrustLevel.SYSTEM) {
    // System-level content is trusted, skip scan
    return { clean: true };
  }

  const directHits = INJECTION_PATTERNS.filter(p => p.test(prompt));
  const indirectHits = INDIRECT_INJECTION_PATTERNS.filter(p => p.test(prompt));

  if (directHits.length > 0 || indirectHits.length > 0) {
    return {
      clean: false,
      patterns: [...directHits, ...indirectHits].map(p => p.source),
      recommendation: trustLevel === TrustLevel.EXTERNAL
        ? "BLOCK — external content contains injection patterns"
        : "CONFIRM — agent-level content contains suspicious patterns",
    };
  }

  return { clean: true };
}
```

-----

## Project File Structure

```
warden/
├── packages/
│   ├── core/                         # Pure enforcement logic
│   │   ├── src/
│   │   │   ├── trust.ts              # TrustLevel, tagValue, inferTrust
│   │   │   ├── policy.ts             # Policy engine, resolveConflicts
│   │   │   ├── ledger.ts             # Hash-chained append-only ledger
│   │   │   ├── vault.ts              # Credential vault interface + local adapter
│   │   │   ├── vault-cf-kv.ts        # Cloudflare KV adapter
│   │   │   ├── context.ts            # Per-task context isolation + ContextManager
│   │   │   ├── scanner.ts            # Injection pattern scanner
│   │   │   ├── pins.ts               # Tool description pinning + rug pull detection
│   │   │   ├── supply-chain.ts       # Package integrity verification
│   │   │   ├── redact.ts             # Secret redaction before ledger write
│   │   │   ├── errors.ts             # SecurityError, QuarantineError, etc.
│   │   │   └── index.ts              # Public API surface
│   │   ├── tests/
│   │   │   ├── policy.test.ts        # Policy engine: every rule + edge case
│   │   │   ├── trust.test.ts         # Trust tagging + promotion prevention
│   │   │   ├── ledger.test.ts        # Hash chain integrity verification
│   │   │   ├── scanner.test.ts       # Injection patterns corpus
│   │   │   ├── pins.test.ts          # Rug pull detection
│   │   │   └── supply-chain.test.ts  # Package integrity checks
│   │   └── package.json
│   │
│   ├── hook-server/                  # HTTP hook server for Claude Code
│   │   ├── src/
│   │   │   ├── server.ts             # Hono/Bun HTTP server on :7429
│   │   │   ├── handlers/
│   │   │   │   ├── pre-tool-use.ts   # Core gate — ALLOW/DENY/CONFIRM/QUARANTINE
│   │   │   │   ├── post-tool-use.ts  # Output trust tagging + exfil check
│   │   │   │   ├── prompt-submit.ts  # UserPromptSubmit injection scan
│   │   │   │   ├── config-change.ts  # Always block
│   │   │   │   ├── session-start.ts  # Mint session token, pin configs, init context
│   │   │   │   └── session-end.ts    # Revoke all tokens, expire contexts, flush ledger
│   │   │   ├── approvals/
│   │   │   │   ├── telegram.ts       # Telegram bot approval flow
│   │   │   │   ├── slack.ts          # Slack webhook approval flow
│   │   │   │   └── stdout.ts         # CLI approval flow (dev mode)
│   │   │   └── middleware/
│   │   │       ├── auth.ts           # Session token verification on every request
│   │   │       └── fail-closed.ts    # Global error handler → always DENY
│   │   └── package.json
│   │
│   ├── mcp-gateway/                  # MCP connection wrapper
│   │   ├── src/
│   │   │   ├── gateway.ts            # wrapMCP() — main public API
│   │   │   ├── registry.ts           # Server allowlist enforcement
│   │   │   ├── pins.ts               # Re-export from core, gateway-specific logic
│   │   │   ├── lateral.ts            # Cross-server chain detection
│   │   │   └── oauth.ts              # OAuth 2.1 token management for remote servers
│   │   └── package.json
│   │
│   └── cli/                          # Developer-facing tooling
│       ├── src/
│       │   ├── commands/
│       │   │   ├── init.ts           # Interactive setup, generates config + .claude/settings.json
│       │   │   ├── audit.ts          # Pretty-print ledger, verify chain integrity
│       │   │   ├── policy.ts         # `policy test <tool> <trust>` dry-run
│       │   │   ├── token.ts          # Manual token mint/revoke
│       │   │   ├── supply-chain.ts   # Check + approve package pins
│       │   │   ├── pins.ts           # View/reset tool description pins
│       │   │   └── scan.ts           # Run injection scanner against a file/prompt
│       │   └── index.ts
│       └── package.json
│
├── .claude/
│   ├── settings.json                 # Hook registrations (generated by warden init)
│   └── CLAUDE.md                     # Warden build context for Claude Code sessions
│
├── warden.config.yml              # Policy config (see schema above)
├── .warden/
│   ├── ledger.db                     # SQLite ledger (gitignored)
│   ├── tool-pins.json                # Tool description hashes (commit this)
│   └── package-pins.json             # Package integrity pins (commit this)
│
├── package.json                      # Bun workspace root
├── tsconfig.json                     # Strict mode, no `any`, no implicit returns
├── vitest.config.ts
└── README.md
```

-----

## Tech Stack (Locked)

|Layer        |Library                  |Version|Reason                             |
|-------------|-------------------------|-------|-----------------------------------|
|Runtime      |Bun                      |latest |Native TS, fast startup, your stack|
|HTTP server  |Hono                     |^4     |Bun-native, zero-dep, typed        |
|Policy schema|Zod                      |^3     |Type-safe config parsing           |
|JWT / tokens |jose                     |^5     |Zero-dep, JOSE compliant           |
|SQLite       |better-sqlite3           |^9     |Sync API, embedded, fast           |
|MCP SDK      |@modelcontextprotocol/sdk|latest |Official                           |
|ULID         |ulid                     |^2     |Sortable unique IDs for ledger     |
|Crypto       |built-in (crypto.subtle) |—      |No dep for SHA-256                 |
|Telegram     |grammy                   |^1     |Minimal, TS-native                 |
|CLI          |citty                    |^0.1   |Bun-native, lightweight            |
|Test         |Vitest                   |^2     |Your stack                         |

-----

## Testing Strategy

### Unit Tests (run on every save)

- Policy engine: table-driven tests for every rule + precedence conflict
- Trust tagger: verify external content cannot be promoted to TOOL
- Ledger: write 100 entries, break the chain at entry 50, assert detection
- Scanner: corpus of 50 known injection strings, 50 benign strings — zero false negatives on malicious corpus
- Pins: simulate rug pull (change description between two calls), assert SecurityError

### Integration Tests (run pre-commit)

- Full session simulation: start hook server, run Claude Code in dry-run mode, verify all tool calls flow through ledger
- CONFIRM flow: trigger a destructive tool call, mock Telegram approval, verify unblock + log
- CONFIRM timeout: trigger CONFIRM, let it expire, verify auto-DENY
- Shadow MCP: attempt to connect to a server not in allowlist, verify DENY

### Security Regression Tests

- AgentDojo-inspired corpus: 20 injection payloads embedded in simulated tool outputs, verify all blocked at PostToolUse trust gate
- Supply chain: mutate a package hash in bun.lockb, verify `warden supply-chain check` catches it
- Config mutation: attempt to modify `warden.config.yml` mid-session via file write, verify ConfigChange hook blocks it

-----

## Implementation Sequence (One-Shot Order for LLM)

The implementing LLM should build in exactly this order to avoid forward dependencies:

```
1. packages/core/src/errors.ts          — SecurityError, QuarantineError types
2. packages/core/src/trust.ts           — TrustLevel, TrustedValue, tagValue
3. packages/core/src/redact.ts          — Secret redaction patterns
4. packages/core/src/ledger.ts          — LedgerEntry type + SQLite writer
5. packages/core/src/policy.ts          — PolicyDecision, policy engine, resolveConflicts
6. packages/core/src/vault.ts           — TaskToken, VaultAdapter interface, LocalVault
7. packages/core/src/context.ts         — TaskContext, ContextManager
8. packages/core/src/scanner.ts         — Injection pattern scanner
9. packages/core/src/pins.ts            — Tool description pinning
10. packages/core/src/supply-chain.ts   — Package integrity check
11. packages/core/tests/*               — All unit tests, run and pass before proceeding

12. packages/hook-server/src/middleware/auth.ts       — Session token check
13. packages/hook-server/src/middleware/fail-closed.ts — Global error → DENY
14. packages/hook-server/src/handlers/session-start.ts — Init everything
15. packages/hook-server/src/handlers/pre-tool-use.ts  — Core gate (most complex)
16. packages/hook-server/src/handlers/prompt-submit.ts — Injection scan
17. packages/hook-server/src/handlers/post-tool-use.ts — Output tagging
18. packages/hook-server/src/handlers/config-change.ts — Always block
19. packages/hook-server/src/handlers/session-end.ts   — Cleanup
20. packages/hook-server/src/approvals/stdout.ts       — CLI approval (MVP)
21. packages/hook-server/src/approvals/telegram.ts     — Telegram approval
22. packages/hook-server/src/server.ts                 — Wire all handlers

23. packages/mcp-gateway/src/registry.ts   — Server allowlist
24. packages/mcp-gateway/src/oauth.ts      — OAuth 2.1 token management
25. packages/mcp-gateway/src/lateral.ts    — Chain detection
26. packages/mcp-gateway/src/gateway.ts    — wrapMCP() public API

27. packages/cli/src/commands/init.ts       — Setup wizard
28. packages/cli/src/commands/audit.ts      — Ledger viewer
29. packages/cli/src/commands/policy.ts     — Policy dry-run
30. packages/cli/src/commands/supply-chain.ts
31. packages/cli/src/index.ts

32. .claude/settings.json               — Hook registrations
33. warden.config.yml                — Example config
34. README.md                           — Install + quickstart
```

-----

## MVP Launch Checklist

- [ ] `warden init` generates working Claude Code config in < 2 min
- [ ] All 6 hook events wired and responding
- [ ] PolicyDecision fires on every tool call — nothing bypasses the gate
- [ ] Ledger writes pre-execution, chain verifiable with `warden audit`
- [ ] Tool description pinning working — simulated rug pull blocked
- [ ] Injection scanner catches all 50 corpus patterns
- [ ] CONFIRM flow working end-to-end (stdout mode for MVP, Telegram next)
- [ ] Shadow MCP blocked (server not in allowlist)
- [ ] Session token minted at start, revoked at end
- [ ] Zero tool calls possible if hook server is down (fail-closed verified)
- [ ] `warden supply-chain check` runs clean on fresh install
- [ ] `warden audit` shows full session with readable output + chain status

-----

## Competitive Differentiation Summary

|Capability                  |Microsoft AGT|Geordie AI|WitnessAI|CaMeL   |**Warden**|
|----------------------------|-------------|----------|---------|--------|----------|
|MCP-native tool pinning     |✗            |✗         |✗        |✗       |**✓**     |
|Rug pull detection          |✗            |✗         |✗        |✗       |**✓**     |
|Claude Code hook integration|partial      |✗         |✗        |✗       |**✓**     |
|Developer self-serve        |✗            |✗         |✗        |✗       |**✓**     |
|< 5 min setup               |✗            |✗         |✗        |✗       |**✓**     |
|Context isolation per task  |✓            |unknown   |unknown  |✓       |**✓**     |
|Deterministic policy engine |✓            |unknown   |✗        |✓       |**✓**     |
|Supply chain defense        |partial      |✗         |✗        |✗       |**✓**     |
|Lateral movement detection  |✓            |partial   |✗        |✗       |**✓**     |
|Fail-closed guarantee       |✓            |unknown   |unknown  |✓       |**✓**     |
|Open source                 |✓            |✗         |✗        |research|**✓**     |
|OpenClaw integration        |✗            |✗         |✗        |✗       |**✓**     |

-----

## MCP Gateway: Rate Limiting (from V1)

Each wrapped MCP server enforces a per-tool call rate limit to contain runaway agent behavior:

```typescript
const safeFilesystem = warden.wrapMCP("filesystem", {
  allowedTools: ["read_file", "list_directory"],
  trustLevel: TrustLevel.TOOL,
  maxCallsPerMinute: 60,   // sliding window, per tool per task
})
```

Exceeding the limit triggers CONFIRM (not DENY) — the agent is paused, not killed, so legitimate high-throughput tasks can be approved by a human.

-----

## Ledger Storage Adapters (from V1)

|Tier      |Adapter                     |Use Case                           |
|----------|----------------------------|-----------------------------------|
|Local dev |SQLite (`better-sqlite3`)   |Default, zero infra                |
|Solo prod |Cloudflare D1               |Serverless, free tier              |
|Team      |Cloudflare R2 (JSONL export)|Audit trail, compliance export     |
|Enterprise|S3 + Athena                 |Long-term retention, query at scale|

Adapter is swappable via `warden.config.yml` `ledger.type` — same interface, different driver.

-----

## OpenClaw Integration (Future / Low Priority)

Warden is designed to run standalone and LLM-agnostic. OpenClaw is one possible downstream consumer, not a dependency or primary distribution channel.

If and when relevant: OpenClaw agents can optionally wrap tool registrations via `warden.wrapMCP()`. No timeline, not on the critical path.

-----

## Positioning for Launch

**Who it’s for:** any team or solo dev running Claude Code, Cursor, or any MCP-connected agent who can’t grant full permissions yet — exactly the person in the tweet.

**One-liner:** *“The policy layer for autonomous agents. Full permissions, zero blast radius.”*

**Distribution strategy:**

- `npm install @warden/sdk` — frictionless, discoverable
- GitHub README targeting “Claude Code security” and “MCP security” search
- Claude Code community / Discord — exact ICP, underserved
- Agent framework integrations (LangChain, CrewAI, etc.) — ecosystem surface area
- Dev.to / HN launch post: “I built the security layer missing from Claude Code”
- EU AI Act August 2026 angle: “Ship an audit-ready agent log in 5 minutes”

-----

## What Makes This a Goldmine

1. **Timing** — Microsoft validated the category in April 2026 with their open-source toolkit. You can ship something a solo dev can actually install in a weekend. They can’t.
1. **Nobody owns the developer-first tier** — Geordie AI and WitnessAI have an SDR on the other end of their contact form. You have `npm install`.
1. **MCP is the live attack surface and nobody built for it natively** — every Claude Code user is exposed right now. OWASP published the MCP Top 10. CVEs are being filed. The timing is perfect.
1. **Regulatory forcing function** — EU AI Act August 2026, Colorado AI Act June 2026 — every company deploying agents needs a tamper-evident audit log. Warden ships one by default.
1. **Rug pulls are undetected in the wild** — tool description pinning is something no production tool does yet. First to ship it owns that narrative.
1. **LLM-agnostic positioning** — not tied to Claude, not tied to any agent framework. Works anywhere MCP runs. That’s the entire agentic AI market, not a subset.