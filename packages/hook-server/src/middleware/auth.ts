import type { Context, Next } from "hono";
import type { VaultAdapter } from "@wardenlabs/core";

export function authMiddleware(vault: VaultAdapter) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
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
