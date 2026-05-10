import { describe, it, expect } from "vitest";
import { evaluate, resolveConflicts, evaluatePolicies } from "../src/policy";
import type { PolicyConfig } from "../src/policy";
import { TrustLevel } from "../src/trust";

const testConfig: PolicyConfig = {
  version: "2",
  meta: {
    environment: "development",
    sessionApprovalRequired: false,
  },
  policies: [
    {
      id: "block-prod-writes",
      description: "No writes to production",
      match: {
        tools: ["write_file", "db_write"],
        environment: ["production"],
      },
      action: "DENY",
    },
    {
      id: "confirm-destructive",
      description: "Confirm destructive ops",
      match: {
        tools: ["delete_file", "git_push"],
      },
      action: "CONFIRM",
      channel: "stdout",
    },
    {
      id: "quarantine-external",
      description: "Quarantine external content",
      match: {
        trustSource: [TrustLevel.EXTERNAL],
        nextTool: ["write_file", "send_email"],
      },
      action: "QUARANTINE",
    },
    {
      id: "allow-read-staging",
      description: "Allow reads in staging",
      match: {
        tools: ["read_file", "query"],
        trustSource: [TrustLevel.SYSTEM, TrustLevel.AGENT],
        environment: ["staging", "development"],
      },
      action: "ALLOW",
    },
  ],
};

describe("policy engine", () => {
  describe("evaluate", () => {
    it("should ALLOW read_file with SYSTEM trust in development", () => {
      const result = evaluate(testConfig, {
        toolName: "read_file",
        toolInput: {},
        environment: "development",
        trustSources: [{ source: "system_prompt", trust: TrustLevel.SYSTEM }],
        serverInAllowlist: true,
      });
      expect(result.action).toBe("ALLOW");
    });

    it("should DENY write_file in production", () => {
      const result = evaluate(testConfig, {
        toolName: "write_file",
        toolInput: {},
        environment: "production",
        trustSources: [{ source: "system_prompt", trust: TrustLevel.SYSTEM }],
        serverInAllowlist: true,
      });
      expect(result.action).toBe("DENY");
    });

    it("should CONFIRM for delete_file", () => {
      const result = evaluate(testConfig, {
        toolName: "delete_file",
        toolInput: {},
        environment: "development",
        trustSources: [{ source: "system_prompt", trust: TrustLevel.SYSTEM }],
        serverInAllowlist: true,
      });
      expect(result.action).toBe("CONFIRM");
    });

    it("should QUARANTINE external content flowing to write_file", () => {
      const result = evaluate(testConfig, {
        toolName: "write_file",
        toolInput: {},
        environment: "development",
        trustSources: [{ source: "web_scrape", trust: TrustLevel.EXTERNAL }],
        serverInAllowlist: true,
      });
      expect(result.action).toBe("QUARANTINE");
    });

    it("should default DENY for unmatched tool", () => {
      const result = evaluate(testConfig, {
        toolName: "unknown_tool",
        toolInput: {},
        environment: "development",
        trustSources: [{ source: "system_prompt", trust: TrustLevel.SYSTEM }],
        serverInAllowlist: true,
      });
      expect(result.action).toBe("DENY");
    });

    it("should DENY write_file in production even if also matches ALLOW", () => {
      const result = evaluate(testConfig, {
        toolName: "write_file",
        toolInput: {},
        environment: "production",
        trustSources: [{ source: "system_prompt", trust: TrustLevel.SYSTEM }],
        serverInAllowlist: true,
      });
      expect(result.action).toBe("DENY");
    });
  });

  describe("resolveConflicts", () => {
    it("should prefer DENY over all others", () => {
      const result = resolveConflicts([
        { action: "ALLOW", reason: "r1" },
        { action: "DENY", reason: "r2" },
      ]);
      expect(result.action).toBe("DENY");
    });

    it("should prefer QUARANTINE over CONFIRM and ALLOW", () => {
      const result = resolveConflicts([
        { action: "ALLOW", reason: "r1" },
        { action: "CONFIRM", reason: "r2", channel: "stdout" },
        { action: "QUARANTINE", reason: "r3", strippedContext: [] },
      ]);
      expect(result.action).toBe("QUARANTINE");
    });

    it("should prefer CONFIRM over ALLOW", () => {
      const result = resolveConflicts([
        { action: "ALLOW", reason: "r1" },
        { action: "CONFIRM", reason: "r2", channel: "stdout" },
      ]);
      expect(result.action).toBe("CONFIRM");
    });

    it("should return DENY for empty decisions", () => {
      const result = resolveConflicts([]);
      expect(result.action).toBe("DENY");
    });
  });

  describe("evaluatePolicies", () => {
    it("should return matching policy decisions", () => {
      const decisions = evaluatePolicies(testConfig, {
        toolName: "read_file",
        toolInput: {},
        environment: "development",
        trustSources: [{ source: "system_prompt", trust: TrustLevel.SYSTEM }],
        serverInAllowlist: true,
      });
      expect(decisions.length).toBeGreaterThan(0);
      expect(decisions.some((d) => d.action === "ALLOW")).toBe(true);
    });

    it("should return empty array for unmatched tools", () => {
      const decisions = evaluatePolicies(testConfig, {
        toolName: "nonexistent_tool",
        toolInput: {},
        environment: "development",
        trustSources: [{ source: "system_prompt", trust: TrustLevel.SYSTEM }],
        serverInAllowlist: true,
      });
      expect(decisions).toHaveLength(0);
    });
  });
});
