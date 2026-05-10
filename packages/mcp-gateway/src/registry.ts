import { SecurityError } from "@wardenlabs/core";

export interface ServerEntry {
  name: string;
  type: "local" | "remote";
  transport: "stdio" | "http";
  allowedTools: string[];
  allowedPaths?: string[];
  authRequired: boolean;
}

export class MCPRegistry {
  private servers = new Map<string, ServerEntry>();

  constructor(allowedServers: ServerEntry[]) {
    for (const server of allowedServers) {
      this.servers.set(server.name, server);
    }
  }

  isAllowed(serverName: string): boolean {
    return this.servers.has(serverName);
  }

  getAllowed(serverName: string): ServerEntry | undefined {
    return this.servers.get(serverName);
  }

  assertAllowed(serverName: string): void {
    if (!this.isAllowed(serverName)) {
      throw new SecurityError(
        `Shadow MCP server blocked: "${serverName}" is not in the allowed server list. ` +
          `Add it to warden.config.yml mcpServers.allowed to permit.`,
        "SHADOW_MCP",
      );
    }
  }

  listServers(): ServerEntry[] {
    return [...this.servers.values()];
  }
}
