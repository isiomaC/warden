// OpenCode plugin — runs inside OpenCode's plugin runtime.
// Plugin type + event context are provided by OpenCode at runtime.
// TypeScript checking is skipped for this file (excluded from tsconfig).
//
// Setup:
//   1. Copy this file to .opencode/plugins/warden-plugin.ts in your project
//   2. Add { "plugin": [".opencode/plugins/warden-plugin.ts"] } to opencode.json
//   3. npm install @warden/core
//   4. Run `warden init` to create warden.config.yml (or write one manually)
//
// Latest version: https://github.com/isiomaC/warden/blob/main/packages/opencode-plugin/warden-plugin.ts
//
// @ts-ignore — @opencode-ai/plugin is a runtime dependency provided by OpenCode
import type { Plugin } from "@opencode-ai/plugin";
import { join } from "node:path";
import {
  MemoryLedgerStore,
  ContextManager,
  LocalVault,
  FileConfigSource,
  evaluate,
  tagValue,
  redactSecrets,
  scanForInjection,
  TrustLevel,
  generateId,
} from "@warden/core";
import type { PolicyConfig, PolicyDecision, LedgerStore } from "@warden/core";

const DEFAULT_CONFIG: PolicyConfig = {
  version: "2",
  meta: { environment: "development", sessionApprovalRequired: false },
  policies: [
    {
      id: "allow-read-dev",
      description: "Allow read operations in development",
      match: { tools: ["read", "list_directory"], environment: ["development"] },
      action: "ALLOW",
    },
    {
      id: "block-injection",
      description: "Block injection patterns on bash",
      match: { tool: "bash", inputPatterns: ["rm\\s+-rf", "curl.*\\|.*sh"] },
      action: "DENY",
    },
  ],
};

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

  return {
    event: async ({ event }: any) => {
      if (event.type === "session.created") {
        // Load config from warden.config.yml in the project root; fall back to safe defaults
        try {
          const configPath = join(process.cwd(), "warden.config.yml");
          const source = new FileConfigSource(configPath);
          config = await source.load();
        } catch {
          config = DEFAULT_CONFIG;
        }

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
