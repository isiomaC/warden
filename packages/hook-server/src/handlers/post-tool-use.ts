import type { Context } from "hono";
import { tagValue } from "@wardenlabs/core";
import type { LedgerStore, ContextManager } from "@wardenlabs/core";

export function handlePostToolUse(
  _ledger: LedgerStore,
  contextManager: ContextManager,
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

    contextManager.recordToolCall(taskId, tool_name);

    return c.json({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "Warden: Output tagged.",
        trustLevel: trustedOutput.trust,
        source: trustedOutput.source,
      },
    });
  };
}
