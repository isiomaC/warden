import type { Context } from "hono";
import {
  evaluate,
  tagValue,
  redactSecrets,
  sanitizeExternalValues,
  generateId,
  extractPaths,
  isPathAllowed,
} from "@warden/core";
import type { PolicyConfig, LedgerStore, ContextStore, TaskToken } from "@warden/core";
import type { TrustRegistry } from "@warden/core";
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
    let taskId = c.get("taskId") as string | undefined;
    const token = c.get("token") as TaskToken | undefined;

    if (!taskId && session_id) {
      const autoTask = contextManager.createTask(session_id);
      taskId = autoTask.taskId;
      c.set("taskId", taskId);
      c.set("sessionId", session_id);
    }

    if (!taskId) {
      return c.json({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Warden: No session established. Run SessionStart first or provide a session_id.",
          errorCode: "WARDEN_NO_SESSION",
        },
      }, 401);
    }

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

    if (token?.allowedPaths && token.allowedPaths.length > 0) {
      const paths = extractPaths(tool_input);
      const denied = paths.filter((p) => !isPathAllowed(p, token.allowedPaths!));
      if (denied.length > 0) {
        return c.json({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Warden: Path not in session allowedPaths: ${denied.join(", ")}`,
          },
        });
      }
    }

    const trustedInput = tagValue(tool_input, `mcp__${tool_name}`, taskId);

    const allSources = [{ source: trustedInput.source, trust: trustedInput.trust }];

    const inputTrust = trustRegistry.lookup(tool_input);
    if (inputTrust !== undefined) {
      allSources.push({ source: "trust-registry", trust: inputTrust });
    }

    function collectFieldTrust(value: unknown): void {
      if (value === null || value === undefined) return;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        const fieldTrust = trustRegistry.lookup(value);
        if (fieldTrust !== undefined) {
          allSources.push({ source: "trust-registry-field", trust: fieldTrust });
        }
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) collectFieldTrust(item);
        return;
      }
      if (typeof value === "object") {
        for (const v of Object.values(value as Record<string, unknown>)) collectFieldTrust(v);
      }
    }
    collectFieldTrust(tool_input);

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
      id: generateId("ledger"),
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
            sessionId: session_id,
            taskId,
            environment: config.meta.environment,
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
          id: generateId("quarantine"),
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
