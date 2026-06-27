import type { Context } from "hono";
import {
  evaluate,
  tagValue,
  redactSecrets,
  sanitizeExternalValues,
} from "@wardenlabs/core";
import type { PolicyConfig, LedgerStore, ContextStore } from "@wardenlabs/core";
import type { TrustRegistry } from "@wardenlabs/core";
import type { ApprovalChannel } from "../approvals/types";

export function handlePreToolUse(
  config: PolicyConfig,
  ledger: LedgerStore,
  contextManager: ContextStore,
  trustRegistry: TrustRegistry,
  approvalChannel?: ApprovalChannel,
) {
  return async (c: Context) => {
    const body = await c.req.json();
    const { tool_name, tool_input, session_id } = body;
    const taskId = c.get("taskId") as string;

    const task = contextManager.getTask(taskId);
    if (!task) {
      return c.json({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Warden: Task context not found or expired.",
          errorCode: "WARDEN_TASK_EXPIRED",
        },
      }, 403);
    }

    const trustedInput = tagValue(tool_input, `mcp__${tool_name}`, taskId);

    const inputTrust = trustRegistry.lookup(tool_input);
    const allSources = [{ source: trustedInput.source, trust: trustedInput.trust }];
    if (inputTrust !== undefined) {
      allSources.push({ source: "trust-registry", trust: inputTrust });
    }

    const input = {
      toolName: tool_name,
      toolInput: tool_input as Record<string, unknown>,
      environment: config.meta.environment,
      trustSources: allSources,
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

      case "QUARANTINE": {
        const { sanitized, stripped } = sanitizeExternalValues(
          tool_input as Record<string, unknown> ?? {},
          trustRegistry,
        );

        const warningMessage =
          "Warden: Quarantined external content was removed. Approve via Telegram to include external content.";

        ledger.writeSecurityEvent({
          id: `quarantine_${Date.now()}`,
          timestamp: new Date().toISOString(),
          eventType: "EXTERNAL_CONTENT_STRIPPED",
          details: {
            tool: tool_name,
            strippedKeys: stripped,
            decisionReason: decision.reason,
            taskId,
            sessionId: session_id,
          },
        });

        return c.json({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: "Warden: EXTERNAL-trust context stripped before tool execution.",
            updatedInput: sanitized,
            additionalContext: warningMessage,
          },
        });
      }

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
