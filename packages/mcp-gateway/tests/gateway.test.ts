import { describe, it, expect } from "vitest";
import { WardenGateway } from "../src/gateway";
import {
  MemoryLedgerStore,
  ContextManager,
} from "@wardenlabs/core";
import { TrustLevel } from "@wardenlabs/core";
import type { PolicyConfig } from "@wardenlabs/core";
import { MCPRegistry as Registry } from "../src/registry";
import { OAuthManager as OAuth } from "../src/oauth";

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
        tools: ["write_file"],
        environment: ["production"],
      },
      action: "DENY",
    },
    {
      id: "allow-read-staging",
      description: "Allow reads in dev/staging",
      match: {
        tools: ["read_file", "query"],
        trustSource: [TrustLevel.SYSTEM, TrustLevel.AGENT],
        environment: ["staging", "development"],
      },
      action: "ALLOW",
    },
  ],
};

describe("MCP Gateway", () => {
  describe("MCPRegistry", () => {
    it("should allow listed servers", () => {
      const registry = new Registry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
      ]);
      expect(registry.isAllowed("filesystem")).toBe(true);
    });

    it("should deny unlisted servers", () => {
      const registry = new Registry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
      ]);
      expect(registry.isAllowed("evil-server")).toBe(false);
    });

    it("should throw SecurityError for unlisted servers on assert", () => {
      const registry = new Registry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
      ]);
      expect(() => registry.assertAllowed("evil-server")).toThrow();
    });
  });

  describe("OAuthManager", () => {
    it("should store and retrieve valid tokens", () => {
      const oauth = new OAuth();
      oauth.storeToken("github", {
        accessToken: "gh_token",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scope: "repo",
      });
      expect(oauth.hasValidToken("github")).toBe(true);
    });

    it("should return null for expired tokens", () => {
      const oauth = new OAuth();
      oauth.storeToken("github", {
        accessToken: "gh_token",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        scope: "repo",
      });
      expect(oauth.getToken("github")).toBeNull();
    });

    it("should revoke tokens", () => {
      const oauth = new OAuth();
      oauth.storeToken("github", {
        accessToken: "gh_token",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scope: "repo",
      });
      oauth.revokeToken("github");
      expect(oauth.hasValidToken("github")).toBe(false);
    });
  });

  describe("WardenGateway", () => {
    it("should wrap an allowed MCP server", () => {
      const gateway = new WardenGateway({
        config: testConfig,
        ledger: new MemoryLedgerStore(),
        contextManager: new ContextManager(),
        registry: new Registry([
          { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
        ]),
      });

      const wrapped = gateway.wrapMCP("filesystem", {
        allowedTools: ["read_file"],
        trustLevel: TrustLevel.TOOL,
        maxCallsPerMinute: 60,
        serverName: "filesystem",
      });

      expect(wrapped.serverName).toBe("filesystem");
      expect(wrapped.allowedTools).toEqual(["read_file"]);
    });

    it("should DENY tool calls for unlisted servers", () => {
      const gateway = new WardenGateway({
        config: testConfig,
        ledger: new MemoryLedgerStore(),
        contextManager: new ContextManager(),
        registry: new Registry([]),
      });

      expect(() =>
        gateway.wrapMCP("evil-server", {
          allowedTools: [],
          trustLevel: TrustLevel.TOOL,
          maxCallsPerMinute: 60,
          serverName: "evil-server",
        }),
      ).toThrow();
    });
  });
});
