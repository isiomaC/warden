import type { Context } from "hono";
import type { WardenLogger } from "@warden/core";

const HOOK_EVENT_NAMES_BY_PATH: Record<string, string> = {
  "/hooks/session-start": "SessionStart",
  "/hooks/session-end": "SessionEnd",
  "/hooks/pre-tool-use": "PreToolUse",
  "/hooks/post-tool-use": "PostToolUse",
  "/hooks/prompt-submit": "UserPromptSubmit",
  "/hooks/config-change": "ConfigChange",
};

function resolveHookEventName(path: string): string {
  return HOOK_EVENT_NAMES_BY_PATH[path] ?? "Unknown";
}

/**
 * Registered via `app.onError()`, not `app.use()` — Hono's compose() converts
 * a handler's thrown error to a response at the dispatch layer closest to the
 * throw, using the app's errorHandler, so a `try/catch` around `next()` in
 * regular middleware never observes downstream handler errors.
 */
export function failClosedHandler(logger?: WardenLogger) {
  return (err: Error, c: Context) => {
    if (logger) {
      logger.error("Hook handler threw unhandled error — failing closed.", {
        error: err.message,
        path: c.req.path,
        method: c.req.method,
      });
    }

    return c.json(
      {
        hookSpecificOutput: {
          hookEventName: resolveHookEventName(c.req.path),
          permissionDecision: "deny",
          permissionDecisionReason: "Warden internal error. Failing closed.",
        },
      },
      500,
    );
  };
}
