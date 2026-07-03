import { timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";

/**
 * Opt-in shared-secret gate for all /hooks/* routes, including
 * /hooks/session-start which otherwise lets any local process mint a session
 * token. Enabled by setting WARDEN_AUTH_TOKEN (or HookServerOptions.authToken);
 * callers must then send the same value in the X-Warden-Auth header.
 * A distinct header is used because Authorization carries the per-session
 * vault token on the other hook routes.
 */
export function sharedSecretMiddleware(secret: string | undefined) {
  return async (c: Context, next: Next) => {
    if (!secret || secret.length === 0) return await next();

    const provided = c.req.header("X-Warden-Auth") ?? "";
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    const valid = a.length === b.length && timingSafeEqual(a, b);

    if (!valid) {
      return c.json(
        {
          hookSpecificOutput: {
            hookEventName: "AuthError",
            permissionDecision: "deny",
            permissionDecisionReason:
              "Warden: Invalid or missing shared secret. Send the WARDEN_AUTH_TOKEN value in the X-Warden-Auth header.",
            errorCode: "WARDEN_SHARED_SECRET_INVALID",
          },
        },
        401,
      );
    }

    return await next();
  };
}
