import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FileConfigSource, MemoryLedgerStore, SqliteLedgerStore, ContextManager, TrustLevel } from "@stlw/warden";
import { WardenGateway, MCPRegistry } from "@stlw/warden-mcp-gateway";
import { TelegramApprovalChannel } from "@stlw/warden-hook-server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { resolveRuntimeConfig, validateProxyEntries } from "../runtime-config";
import type { RuntimeConfig } from "../runtime-config";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

interface RawServerEntry {
  name: string;
  type: "local" | "remote";
  transport: "stdio" | "http";
  allowedTools: string[];
  allowedPaths?: string[];
  authRequired: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

interface RawConfig extends RuntimeConfig {
  mcpServers?: {
    allowed?: RawServerEntry[];
  };
  approvalChannels?: {
    telegram?: { botToken?: string; chatId?: string };
  };
}

function resolveEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
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

    const entryErrors = validateProxyEntries(serverEntries);
    if (entryErrors.length > 0) {
      throw new Error(entryErrors.join("\n"));
    }

    const runtime = resolveRuntimeConfig(rawConfig);
    if (runtime.dbPath) mkdirSync(dirname(resolve(runtime.dbPath)), { recursive: true });
    const ledger = runtime.dbPath
      ? new SqliteLedgerStore(resolve(runtime.dbPath))
      : new MemoryLedgerStore();

    const telegram = rawConfig.approvalChannels?.telegram;
    const botToken = telegram?.botToken ? resolveEnv(telegram.botToken) : "";
    const chatId = telegram?.chatId ? resolveEnv(telegram.chatId) : "";
    const approvalChannel = botToken && chatId
      ? new TelegramApprovalChannel(botToken, chatId)
      : undefined;

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
      ledger,
      contextManager: new ContextManager(),
      registry,
      ...(approvalChannel ? { approvalChannel } : {}),
    });

    // Build per-server wrapped instances and a flat tool → server lookup map
    type ToolEntry = { serverName: string; toolName: string };
    const toolMap = new Map<string, ToolEntry>();
    const clients = new Map<string, Client>();
    const allTools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];

    for (const entry of serverEntries) {
      const client = new Client({ name: `warden-proxy-${entry.name}`, version: "0.2.0" });
      if (entry.transport === "stdio") {
        if (!entry.command) {
          throw new Error(`MCP server "${entry.name}" uses stdio but has no command.`);
        }
        await client.connect(new StdioClientTransport({
          command: entry.command,
          ...(entry.args ? { args: entry.args } : {}),
          ...(entry.env ? { env: entry.env } : {}),
          ...(entry.cwd ? { cwd: entry.cwd } : {}),
          stderr: "inherit",
        }));
      } else {
        if (!entry.url) {
          throw new Error(`MCP server "${entry.name}" uses HTTP but has no url.`);
        }
        const httpTransport = new StreamableHTTPClientTransport(
          new URL(entry.url),
          entry.headers ? { requestInit: { headers: entry.headers } } : undefined,
        );
        // SDK 1.29's StreamableHTTP transport declaration is not exact-optional
        // compatible with its own shared Transport declaration under this repo's
        // strict TypeScript settings, although the runtime contract is identical.
        await client.connect(httpTransport as Transport);
      }
      clients.set(entry.name, client);

      const upstreamTools = await client.listTools();
      const wrapped = gateway.wrapMCP(entry.name, {
        serverName: entry.name,
        allowedTools: entry.allowedTools,
        trustLevel: TrustLevel.TOOL,
        maxCallsPerMinute: 300,
      });

      for (const tool of upstreamTools.tools.filter((candidate) => wrapped.allowedTools.includes(candidate.name))) {
        const toolName = tool.name;
        const qualifiedName = `${entry.name}__${toolName}`;
        toolMap.set(qualifiedName, { serverName: entry.name, toolName });
        allTools.push({
          name: qualifiedName,
          description: `[${entry.name}] ${tool.description ?? toolName} — enforced by Warden`,
          inputSchema: tool.inputSchema,
        });
      }
    }

    const mcpServer = new Server(
      { name: "warden-proxy", version: "0.2.0" },
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
        const client = clients.get(entry.serverName);
        if (!client) throw new Error(`No upstream client for ${entry.serverName}.`);
        return await client.callTool({
          name: entry.toolName,
          arguments: request.params.arguments ?? {},
        });
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
