/**
 * Warden Programmatic Usage Example
 *
 * Demonstrates using @wardenlabs/core directly in your own project
 * for deterministic policy evaluation, hash-chained audit logging,
 * and per-task context isolation.
 *
 * Run: npx tsx examples/programmatic/index.ts
 */

import {
  evaluate,
  MemoryLedgerStore,
  ContextManager,
  TrustLevel,
  WardenLogger,
  LogLevel,
} from "@wardenlabs/core";
import type { PolicyConfig, PolicyDecision } from "@wardenlabs/core";

// ---------------------------------------------------------------------------
// 1. Create a WardenLogger for structured output
// ---------------------------------------------------------------------------

const logger = new WardenLogger("example", LogLevel.DEBUG);

// ---------------------------------------------------------------------------
// 2. Define the policy configuration
// ---------------------------------------------------------------------------

const config: PolicyConfig = {
  version: "2",
  meta: {
    environment: "development",
    sessionApprovalRequired: false,
  },
  policies: [
    {
      id: "allow-reads",
      description: "Safe read operations allowed in development and staging",
      match: {
        tools: ["read_file", "list_directory", "query"],
        trustSource: [TrustLevel.SYSTEM, TrustLevel.AGENT, TrustLevel.TOOL],
        environment: ["development", "staging"],
      },
      action: "ALLOW",
    },
    {
      id: "confirm-writes",
      description: "File writes require human confirmation",
      match: {
        tools: ["write_file", "delete_file"],
        environment: ["development", "staging", "production"],
      },
      action: "CONFIRM",
      channel: "stdout",
      timeoutSeconds: 60,
    },
    {
      id: "block-shell-injection",
      description: "Block known shell injection patterns",
      match: {
        tool: "Bash",
        inputPatterns: [
          "rm\\s+-rf",
          "curl.*\\|.*sh",
          "eval\\s*\\(",
        ],
      },
      action: "DENY",
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Create the policy engine, ledger, and context manager
// ---------------------------------------------------------------------------

const ledger = new MemoryLedgerStore();
const contextManager = new ContextManager();

logger.info("Policy engine initialised", {
  environment: config.meta.environment,
  ruleCount: config.policies.length,
});

// ---------------------------------------------------------------------------
// 4. Create a task context (scoped per task, not per session)
// ---------------------------------------------------------------------------

const sessionId = "session-demo-001";
const task = contextManager.createTask(sessionId, /* ttlMinutes */ 30);

logger.info("Task created", {
  taskId: task.taskId,
  sessionId: task.sessionId,
  startedAt: task.startedAt,
  expiresAt: task.expiresAt,
});

// ---------------------------------------------------------------------------
// 5. Helper: evaluate a tool call and write the decision to the ledger
// ---------------------------------------------------------------------------

function evalToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  trust: (typeof TrustLevel)[keyof typeof TrustLevel],
): PolicyDecision {
  const decision = evaluate(config, {
    toolName,
    toolInput,
    environment: config.meta.environment,
    trustSources: [{ source: "agent", trust }],
    serverInAllowlist: true,
  });

  // Build a ledger entry for this decision
  const entry = {
    id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    previousHash: ledger.lastHash(),
    timestamp: new Date().toISOString(),
    sessionId,
    taskId: task.taskId,
    tool: toolName,
    toolInput,
    trustLevel: trust,
    trustSource: "agent",
    policyRulesMatched: [decision.reason],
    decision: decision.action,
    decisionReason: decision.reason,
    hash: "", // computed by the ledger
    previousEntryHash: ledger.lastHash(),
  };

  ledger.write(entry);
  contextManager.recordToolCall(task.taskId, toolName);

  return decision;
}

// ---------------------------------------------------------------------------
// 6. Evaluate a set of tool calls — each exercises a different outcome
// ---------------------------------------------------------------------------

logger.info("Evaluating tool calls", { count: 5 });

// 6a. ALLOW — reading a file in development with AGENT trust
const decision1 = evalToolCall("read_file", { path: "/tmp/notes.txt" }, TrustLevel.AGENT);
logger.info("Decision", { tool: "read_file", ...decision1 });

// 6b. ALLOW — listing a directory (also covered by allow-reads)
const decision2 = evalToolCall("list_directory", { path: "/tmp" }, TrustLevel.TOOL);
logger.info("Decision", { tool: "list_directory", ...decision2 });

// 6c. CONFIRM — writing a file triggers the confirm-writes rule
const decision3 = evalToolCall("write_file", { path: "/tmp/notes.txt", content: "hello" }, TrustLevel.AGENT);
logger.info("Decision", { tool: "write_file", ...decision3 });

// 6d. DENY — Bash with `rm -rf` matches the shell injection pattern
const decision4 = evalToolCall("Bash", { command: "rm -rf /important/data" }, TrustLevel.AGENT);
logger.info("Decision", { tool: "Bash", ...decision4 });

// 6e. DENY — an unknown tool (default deny — no policy matches)
const decision5 = evalToolCall("send_email", { to: "admin@example.com" }, TrustLevel.AGENT);
logger.info("Decision", { tool: "send_email", ...decision5 });

// ---------------------------------------------------------------------------
// 7. Verify the hash-chained ledger
// ---------------------------------------------------------------------------

logger.info("Verifying ledger chain integrity");

const chainResult = ledger.verifyChain();
if (chainResult.valid) {
  logger.info("Ledger chain is VALID", { entryCount: ledger.getEntries().length });
} else {
  logger.error("Ledger chain is BROKEN", {
    brokenAt: chainResult.brokenAt,
    entryCount: ledger.getEntries().length,
  });
}

// ---------------------------------------------------------------------------
// 8. Print the audit trail
// ---------------------------------------------------------------------------

logger.info("=== AUDIT TRAIL ===");

const entries = ledger.getEntries(sessionId);
for (const [i, entry] of entries.entries()) {
  const icon: Record<string, string> = {
    ALLOW: "✓",
    CONFIRM: "?",
    DENY: "✗",
    QUARANTINE: "!",
  };
  console.log(
    `  ${String(i).padStart(3, " ")}. [${icon[entry.decision] ?? "?"}] ${entry.decision.padEnd(10)} | ` +
    `tool=${entry.tool.padEnd(18)} ` +
    `trust=${entry.trustLevel} ` +
    `hash=${entry.hash.slice(0, 12)}...`,
  );
}

// ---------------------------------------------------------------------------
// 9. Summary
// ---------------------------------------------------------------------------

const summary = {
  totalEvaluations: entries.length,
  allowed: entries.filter((e) => e.decision === "ALLOW").length,
  denied: entries.filter((e) => e.decision === "DENY").length,
  confirm: entries.filter((e) => e.decision === "CONFIRM").length,
  quarantine: entries.filter((e) => e.decision === "QUARANTINE").length,
  chainValid: chainResult.valid,
};

logger.info("Summary", summary);

// Clean up
ledger.close();
