import type { Context } from "hono";
import { scanForInjection, TrustLevel, generateId } from "@warden/core";
import type { LedgerStore } from "@warden/core";

export function handlePromptSubmit(ledger: LedgerStore) {
  return async (c: Context) => {
    const body = await c.req.json();
    const prompt = body.prompt ?? body.text ?? "";

    const result = scanForInjection(prompt, TrustLevel.EXTERNAL);

    if (!result.clean) {
      ledger.writeSecurityEvent({
        id: generateId("injection"),
        timestamp: new Date().toISOString(),
        eventType: "INJECTION_DETECTED",
        details: {
          prompt: prompt,
          patterns: result.patterns,
        },
      });

      return c.json({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          permissionDecision: "deny",
          permissionDecisionReason: `Warden: Indirect prompt injection pattern detected in submitted prompt. Patterns: [${result.patterns?.join(", ")}]. Session logged.`,
        },
      });
    }

    return c.json({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        permissionDecision: "allow",
        permissionDecisionReason: "Warden: Prompt clean.",
      },
    });
  };
}
