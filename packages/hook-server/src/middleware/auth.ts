import type { Context, Next } from "hono";
import type { VaultAdapter } from "@wardenlabs/core";

export function authMiddleware(vault: VaultAdapter) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json(
        {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Warden: Missing session token.",
          },
        },
        401,
      );
    }

    const tokenId = authHeader.slice(7);
    const token = vault.verifyToken(tokenId);
    if (!token) {
      return c.json(
        {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Warden: Token expired or revoked.",
          },
        },
        401,
      );
    }

    c.set("sessionId", token.sessionId);
    c.set("taskId", token.taskId);
    c.set("token", token);
    return await next();
  };
}
