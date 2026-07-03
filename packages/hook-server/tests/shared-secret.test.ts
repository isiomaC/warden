import { describe, it, expect } from "vitest";
import { createHookServer } from "../src/server";
import type { PolicyConfig } from "@warden/core";

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
