interface RuntimeConfig {
  ledger?: {
    type?: "memory" | "sqlite";
    path?: string;
  };
  vault?: {
    tokenTTLSeconds?: number;
    persistence?: boolean;
    path?: string;
  };
}

interface ResolvedRuntimeConfig {
  dbPath?: string;
  tokenTTLSeconds: number;
  persistentVaultPath?: string;
}

interface ProxyEntryConfig {
  name: string;
  transport: "stdio" | "http";
  allowedTools: string[];
  command?: string;
  url?: string;
}

export function resolveRuntimeConfig(
  config: RuntimeConfig,
  cliDbPath?: string,
): ResolvedRuntimeConfig {
  const tokenTTLSeconds = config.vault?.tokenTTLSeconds ?? 3600;
  if (!Number.isInteger(tokenTTLSeconds) || tokenTTLSeconds <= 0) {
    throw new Error("vault.tokenTTLSeconds must be a positive integer.");
  }
  const persistence = config.vault?.persistence ?? false;
  if (typeof persistence !== "boolean") throw new Error("vault.persistence must be a boolean.");
  if (config.vault?.path !== undefined && (typeof config.vault.path !== "string" || config.vault.path.trim() === "")) {
    throw new Error("vault.path must be a non-empty string.");
  }
  if (!persistence && config.vault?.path !== undefined) throw new Error("vault.path requires vault.persistence: true.");
  const persistentVaultPath = persistence ? (config.vault?.path ?? ".warden/vault.enc") : undefined;

  if (cliDbPath) return { dbPath: cliDbPath, tokenTTLSeconds, ...(persistentVaultPath ? { persistentVaultPath } : {}) };
  if (config.ledger?.type === "memory") return { tokenTTLSeconds, ...(persistentVaultPath ? { persistentVaultPath } : {}) };

  return {
    dbPath: config.ledger?.path ?? ".warden/ledger.db",
    tokenTTLSeconds,
    ...(persistentVaultPath ? { persistentVaultPath } : {}),
  };
}

export function validateProxyEntries(entries: ProxyEntryConfig[]): string[] {
  const errors: string[] = [];
  for (const entry of entries) {
    if (entry.transport === "stdio" && !entry.command) {
      errors.push(`MCP server "${entry.name}" uses stdio but has no command.`);
    }
    if (entry.transport === "http" && !entry.url) {
      errors.push(`MCP server "${entry.name}" uses HTTP but has no url.`);
    }
    if (!Array.isArray(entry.allowedTools) || entry.allowedTools.length === 0) {
      errors.push(`MCP server "${entry.name}" must declare at least one allowed tool.`);
    }
  }
  return errors;
}

export type { RuntimeConfig, ResolvedRuntimeConfig, ProxyEntryConfig };
