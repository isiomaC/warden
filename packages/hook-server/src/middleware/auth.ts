import type { Context, Next } from "hono";
import type { VaultAdapter, ContextStore } from "@stlw/warden";

/**
 * Establishes sessionId/taskId/token on the request context, or denies.
 *
 * Two credentials are accepted:
 *
 * 1. A vault-minted session Bearer token (`Authorization: Bearer <token>`),
 *    the normal path — scoped via `allowedTools`/`allowedPaths`, revocable,
 *    TTL-bound.
 * 2. A shared-secret bootstrap, used when no Bearer token is presented at
 *    all. This exists because Claude Code's HTTP hooks cannot relay a
 *    token: hook headers only support static, env-var-interpolated values
 *    fixed at `.claude/settings.json` load time, and there is no documented
 *    mechanism for Claude Code to carry a value learned from one hook's
 *    JSON response (e.g. SessionStart's `sessionToken`) into a later hook
 *    call's headers. So a real Bearer token can never arrive here from a
 *    real `claude`/`claude -p` process — headless or interactive. The
 *    shared secret (`WARDEN_AUTH_TOKEN` / `X-Warden-Auth`), by contrast, is
 *    exactly the credential shape Claude Code's hook config *can* send.
 *
 * `sharedSecretConfigured` is a boolean, not the secret value itself,
 * deliberately — this middleware does not re-validate `X-Warden-Auth`.
 * `app.use("/hooks/*", sharedSecretMiddleware(authToken))` in server.ts
 * runs before this route is ever reached and short-circuits with 401
 * (without calling `next()`) on a missing/wrong header whenever a secret is
 * configured. So by construction, if execution reaches this middleware at
 * all and `sharedSecretConfigured` is true, the request has already proved
 * it knows the secret. If no secret is configured, there was no gate
 * upstream, and the bootstrap path is refused — a missing Bearer token
 * denies exactly as before. This preserves fail-closed as the default: an
 * operator who hasn't opted into the shared secret gets 401s on every
 * Claude Code call, not silent, unauthenticated access.
 *
 * Bootstrapped requests get no vault token (`c.get("token")` stays
 * `undefined`), so they are unscoped — no `allowedTools`/`allowedPaths`
 * restriction applies, unlike the Bearer-token path. The security boundary
 * here is "does this caller know the shared secret" (deployment-wide
 * trust, the same level SessionStart itself already grants once past that
 * gate), not per-session scoping. See docs/internal/e2e-plan.md.
 *
 * An explicitly bad Bearer token still denies even when a valid shared
 * secret is also present — the bootstrap path only triggers when
 * `Authorization` is completely absent, never as an override for a
 * present-but-invalid token.
 */
export function authMiddleware(
  vault: VaultAdapter,
  contextManager: ContextStore,
  sharedSecretConfigured: boolean,
) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      if (!sharedSecretConfigured) {
        return c.json(
          {
            hookSpecificOutput: {
              hookEventName: "AuthError",
              permissionDecision: "deny",
              permissionDecisionReason: "Warden: Missing session token.",
              errorCode: "WARDEN_MISSING_TOKEN",
            },
          },
          401,
        );
      }

      const body = await c.req.json().catch(() => ({}));
      const sessionId = body.session_id as string | undefined;

      if (!sessionId) {
        return c.json(
          {
            hookSpecificOutput: {
              hookEventName: "AuthError",
              permissionDecision: "deny",
              permissionDecisionReason:
                "Warden: No session token and no session_id to bootstrap a session from.",
              errorCode: "WARDEN_NO_SESSION",
            },
          },
          401,
        );
      }

      const task = contextManager.createTask(sessionId);
      c.set("sessionId", sessionId);
      c.set("taskId", task.taskId);
      return await next();
    }

    const tokenId = authHeader.slice(7);
    const token = vault.verifyToken(tokenId);
    if (!token) {
      return c.json(
        {
          hookSpecificOutput: {
            hookEventName: "AuthError",
            permissionDecision: "deny",
            permissionDecisionReason: "Warden: Token expired or revoked.",
            errorCode: "WARDEN_TOKEN_INVALID",
          },
        },
        401,
      );
    }

    const body = await c.req.json().catch(() => ({}));
    const toolName = body.tool_name as string | undefined;
    if (toolName && token.allowedTools.length > 0 && !token.allowedTools.includes("*")) {
      if (!token.allowedTools.includes(toolName)) {
        return c.json(
          {
            hookSpecificOutput: {
              hookEventName: "AuthError",
              permissionDecision: "deny",
              permissionDecisionReason: `Warden: Tool "${toolName}" not in allowed scope.`,
              errorCode: "WARDEN_SCOPE_DENIED",
            },
          },
          403,
        );
      }
    }

    c.set("sessionId", token.sessionId);
    c.set("taskId", token.taskId);
    c.set("token", token);
    return await next();
  };
}
