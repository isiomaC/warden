import type { Context } from "hono";
import { tagValue, hasSecrets, TrustLevel } from "@warden/core";
import type { LedgerStore, ContextStore, TrustRegistry } from "@warden/core";

export function handlePostToolUse(
  ledger: LedgerStore,
  contextManager: ContextStore,
  trustRegistry: TrustRegistry,
) {
  return async (c: Context) => {
    const body = await c.req.json();
    const { tool_name, tool_output } = body;
    const taskId = c.get("taskId") as string;

    const trustedOutput = tagValue(
      tool_output,
      `mcp__${tool_name}`,
      taskId,
    );

    trustRegistry.register(tool_output, trustedOutput.trust, trustedOutput.source);

    contextManager.recordToolCall(taskId, tool_name);

    let warning: string | undefined;

    // External destination check: flag low-trust outputs for downstream handlers
    if (trustedOutput.trust === TrustLevel.EXTERNAL || trustedOutput.trust === TrustLevel.TOOL) {
      // trustLevel is included in the hook response so downstream handlers
      // can evaluate whether low-trust output is being routed to external tools.
    }

    // Check for secrets in tool output
    const outputStr = typeof tool_output === "string" ? tool_output : JSON.stringify(tool_output);
    if (hasSecrets(outputStr)) {
      ledger.writeSecurityEvent({
        id: `secrets_${Date.now()}`,
        timestamp: new Date().toISOString(),
        eventType: "SECRETS_IN_OUTPUT",
        details: {
          tool: tool_name,
          taskId,
          summary: "Secrets detected in tool output. Output registered with trust tagging.",
        },
      });
      warning = "Warden: Secrets detected in tool output. Output has been trust-tagged but secrets were found.";
    }

    return c.json({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "Warden: Output tagged and registered.",
        trustLevel: trustedOutput.trust,
        source: trustedOutput.source,
        ...(warning ? { warning } : {}),
      },
    });
  };
}
