import { describe, expect, it } from "vitest";
import { MemoryLedgerStore, ContextManager, TrustLevel, type PolicyConfig } from "@stlw/warden";
import { WardenGateway } from "../src/gateway";
import { MCPRegistry } from "../src/registry";
import { ApprovalGrantStore } from "../src/approval-grants";

const config: PolicyConfig = {
  version: "2",
  meta: { environment: "development", sessionApprovalRequired: false },
  policies: [
    {
      id: "allow-canonical-read",
      description: "Expose safe file reads",
      match: { tools: ["mcp.filesystem.read_file"], environment: ["development"] },
      action: "ALLOW",
    },
    {
      id: "confirm-canonical-write",
      description: "Approve file writes",
      match: { tools: ["mcp.filesystem.write_file"], environment: ["development"] },
      action: "CONFIRM",
    },
  ],
  threatDetection: {
    lateralMovement: {
      enabled: false,
      maxMCPServersPerTaskChain: 10,
      alertAction: "DENY",
    },
  },
} as PolicyConfig;

function gateway() {
  return new WardenGateway({
    config,
    ledger: new MemoryLedgerStore(),
    contextManager: new ContextManager(),
    registry: new MCPRegistry([
      {
        name: "filesystem",
        type: "local",
        transport: "stdio",
        allowedTools: ["read_file", "write_file"],
        authRequired: false,
      },
    ]),
  });
}

describe("MCP discovery and approval grants", () => {
  it("uses a stable server-qualified canonical action ID", () => {
    const registry = new MCPRegistry([
      { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
    ]);

    expect(registry.canonicalAction("filesystem", "read_file")).toBe("mcp.filesystem.read_file");
  });

  it("only exposes registry-allowed tools with an ALLOW discovery decision", () => {
    const visible = gateway().listTools("filesystem", [
      { name: "read_file", description: "Read a file" },
      { name: "write_file", description: "Write a file" },
      { name: "delete_file", description: "Delete a file" },
    ]);

    expect(visible).toEqual([{ name: "read_file", description: "Read a file" }]);
  });

  it("honours legacy policy action IDs while recording canonical action IDs", async () => {
    const context = new ContextManager();
    const task = context.createTask("session-1");
    const ledger = new MemoryLedgerStore();
    const legacyGateway = new WardenGateway({
      config: {
        ...config,
        policies: [{
          id: "legacy-read",
          description: "Existing configuration",
          match: { tools: ["filesystem__read_file"], environment: ["development"] },
          action: "ALLOW",
        }],
      },
      ledger,
      contextManager: context,
      registry: new MCPRegistry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["read_file"], authRequired: false },
      ]),
    });
    const wrapped = legacyGateway.wrapMCP("filesystem", {
      allowedTools: ["read_file"],
      trustLevel: TrustLevel.TOOL,
      maxCallsPerMinute: 5,
      serverName: "filesystem",
    });

    await expect(wrapped.onToolCall("read_file", {}, "session-1", task.taskId)).resolves.toMatchObject({ action: "ALLOW" });
    expect(ledger.getEntries()[0]?.tool).toBe("mcp.filesystem.read_file");
  });

  it("consumes a grant once and only for its exact scope", () => {
    const grants = new ApprovalGrantStore(() => new Date("2026-09-25T12:00:00.000Z"));
    const grant = grants.issue({
      sessionId: "session-1",
      taskId: "task-1",
      canonicalAction: "mcp.filesystem.write_file",
      input: { path: "/tmp/report.txt", content: "hello" },
      expiresInMs: 60_000,
    });

    expect(grants.consume(grant.id, {
      sessionId: "session-1",
      taskId: "task-1",
      canonicalAction: "mcp.filesystem.write_file",
      input: { content: "hello", path: "/tmp/report.txt" },
    })).toBe(true);
    expect(grants.consume(grant.id, {
      sessionId: "session-1",
      taskId: "task-1",
      canonicalAction: "mcp.filesystem.write_file",
      input: { path: "/tmp/report.txt", content: "hello" },
    })).toBe(false);
  });

  it("does not accept a grant for another task or changed input", () => {
    const grants = new ApprovalGrantStore(() => new Date("2026-09-25T12:00:00.000Z"));
    const grant = grants.issue({
      sessionId: "session-1",
      taskId: "task-1",
      canonicalAction: "mcp.filesystem.write_file",
      input: { path: "/tmp/report.txt", content: "hello" },
      expiresInMs: 60_000,
    });

    expect(grants.consume(grant.id, {
      sessionId: "session-1",
      taskId: "task-2",
      canonicalAction: "mcp.filesystem.write_file",
      input: { path: "/tmp/report.txt", content: "hello" },
    })).toBe(false);
    expect(grants.consume(grant.id, {
      sessionId: "session-1",
      taskId: "task-1",
      canonicalAction: "mcp.filesystem.write_file",
      input: { path: "/tmp/report.txt", content: "changed" },
    })).toBe(false);
  });

  it("allows a confirmed call once when presented with a matching approval grant", async () => {
    const context = new ContextManager();
    const task = context.createTask("session-1");
    let approvals = 0;
    const securedGateway = new WardenGateway({
      config,
      ledger: new MemoryLedgerStore(),
      contextManager: context,
      registry: new MCPRegistry([
        { name: "filesystem", type: "local", transport: "stdio", allowedTools: ["write_file"], authRequired: false },
      ]),
      approvalChannel: {
        request: async () => (++approvals === 1),
      },
    });
    const wrapped = securedGateway.wrapMCP("filesystem", {
      allowedTools: ["write_file"],
      trustLevel: TrustLevel.TOOL,
      maxCallsPerMinute: 5,
      serverName: "filesystem",
    });
    const input = { path: "/tmp/report.txt", content: "hello" };
    const grant = await securedGateway.requestApprovalGrant({
      sessionId: "session-1",
      taskId: task.taskId,
      serverName: "filesystem",
      toolName: "write_file",
      toolInput: input,
    });

    await expect(wrapped.onToolCall("write_file", input, "session-1", task.taskId, grant?.id))
      .resolves.toMatchObject({ action: "ALLOW" });
    await expect(wrapped.onToolCall("write_file", input, "session-1", task.taskId, grant?.id))
      .resolves.toMatchObject({ action: "DENY" });
  });
});
