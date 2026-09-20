import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleHook } from "../scripts/codex-hook-adapter.mjs";

const preToolUse = {
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command: "ls" },
  session_id: "session-1",
};

function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "warden-codex-test-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session-1.json"), JSON.stringify({ token: "test-token" }));
  return dir;
}

describe("Codex hook adapter", () => {
  it("maps Warden ALLOW to Codex allow", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: "allow",
        permissionDecisionReason: "read allowed",
      },
    })));

    await expect(handleHook(preToolUse, { fetchImpl, stateDir: stateDir() }))
      .resolves.toEqual({ permissionDecision: "allow", permissionDecisionReason: "read allowed" });
  });

  it("maps Warden DENY to Codex deny", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "blocked by policy",
      },
    })));

    await expect(handleHook(preToolUse, { fetchImpl, stateDir: stateDir() }))
      .resolves.toEqual({ permissionDecision: "deny", permissionDecisionReason: "blocked by policy" });
  });

  it("denies malformed PreToolUse input", async () => {
    await expect(handleHook({ hook_event_name: "PreToolUse" }, { fetchImpl: vi.fn(), stateDir: stateDir() }))
      .resolves.toMatchObject({ permissionDecision: "deny" });
  });

  it("denies when Warden cannot be reached", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(handleHook(preToolUse, { fetchImpl, stateDir: stateDir() }))
      .resolves.toEqual({
        permissionDecision: "deny",
        permissionDecisionReason: "Warden: policy enforcement unavailable; action denied.",
      });
  });
});
