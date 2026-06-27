import type { Context, Next } from "hono";
import type { WardenLogger } from "@wardenlabs/core";

export function failClosedMiddleware(logger?: WardenLogger) {
  return async (_c: Context, next: Next) => {
    try {
      return await next();
    } catch (err) {
      if (logger) {
        logger.error("Hook handler threw unhandled error — failing closed.", {
          error: err instanceof Error ? err.message : String(err),
          path: _c.req.path,
          method: _c.req.method,
        });
      }

      return _c.json(
        {
          hookSpecificOutput: {
            hookEventName: _c.req.path.includes("pre-tool-use")
              ? "PreToolUse"
              : "PostToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Warden internal error. Failing closed.",
          },
        },
        500,
      );
    }
  };
}
