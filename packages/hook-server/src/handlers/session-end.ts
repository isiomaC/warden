import type { Context } from "hono";
import type { VaultAdapter, LedgerStore, ContextStore } from "@stlw/warden";

export function handleSessionEnd(
  vault: VaultAdapter,
  contextManager: ContextStore,
  _ledger: LedgerStore,
) {
  return async (c: Context) => {
    const sessionId = c.get("sessionId") as string;
    vault.revokeAllForSession(sessionId);
    contextManager.expireAllForSession(sessionId);

    // Claude Code's real hook-output schema has no SessionEnd variant at all —
    // any hookSpecificOutput here (even just {hookEventName: "SessionEnd"})
    // fails its validation and gets logged as a hook failure on every real
    // session, confirmed against the actual CLI. SessionEnd is fire-and-forget
    // cleanup with nothing left to allow/deny, so an empty body is correct.
    return c.json({});
  };
}
