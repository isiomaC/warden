import type { Context } from "hono";
import { tagValue, hasSecrets, TrustLevel, generateId, scanForInjection } from "@warden/core";
import type { LedgerStore, ContextStore, TrustRegistry } from "@warden/core";

function registerExternalValues(
  value: unknown,
  registry: TrustRegistry,
  taskId: string,
): void {
  if (value === null || value === undefined) return;

  if (typeof value === "string") {
    registry.register(value, TrustLevel.EXTERNAL, `mcp__scanner__${taskId}`);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      registerExternalValues(item, registry, taskId);
    }
    return;
  }

  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      registerExternalValues(v, registry, taskId);
    }
  }
}

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

    const outputStr = typeof tool_output === "string" ? tool_output : JSON.stringify(tool_output);

    const scanResult = scanForInjection(outputStr, TrustLevel.EXTERNAL);
    if (!scanResult.clean) {
      trustRegistry.register(tool_output, TrustLevel.EXTERNAL, `mcp__${tool_name}__scanner`);
      registerExternalValues(tool_output, trustRegistry, taskId);

      ledger.writeSecurityEvent({
        id: generateId("injection"),
        timestamp: new Date().toISOString(),
        eventType: "INJECTION_DETECTED_IN_OUTPUT",
        details: {
          tool: tool_name,
          taskId,
          patterns: scanResult.patterns,
          summary: `Injection patterns detected in tool output from ${tool_name}. Output classified as EXTERNAL trust.`,
        },
      });
      warning = `Warden: Injection patterns detected (${scanResult.patterns?.join(", ")}). Output classified as EXTERNAL trust.`;
    }

    if (hasSecrets(outputStr)) {
      ledger.writeSecurityEvent({
        id: generateId("secrets"),
        timestamp: new Date().toISOString(),
        eventType: "SECRETS_IN_OUTPUT",
        details: {
          tool: tool_name,
          taskId,
          summary: "Secrets detected in tool output. Output registered with trust tagging.",
        },
      });
      if (!warning) {
        warning = "Warden: Secrets detected in tool output. Output has been trust-tagged but secrets were found.";
      }
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
