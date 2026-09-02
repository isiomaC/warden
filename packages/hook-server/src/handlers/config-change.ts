import type { Context } from "hono";
import { generateId } from "@stlw/warden";
import type { LedgerStore } from "@stlw/warden";

export function handleConfigChange(ledger: LedgerStore) {
  return async (c: Context) => {
    ledger.writeSecurityEvent({
      id: generateId("config"),
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
