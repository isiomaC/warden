import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FileConfigSource, MemoryLedgerStore, ContextManager, TrustLevel } from "@warden/core";
import { WardenGateway, MCPRegistry } from "@warden/mcp-gateway";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

interface RawServerEntry {
  name: string;
  type: "local" | "remote";
  transport: "stdio" | "http";
  allowedTools: string[];
  allowedPaths?: string[];
  authRequired: boolean;
}

interface RawConfig {
  mcpServers?: {
    allowed?: RawServerEntry[];
  };
}

export const proxyCommand = defineCommand({
  meta: {
    name: "proxy",
    description: "Start Warden as a stdio MCP server — enforces policy for Cursor, Windsurf, and other MCP-only agents",
  },
  args: {
    config: {
      type: "string",
      description: "Path to warden.config.yml",
      default: "warden.config.yml",
    },
  },
  async run({ args }) {
    const configPath = resolve(args.config);

    if (!existsSync(configPath)) {
      process.stderr.write(`Config file not found: ${configPath}\n`);
      process.stderr.write("Run 'warden init' first to create a config.\n");
      process.exit(1);
    }

    const configSource = new FileConfigSource(configPath);
    const config = await configSource.load();
    const rawConfig = config as unknown as RawConfig;
    const serverEntries: RawServerEntry[] = rawConfig.mcpServers?.allowed ?? [];

    if (serverEntries.length === 0) {
      process.stderr.write("No mcpServers.allowed entries in warden.config.yml.\n");
      process.stderr.write("Add servers under mcpServers.allowed to expose them via the proxy.\n");
      process.exit(1);
    }

    const registry = new MCPRegistry(
      serverEntries.map((s) => ({
        name: s.name,
        type: s.type,
        transport: s.transport,
        allowedTools: s.allowedTools,
        ...(s.allowedPaths !== undefined ? { allowedPaths: s.allowedPaths } : {}),
        authRequired: s.authRequired,
      })),
    );

    const gateway = new WardenGateway({
      config,
      ledger: new MemoryLedgerStore(),
      contextManager: new ContextManager(),
      registry,
    });

    // Build per-server wrapped instances and a flat tool → server lookup map
    type ToolEntry = { serverName: string; toolName: string };
    const toolMap = new Map<string, ToolEntry>();
    const allTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];

    for (const entry of serverEntries) {
      const wrapped = gateway.wrapMCP(entry.name, {
        serverName: entry.name,
        allowedTools: entry.allowedTools,
        trustLevel: TrustLevel.TOOL,
        maxCallsPerMinute: 300,
      });

      for (const toolName of wrapped.allowedTools) {
        const qualifiedName = `${entry.name}__${toolName}`;
        toolMap.set(qualifiedName, { serverName: entry.name, toolName });
        allTools.push({
          name: qualifiedName,
          description: `[${entry.name}] ${toolName} — enforced by Warden`,
          inputSchema: { type: "object" },
        });
      }
    }

    const mcpServer = new Server(
      { name: "warden-proxy", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: allTools,
    }));

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const entry = toolMap.get(request.params.name);
      if (!entry) {
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }],
          isError: true,
        };
      }

      const wrappedServer = gateway.wrapMCP(entry.serverName, {
        serverName: entry.serverName,
        allowedTools: serverEntries.find((s) => s.name === entry.serverName)?.allowedTools ?? [],
        trustLevel: TrustLevel.TOOL,
        maxCallsPerMinute: 300,
      });

      const decision = await wrappedServer.onToolCall(
        entry.toolName,
        request.params.arguments ?? {},
        "proxy-session",
        "proxy-task",
      );

      if (decision.action === "ALLOW") {
        return {
          content: [{
            type: "text" as const,
            text: `Warden ALLOW: ${decision.reason}. Forward this call to your real MCP server.`,
          }],
        };
      }

      return {
        content: [{ type: "text" as const, text: `Warden ${decision.action}: ${decision.reason}` }],
        isError: true,
      };
    });

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
  },
});
