import type { Context, Next } from "hono";

export function failClosedMiddleware() {
  return async (_c: Context, next: Next) => {
    try {
      return await next();
    } catch {
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
