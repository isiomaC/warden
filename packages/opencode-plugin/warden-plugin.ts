// OpenCode plugin — runs inside OpenCode's plugin runtime.
// Plugin type + event context are provided by OpenCode at runtime;
// @opencode-ai/plugin is a real devDependency here so this file's hook
// signatures are type-checked against the actual Hooks interface (a prior
// @ts-ignore on this import silently made every hook parameter `any`,
// which is how tool.execute.before/after ended up reading from the wrong
// parameter for months without tsc ever catching it — see the git history
// on this file for the fix).
//
// Setup:
//   1. Copy this file to .opencode/plugins/warden-plugin.ts in your project
//   2. Add { "plugin": [".opencode/plugins/warden-plugin.ts"] } to opencode.json
//   3. npm install @warden/core
//   4. Run `warden init` to create warden.config.yml (or write one manually)
//
// Latest version: https://github.com/isiomaC/warden/blob/main/packages/opencode-plugin/warden-plugin.ts
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
    // NOTE: "tui.prompt.append" is a real OpenCode concept, but it's an
    // Event.type value dispatched through this generic event hook — not a
    // standalone top-level hook function. (That distinction is likely the
    // origin of the old, nonexistent "tui.prompt.append" hook key.) Prompt
    // injection scanning is done in "chat.message" below instead, since
    // that hook has confirmed before-the-LLM blocking semantics (mutable
    // output.parts); a generic event listener has no output to act on and
    // its ability to actually cancel anything is unconfirmed.
    event: async ({ event }) => {
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

    // NOTE: real hook name is "chat.message", not "tui.prompt.append" — the
    // latter does not exist anywhere in @opencode-ai/plugin's Hooks
    // interface and has never fired. The user's prompt text lives in
    // output.parts (an array of Part; text parts have type "text"), not on
    // input.
    "chat.message": async (_input, output) => {
      for (const part of output.parts) {
        if (part.type !== "text") continue;
        const result = scanForInjection(part.text, TrustLevel.EXTERNAL);
        if (!result.clean) {
          throw new Error(
            `Warden: Injection pattern detected — ${result.patterns?.join(", ")}`,
          );
        }
      }
    },

    // NOTE: the real Hooks signature is (input: {tool, sessionID, callID},
    // output: {args}) — the actual tool arguments live on `output.args`,
    // not `input.args` (input has no `args` field at all). Reading from
    // input.args meant every inputPatterns-based rule (shell injection,
    // block-rmrf, etc.) was evaluated against `undefined` and could never
    // match — the correct DENY only ever happened via default-deny.
    "tool.execute.before": async (input, output) => {
      const toolInput = (output.args ?? {}) as Record<string, unknown>;
      const trustedInput = tagValue(toolInput, `mcp__${input.tool}`, taskId);

      const decision: PolicyDecision = evaluate(config, {
        toolName: input.tool,
        toolInput,
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
        toolInput: redactSecrets(toolInput),
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

    // NOTE: real signature is (input: {tool, sessionID, callID, args},
    // output: {title, output, metadata}) — the tool's actual result string
    // is output.output, not input.result (input has no `result` field).
    "tool.execute.after": async (input, output) => {
      tagValue(output.output, `mcp__${input.tool}`, taskId);
    },

    // NOTE: real hook name is "permission.ask", not "permission.asked", and
    // it does not return a value — it mutates output.status ("ask" | "deny"
    // | "allow"). The input is a Permission object (id, type, pattern,
    // sessionID, messageID, metadata), not a {tool, args} tool call. Only
    // sets output.status on an explicit Warden DENY; otherwise leaves it
    // untouched so OpenCode's own ask-flow still runs for anything Warden
    // doesn't have an opinion on (tool.execute.before is the primary,
    // fully-informed enforcement point — this hook covers permission
    // prompts that may not correspond 1:1 to a tool call).
    "permission.ask": async (input, output) => {
      const pattern = Array.isArray(input.pattern) ? input.pattern.join(" ") : input.pattern;
      const decision = evaluate(config, {
        toolName: input.type,
        toolInput: { pattern, ...input.metadata },
        environment: config.meta.environment,
        trustSources: [{ source: "agent", trust: TrustLevel.AGENT }],
        serverInAllowlist: true,
      });

      if (decision.action === "DENY") {
        output.status = "deny";
      }
    },
  };
};
