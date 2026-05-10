import type { Context } from "hono";
import { scanForInjection, TrustLevel } from "@wardenlabs/core";
import type { LedgerStore } from "@wardenlabs/core";

export function handlePromptSubmit(_ledger: LedgerStore) {
  return async (c: Context) => {
    const body = await c.req.json();
    const prompt = body.prompt ?? body.text ?? "";

    const result = scanForInjection(prompt, TrustLevel.EXTERNAL);

    if (!result.clean) {
      return c.json({
        decision: "block",
        reason: `Warden: Indirect prompt injection pattern detected. Patterns: ${result.patterns?.join(", ")}. Session logged.`,
      });
    }

    return c.json({
      decision: "allow",
      reason: "Warden: Prompt clean.",
    });
  };
}
