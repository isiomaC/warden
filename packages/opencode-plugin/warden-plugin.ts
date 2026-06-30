// OpenCode plugin — runs inside OpenCode's plugin runtime.
// Plugin type + event context are provided by OpenCode at runtime.
// TypeScript checking is skipped for this file (excluded from tsconfig).
// @ts-ignore — @opencode-ai/plugin is a runtime dependency provided by OpenCode
import type { Plugin } from "@opencode-ai/plugin";
import {
  MemoryLedgerStore,
  ContextManager,
  LocalVault,
  evaluate,
  tagValue,
  redactSecrets,
  scanForInjection,
  TrustLevel,
  generateId,
} from "@warden/core";
import type { PolicyConfig, PolicyDecision, LedgerStore } from "@warden/core";

let ledger: LedgerStore;
let contextManager: ContextManager;
let vault: LocalVault;
let config: PolicyConfig;
let sessionId: string;
let taskId: string;

export const WardenPlugin: Plugin = async () => {
  vault = new LocalVault();
  ledger = new MemoryLedgerStore();
  contextManager = new ContextManager();

  config = {
    version: "2",
    meta: { environment: "development", sessionApprovalRequired: false },
    policies: [
      {
        id: "block-prod-writes",
        description: "No writes to production",
        match: { tools: ["write_file", "db_write"], environment: ["production"] },
        action: "DENY",
      },
      {
        id: "confirm-destructive",
        description: "Confirm destructive ops",
        match: { tools: ["delete_file", "git_push", "send_email"] },
        action: "CONFIRM",
        channel: "stdout",
      },
      {
        id: "block-injection",
        description: "Block shell injection",
        match: {
          tool: "bash",
          inputPatterns: ["rm\\s+-rf", "curl.*\\|.*sh", "eval\\s*\\(", "wget.*\\|.*sh"],
        },
        action: "DENY",
      },
      {
        id: "allow-read-dev",
        description: "Allow reads in dev",
        match: {
          tools: ["read", "list_directory", "grep", "glob"],
          trustSource: [TrustLevel.SYSTEM, TrustLevel.AGENT, TrustLevel.TOOL],
          environment: ["staging", "development"],
        },
        action: "ALLOW",
      },
    ],
  };

  return {
    event: async ({ event }: any) => {
      if (event.type === "session.created") {
        sessionId = `session_${Date.now()}`;
        const ctx = contextManager.createTask(sessionId);
        taskId = ctx.taskId;
        vault.mintToken({
          taskId,
          sessionId,
          allowedTools: ["*"],
          environment: config.meta.environment,
          ttlSeconds: 3600,
        });
      }

      if (event.type === "session.deleted") {
        vault.revokeAllForSession(sessionId);
        contextManager.expireAllForSession(sessionId);
      }
    },

    "tui.prompt.append": async (input: { text: string }) => {
      const result = scanForInjection(input.text, TrustLevel.EXTERNAL);
      if (!result.clean) {
        throw new Error(
          `Warden: Injection pattern detected — ${result.patterns?.join(", ")}`,
        );
      }
    },

    "tool.execute.before": async (input: { tool: string; args: Record<string, unknown> }) => {
      const trustedInput = tagValue(input.args, `mcp__${input.tool}`, taskId);

      const decision: PolicyDecision = evaluate(config, {
        toolName: input.tool,
        toolInput: input.args,
        environment: config.meta.environment,
        trustSources: [{ source: trustedInput.source, trust: trustedInput.trust }],
        serverInAllowlist: true,
      });

      contextManager.recordToolCall(taskId, input.tool);

      ledger.write({
        id: generateId("opencode"),
        previousHash: ledger.lastHash(),
        timestamp: new Date().toISOString(),
        sessionId,
        taskId,
        tool: input.tool,
        toolInput: redactSecrets(input.args),
        trustLevel: trustedInput.trust,
        trustSource: trustedInput.source,
        policyRulesMatched: [],
        decision: decision.action,
        decisionReason: decision.reason,
        hash: "",
        previousEntryHash: ledger.lastHash(),
      });

      if (decision.action === "DENY") {
        throw new Error(`Warden BLOCKED: ${decision.reason}`);
      }

      if (decision.action === "QUARANTINE") {
        throw new Error(`Warden QUARANTINE: ${decision.reason}. Context stripped.`);
      }
    },

    "tool.execute.after": async (input: { tool: string; result: unknown }) => {
      tagValue(input.result, `mcp__${input.tool}`, taskId);
    },

    "permission.asked": async (input: { tool: string; args: Record<string, unknown> }) => {
      const decision = evaluate(config, {
        toolName: input.tool,
        toolInput: input.args,
        environment: config.meta.environment,
        trustSources: [{ source: "agent", trust: TrustLevel.AGENT }],
        serverInAllowlist: true,
      });

      if (decision.action === "DENY") {
        return { allowed: false as const, reason: `Warden: ${decision.reason}` };
      }

      return { allowed: true as const };
    },
  };
};
