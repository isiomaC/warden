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
import { checkLateralMovement } from "../src/lateral";

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

interface LateralConfig extends PolicyConfig {
  threatDetection: {
    lateralMovement: {
      enabled: boolean;
      maxMCPServersPerTaskChain: number;
      alertAction: "CONFIRM" | "DENY";
    };
  };
}

function makeLateralConfig(maxServers: number, enabled = true, action: "CONFIRM" | "DENY" = "CONFIRM"): LateralConfig {
  return {
    ...testConfig,
    threatDetection: {
      lateralMovement: {
        enabled,
        maxMCPServersPerTaskChain: maxServers,
        alertAction: action,
      },
    },
  };
}

const gatewayConfig = makeLateralConfig(10);

const gatewayConfigWithRules: PolicyConfig = {
  version: "2",
  meta: { environment: "development", sessionApprovalRequired: false },
  policies: [
    {
      id: "allow-fs-read",
      description: "Allow filesystem reads in dev",
      match: {
        tools: ["filesystem__read_file"],
        trustSource: [TrustLevel.SYSTEM, TrustLevel.AGENT, TrustLevel.TOOL],
        environment: ["staging", "development"],
      },
      action: "ALLOW",
    },
    {
      id: "block-prod-writes",
      description: "No writes to production",
      match: {
        tools: ["filesystem__write_file"],
        environment: ["production"],
      },
      action: "DENY",
    },
  ],
  threatDetection: {
    lateralMovement: {
      enabled: true,
      maxMCPServersPerTaskChain: 10,
      alertAction: "CONFIRM" as const,
    },
  },
} as PolicyConfig & { threatDetection: { lateralMovement: { enabled: boolean; maxMCPServersPerTaskChain: number; alertAction: "CONFIRM" | "DENY" } } };

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
      const registry = new Registry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
      ]);
      const gateway = new WardenGateway({
        config: gatewayConfig,
        ledger: new MemoryLedgerStore(),
        contextManager: new ContextManager(),
        registry,
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
        config: gatewayConfig,
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

    it("should ALLOW onToolCall for allowed tool with matching policy", async () => {
      const ctx = new ContextManager();
      const task = ctx.createTask("gw-session");
      const registry = new Registry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
      ]);
      const gateway = new WardenGateway({
        config: gatewayConfigWithRules,
        ledger: new MemoryLedgerStore(),
        contextManager: ctx,
        registry,
      });

      const wrapped = gateway.wrapMCP("filesystem", {
        allowedTools: ["read_file"],
        trustLevel: TrustLevel.TOOL,
        maxCallsPerMinute: 60,
        serverName: "filesystem",
      });

      const decision = await wrapped.onToolCall(
        "read_file",
        { path: "/tmp/test.txt" },
        "gw-session",
        task.taskId,
      );

      expect(decision.action).toBe("ALLOW");
    });

    it("should DENY onToolCall for tool not in allowed list", async () => {
      const ctx = new ContextManager();
      const task = ctx.createTask("gw-session");
      const registry = new Registry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
      ]);
      const gateway = new WardenGateway({
        config: gatewayConfigWithRules,
        ledger: new MemoryLedgerStore(),
        contextManager: ctx,
        registry,
      });

      const wrapped = gateway.wrapMCP("filesystem", {
        allowedTools: ["read_file"],
        trustLevel: TrustLevel.TOOL,
        maxCallsPerMinute: 60,
        serverName: "filesystem",
      });

      const decision = await wrapped.onToolCall(
        "write_file",
        { path: "/tmp/test.txt" },
        "gw-session",
        task.taskId,
      );

      expect(decision.action).toBe("DENY");
      expect(decision.reason).toContain("not in allowed list");
    });

    it("should write ledger entry on onToolCall", async () => {
      const ctx = new ContextManager();
      const ledger = new MemoryLedgerStore();
      const task = ctx.createTask("gw-session");
      const registry = new Registry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
      ]);
      const gateway = new WardenGateway({
        config: gatewayConfigWithRules,
        ledger,
        contextManager: ctx,
        registry,
      });

      const wrapped = gateway.wrapMCP("filesystem", {
        allowedTools: ["read_file"],
        trustLevel: TrustLevel.TOOL,
        maxCallsPerMinute: 60,
        serverName: "filesystem",
      });

      await wrapped.onToolCall(
        "read_file",
        { path: "/tmp/test.txt" },
        "gw-session",
        task.taskId,
      );

      const entries = ledger.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].tool).toBe("filesystem__read_file");
      expect(entries[0].decision).toBe("ALLOW");

      const chain = ledger.verifyChain();
      expect(chain.valid).toBe(true);
    });

    it("should DENY onToolCall when rate limit exceeded", async () => {
      const ctx = new ContextManager();
      const task = ctx.createTask("gw-session");
      const registry = new Registry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
      ]);

      const rateLimitedConfig = {
        ...gatewayConfigWithRules,
        rateLimits: {
          global: { maxCalls: 2, windowMs: 60_000 },
        },
      } as unknown as PolicyConfig;

      const gateway = new WardenGateway({
        config: rateLimitedConfig,
        ledger: new MemoryLedgerStore(),
        contextManager: ctx,
        registry,
      });

      const wrapped = gateway.wrapMCP("filesystem", {
        allowedTools: ["read_file"],
        trustLevel: TrustLevel.TOOL,
        maxCallsPerMinute: 60,
        serverName: "filesystem",
      });

      await wrapped.onToolCall("read_file", { path: "/tmp/1.txt" }, "gw-session", task.taskId);
      await wrapped.onToolCall("read_file", { path: "/tmp/2.txt" }, "gw-session", task.taskId);

      const decision = await wrapped.onToolCall("read_file", { path: "/tmp/3.txt" }, "gw-session", task.taskId);

      expect(decision.action).toBe("DENY");
      expect(decision.reason).toContain("Rate limit exceeded");
    });

    describe("rate limiting", () => {
      const rateLimitConfig = {
        ...gatewayConfig,
        rateLimits: {
          global: { maxCalls: 5, windowMs: 60_000 },
        },
      } as unknown as PolicyConfig;

      it("should return allowed when under limit", () => {
        const gateway = new WardenGateway({
          config: rateLimitConfig,
          ledger: new MemoryLedgerStore(),
          contextManager: new ContextManager(),
          registry: new Registry([]),
        });

        const result = gateway.checkRateLimit("tool:test-tool");
        expect(result.allowed).toBe(true);
      });

      it("should deny when over limit", () => {
        const gateway = new WardenGateway({
          config: rateLimitConfig,
          ledger: new MemoryLedgerStore(),
          contextManager: new ContextManager(),
          registry: new Registry([]),
        });

        for (let i = 0; i < 5; i++) {
          gateway.checkRateLimit("tool:burst-tool");
        }

        const result = gateway.checkRateLimit("tool:burst-tool");
        expect(result.allowed).toBe(false);
        expect(result.retryAfterMs).toBeDefined();
        expect(typeof result.retryAfterMs).toBe("number");
      });

      it("should have separate counters per tool", () => {
        const gateway = new WardenGateway({
          config: rateLimitConfig,
          ledger: new MemoryLedgerStore(),
          contextManager: new ContextManager(),
          registry: new Registry([]),
        });

        for (let i = 0; i < 5; i++) {
          gateway.checkRateLimit("tool:tool-a");
        }
        expect(gateway.checkRateLimit("tool:tool-a").allowed).toBe(false);
        expect(gateway.checkRateLimit("tool:tool-b").allowed).toBe(true);
      });
    });

    describe("getRegistry / getOAuth", () => {
      it("should return the registry instance", () => {
        const registry = new Registry([
          { name: "gh", type: "remote", transport: "http", allowedTools: [], authRequired: true },
        ]);
        const gateway = new WardenGateway({
          config: gatewayConfig,
          ledger: new MemoryLedgerStore(),
          contextManager: new ContextManager(),
          registry,
        });

        expect(gateway.getRegistry().isAllowed("gh")).toBe(true);
        expect(gateway.getRegistry().isAllowed("evil")).toBe(false);
      });

      it("should return the OAuth manager instance", () => {
        const oauth = new OAuth();
        const gateway = new WardenGateway({
          config: gatewayConfig,
          ledger: new MemoryLedgerStore(),
          contextManager: new ContextManager(),
          registry: new Registry([]),
          oauth,
        });

        oauth.storeToken("github", {
          accessToken: "gh_token",
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          scope: "repo",
        });

        expect(gateway.getOAuth().hasValidToken("github")).toBe(true);
      });
    });
  });

  describe("Lateral movement detection", () => {
    it("should detect lateral movement when exceeding max servers", () => {
      const ctx = new ContextManager();
      const task = ctx.createTask("lat-test");
      ctx.recordToolCall(task.taskId, "server-a");
      ctx.recordToolCall(task.taskId, "server-b");
      ctx.recordToolCall(task.taskId, "server-c");

      const config: LateralConfig = makeLateralConfig(2);

      const result = checkLateralMovement(task.taskId, ctx, config);
      expect(result.shouldBlock).toBe(true);
      expect(result.serversContacted).toBe(3);
      expect(result.maxAllowed).toBe(2);
    });

    it("should not block when under max servers", () => {
      const ctx = new ContextManager();
      const task = ctx.createTask("lat-test");
      ctx.recordToolCall(task.taskId, "server-a");

      const config: LateralConfig = makeLateralConfig(3);

      const result = checkLateralMovement(task.taskId, ctx, config);
      expect(result.shouldBlock).toBe(false);
    });

    it("should not block when lateral detection is disabled", () => {
      const ctx = new ContextManager();
      const task = ctx.createTask("lat-test");
      ctx.recordToolCall(task.taskId, "server-a");
      ctx.recordToolCall(task.taskId, "server-b");
      ctx.recordToolCall(task.taskId, "server-c");

      const config: LateralConfig = makeLateralConfig(2, false);

      const result = checkLateralMovement(task.taskId, ctx, config);
      expect(result.shouldBlock).toBe(false);
    });

    it("should use DENY alert action from config", () => {
      const ctx = new ContextManager();
      const task = ctx.createTask("lat-test");
      ctx.recordToolCall(task.taskId, "server-a");
      ctx.recordToolCall(task.taskId, "server-b");
      ctx.recordToolCall(task.taskId, "server-c");

      const config: LateralConfig = makeLateralConfig(2, true, "DENY");

      const result = checkLateralMovement(task.taskId, ctx, config);
      expect(result.shouldBlock).toBe(true);
      expect(result.alertAction).toBe("DENY");
    });

    it("should return safe result for unknown task", () => {
      const ctx = new ContextManager();
      const config: LateralConfig = makeLateralConfig(2);

      const result = checkLateralMovement("nonexistent-task", ctx, config);
      expect(result.shouldBlock).toBe(false);
      expect(result.serversContacted).toBe(0);
    });
  });

  describe("Context isolation via gateway", () => {
    it("should isolate tool calls between tasks", async () => {
      const ctx = new ContextManager();
      const registry = new Registry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file", "write_file"], authRequired: false },
        { name: "github", type: "remote", transport: "http", allowedTools: ["get_file"], authRequired: true },
      ]);
      const gateway = new WardenGateway({
        config: gatewayConfig,
        ledger: new MemoryLedgerStore(),
        contextManager: ctx,
        registry,
      });

      const wrapped = gateway.wrapMCP("filesystem", {
        allowedTools: ["read_file", "write_file"],
        trustLevel: TrustLevel.TOOL,
        maxCallsPerMinute: 60,
        serverName: "filesystem",
      });

      const taskA = ctx.createTask("session-a");
      const taskB = ctx.createTask("session-b");

      await wrapped.onToolCall("read_file", { path: "/a.txt" }, "session-a", taskA.taskId);
      await wrapped.onToolCall("read_file", { path: "/b.txt" }, "session-b", taskB.taskId);

      const ctxA = ctx.getTask(taskA.taskId);
      const ctxB = ctx.getTask(taskB.taskId);

      expect(ctxA!.toolCallCount).toBe(1);
      expect(ctxB!.toolCallCount).toBe(1);
      expect(ctxA!.mcpServersContacted.size).toBe(1);
      expect(ctxB!.mcpServersContacted.size).toBe(1);
    });
  });
});
