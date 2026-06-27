import type { Context } from "hono";
import type { VaultAdapter, LedgerStore, ContextStore } from "@warden/core";

export function handleSessionEnd(
  vault: VaultAdapter,
  contextManager: ContextStore,
  _ledger: LedgerStore,
) {
  return async (c: Context) => {
    const sessionId = c.get("sessionId") as string;
    vault.revokeAllForSession(sessionId);
    contextManager.expireAllForSession(sessionId);

    return c.json({
      hookSpecificOutput: {
        hookEventName: "SessionEnd",
        permissionDecision: "allow",
        permissionDecisionReason: "Warden session ended. Tokens revoked.",
      },
    });
  };
}
