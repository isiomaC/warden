import type { Context } from "hono";
import {
  evaluate,
  tagValue,
  redactSecrets,
} from "@wardenlabs/core";
import type { PolicyConfig, LedgerStore, ContextManager } from "@wardenlabs/core";
import type { ApprovalChannel } from "../approvals/types";

export function handlePreToolUse(
  config: PolicyConfig,
  ledger: LedgerStore,
  contextManager: ContextManager,
  approvalChannel?: ApprovalChannel,
) {
  return async (c: Context) => {
    const body = await c.req.json();
    const { tool_name, tool_input, session_id } = body;
    const taskId = c.get("taskId") as string;

    const trustedInput = tagValue(tool_input, `mcp__${tool_name}`, taskId);

    const input = {
      toolName: tool_name,
      toolInput: tool_input as Record<string, unknown>,
      environment: config.meta.environment,
      trustSources: [{ source: trustedInput.source, trust: trustedInput.trust }],
      serverInAllowlist: true,
    };

    const decision = evaluate(config, input);

    contextManager.recordToolCall(taskId, tool_name);

    ledger.write({
      id: `ledger_${Date.now()}`,
      previousHash: ledger.lastHash(),
      timestamp: new Date().toISOString(),
      sessionId: session_id,
      taskId,
      tool: tool_name,
      toolInput: redactSecrets(tool_input),
      trustLevel: trustedInput.trust,
      trustSource: trustedInput.source,
      policyRulesMatched: [],
      decision: decision.action,
      decisionReason: decision.reason,
      hash: "",
      previousEntryHash: ledger.lastHash(),
    });

    switch (decision.action) {
      case "ALLOW":
        return c.json({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: decision.reason,
          },
        });

      case "DENY":
        return c.json({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: decision.reason,
          },
        });

      case "CONFIRM": {
        if (approvalChannel) {
          const approved = await approvalChannel.request({
            tool: tool_name,
            input: redactSecrets(tool_input),
            reason: decision.reason,
            timeoutMs: 60_000,
          });
          return c.json({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: approved ? "allow" : "deny",
              permissionDecisionReason: approved
                ? `Human approved via ${decision.channel}`
                : "Approval timed out or denied",
            },
          });
        }
        return c.json({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: `${decision.reason} (stdout — no approval channel configured)`,
          },
        });
      }

      case "QUARANTINE":
        return c.json({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Warden: QUARANTINE — ${decision.reason}. Context stripped before execution.`,
          },
        });

      default:
        return c.json({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Warden: Unhandled policy decision.",
          },
        });
    }
  };
}
