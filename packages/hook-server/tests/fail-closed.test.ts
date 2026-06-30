import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { failClosedHandler } from "../src/middleware/fail-closed";

function appWithThrowingHandlers() {
  const app = new Hono();
  app.onError(failClosedHandler());

  const paths = [
    "/hooks/session-start",
    "/hooks/session-end",
    "/hooks/pre-tool-use",
    "/hooks/post-tool-use",
    "/hooks/prompt-submit",
    "/hooks/config-change",
    "/hooks/unrecognized-route",
  ];

  for (const path of paths) {
    app.post(path, async () => {
      throw new Error("boom");
    });
  }

  return app;
}

describe("failClosedMiddleware — hookEventName resolution", () => {
  const cases: Array<[string, string]> = [
    ["/hooks/session-start", "SessionStart"],
    ["/hooks/session-end", "SessionEnd"],
    ["/hooks/pre-tool-use", "PreToolUse"],
    ["/hooks/post-tool-use", "PostToolUse"],
    ["/hooks/prompt-submit", "UserPromptSubmit"],
    ["/hooks/config-change", "ConfigChange"],
  ];

  for (const [path, expectedHookEventName] of cases) {
    it(`should report hookEventName "${expectedHookEventName}" for ${path}`, async () => {
      const app = appWithThrowingHandlers();
      const res = await app.fetch(new Request(`http://localhost${path}`, { method: "POST" }));

      expect(res.status).toBe(500);
      const data = await res.json() as Record<string, unknown>;
      const output = data.hookSpecificOutput as Record<string, string>;
      expect(output.hookEventName).toBe(expectedHookEventName);
      expect(output.permissionDecision).toBe("deny");
    });
  }

  it("should fall back to \"Unknown\" for an unrecognized route rather than mislabeling it", async () => {
    const app = appWithThrowingHandlers();
    const res = await app.fetch(
      new Request("http://localhost/hooks/unrecognized-route", { method: "POST" }),
    );

    expect(res.status).toBe(500);
    const data = await res.json() as Record<string, unknown>;
    const output = data.hookSpecificOutput as Record<string, string>;
    expect(output.hookEventName).toBe("Unknown");
  });
});
