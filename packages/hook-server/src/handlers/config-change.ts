import type { Context } from "hono";
import type { LedgerStore } from "@wardenlabs/core";

export function handleConfigChange(ledger: LedgerStore) {
  return async (c: Context) => {
    ledger.writeSecurityEvent({
      id: `config_${Date.now()}`,
      timestamp: new Date().toISOString(),
      eventType: "CONFIG_CHANGE_BLOCKED",
      details: { reason: "Runtime config mutation blocked" },
    });

    return c.json({
      hookSpecificOutput: {
        hookEventName: "ConfigChange",
        permissionDecision: "deny",
        permissionDecisionReason: "Warden: Runtime config mutation is not permitted. Warden policy is locked at session start. Restart session to apply new config.",
      },
    });
  };
}
