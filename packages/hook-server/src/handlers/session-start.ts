import type { Context } from "hono";
import type { VaultAdapter, LedgerStore, ContextManager } from "@wardenlabs/core";

export function handleSessionStart(
  vault: VaultAdapter,
  contextManager: ContextManager,
  _ledger: LedgerStore,
) {
  return async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    const sessionId = c.get("sessionId") as string;

    const taskId = contextManager.createTask(sessionId).taskId;

    const token = vault.mintToken({
      taskId,
      sessionId,
      allowedTools: body.allowedTools ?? ["*"],
      environment: body.environment ?? "development",
      ttlSeconds: 300,
    });

    return c.json({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        permissionDecision: "allow",
        permissionDecisionReason: "Warden session initialized.",
        sessionToken: token.tokenId,
        taskId,
      },
    });
  };
}
