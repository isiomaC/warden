import { describe, it, expect } from "vitest";
import { createHookServer } from "../src/server";
import type { PolicyConfig } from "@stlw/warden";

const config: PolicyConfig = {
  version: "2",
  meta: { environment: "development", sessionApprovalRequired: false },
  policies: [
    {
      id: "allow-reads",
      description: "Allow reads in development",
      match: { tools: ["read_file"], environment: ["development"] },
      action: "ALLOW",
    },
  ],
};

function sessionStartRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/hooks/session-start", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ session_id: "s1", allowedTools: ["*"] }),
  });
}

describe("shared-secret auth (WARDEN_AUTH_TOKEN)", () => {
  it("allows requests without a header when no secret is configured", async () => {
    const server = createHookServer({ config });
    const res = await server.fetch(sessionStartRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("rejects requests missing the X-Warden-Auth header when a secret is configured", async () => {
    const server = createHookServer({ config, authToken: "s3cret" });
    const res = await server.fetch(sessionStartRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.hookSpecificOutput.errorCode).toBe("WARDEN_SHARED_SECRET_INVALID");
  });

  it("rejects requests with a wrong secret", async () => {
    const server = createHookServer({ config, authToken: "s3cret" });
    const res = await server.fetch(sessionStartRequest({ "X-Warden-Auth": "wrong" }));
    expect(res.status).toBe(401);
  });

  it("allows requests with the correct secret", async () => {
    const server = createHookServer({ config, authToken: "s3cret" });
    const res = await server.fetch(sessionStartRequest({ "X-Warden-Auth": "s3cret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("gates the other /hooks/* routes too", async () => {
    const server = createHookServer({ config, authToken: "s3cret" });
    const res = await server.fetch(
      new Request("http://localhost/hooks/pre-tool-use", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool_name: "read_file", tool_input: {} }),
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.hookSpecificOutput.errorCode).toBe("WARDEN_SHARED_SECRET_INVALID");
  });

  it("leaves /health open regardless of the secret", async () => {
    const server = createHookServer({ config, authToken: "s3cret" });
    const res = await server.fetch(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
  });
});

// Claude Code's HTTP hooks can only send static, env-var-interpolated
// headers fixed at .claude/settings.json load time — there is no documented
// mechanism to carry SessionStart's minted Bearer token into a later hook
// call's headers. So a real `claude`/`claude -p` process can never present
// `Authorization: Bearer <token>` here. Once the shared secret has already
// gated the request (sharedSecretMiddleware, ahead of this route), a request
// with no Authorization header at all is allowed to bootstrap a session from
// its own session_id instead of being auto-denied for lacking a Bearer token.
describe("shared-secret bootstrap (no Bearer token, secret already verified)", () => {
  const prodConfig: PolicyConfig = {
    version: "2",
    meta: { environment: "production", sessionApprovalRequired: false },
    policies: [
      {
        id: "block-prod-writes",
        description: "No writes to prod",
        match: { tools: ["write_file"], environment: ["production"] },
        action: "DENY",
      },
      {
        id: "allow-all-else",
        description: "allow everything else",
        match: {},
        action: "ALLOW",
      },
    ],
  };

  function preToolUseRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return new Request("http://localhost/hooks/pre-tool-use", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("bootstraps a session from session_id and evaluates real policy (ALLOW)", async () => {
    const server = createHookServer({ config: prodConfig, authToken: "s3cret" });
    const res = await server.fetch(
      preToolUseRequest(
        { tool_name: "read_file", tool_input: {}, session_id: "claude-headless-1" },
        { "X-Warden-Auth": "s3cret" },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookSpecificOutput.permissionDecision).toBe("allow");
  });

  it("bootstraps a session and still enforces a real DENY policy (not just an auth pass-through)", async () => {
    const server = createHookServer({ config: prodConfig, authToken: "s3cret" });
    const res = await server.fetch(
      preToolUseRequest(
        { tool_name: "write_file", tool_input: {}, session_id: "claude-headless-2" },
        { "X-Warden-Auth": "s3cret" },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(body.hookSpecificOutput.permissionDecisionReason).toContain("block-prod-writes");
  });

  it("denies the bootstrap when there is no session_id to bootstrap from", async () => {
    const server = createHookServer({ config: prodConfig, authToken: "s3cret" });
    const res = await server.fetch(
      preToolUseRequest({ tool_name: "read_file", tool_input: {} }, { "X-Warden-Auth": "s3cret" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.hookSpecificOutput.errorCode).toBe("WARDEN_NO_SESSION");
  });

  it("still denies an explicitly invalid Bearer token even with a valid shared secret present (Bearer takes precedence over bootstrap)", async () => {
    const server = createHookServer({ config: prodConfig, authToken: "s3cret" });
    const res = await server.fetch(
      preToolUseRequest(
        { tool_name: "read_file", tool_input: {}, session_id: "whatever" },
        { "X-Warden-Auth": "s3cret", Authorization: "Bearer garbage-token" },
      ),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.hookSpecificOutput.errorCode).toBe("WARDEN_TOKEN_INVALID");
  });

  it("leaves a bootstrapped request unscoped — no allowedTools restriction applies", async () => {
    const server = createHookServer({ config: prodConfig, authToken: "s3cret" });
    // A real vault token minted with a narrow allowedTools list would reject
    // "write_file" with WARDEN_SCOPE_DENIED before policy ever runs. A
    // bootstrapped request has no token at all, so it reaches policy
    // evaluation directly — this DENY comes from block-prod-writes, not from
    // WARDEN_SCOPE_DENIED.
    const res = await server.fetch(
      preToolUseRequest(
        { tool_name: "write_file", tool_input: {}, session_id: "claude-headless-3" },
        { "X-Warden-Auth": "s3cret" },
      ),
    );
    const body = await res.json();
    expect(body.hookSpecificOutput.errorCode).not.toBe("WARDEN_SCOPE_DENIED");
    expect(body.hookSpecificOutput.permissionDecisionReason).toContain("block-prod-writes");
  });

  it("does not bootstrap when no secret is configured — a missing Bearer token still hard-denies", async () => {
    const server = createHookServer({ config: prodConfig });
    const res = await server.fetch(
      preToolUseRequest({ tool_name: "read_file", tool_input: {}, session_id: "whatever" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.hookSpecificOutput.errorCode).toBe("WARDEN_MISSING_TOKEN");
  });
});
