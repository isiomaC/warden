import { sha256 } from "./hash";
import { generateId } from "./id";
import type { LedgerStore } from "./ledger";
import { SecurityError } from "./errors";

export interface ToolPin {
  serverName: string;
  toolName: string;
  descriptionHash: string;
  pinnedAt: string;
  schemaHash: string;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export async function pinToolDescriptions(
  serverName: string,
  tools: MCPTool[],
  loadPins: (serverName: string) => Promise<Record<string, ToolPin>>,
  savePins: (serverName: string, pins: Record<string, ToolPin>) => Promise<void>,
  ledger?: LedgerStore,
): Promise<void> {
  const existing = await loadPins(serverName);

  for (const tool of tools) {
    const descHash = sha256(JSON.stringify(tool.description ?? ""));
    const schemaHash = sha256(JSON.stringify(tool.inputSchema ?? {}));
    const key = `${serverName}__${tool.name}`;

    if (existing[key]) {
      const oldHash = existing[key].descriptionHash;
      if (oldHash !== descHash) {
        if (ledger) {
          ledger.writeSecurityEvent({
            id: generateId("rugpull"),
            timestamp: new Date().toISOString(),
            eventType: "RUG_PULL_DETECTED",
            details: {
              server: serverName,
              tool: tool.name,
              previousHash: oldHash,
              newHash: descHash,
            },
          });
        }
        throw new SecurityError(
          `RUG PULL DETECTED: Tool description for ${key} changed silently. ` +
            `Previous hash: ${oldHash}. New hash: ${descHash}. Session quarantined.`,
          "RUG_PULL",
        );
      }
    } else {
      existing[key] = {
        serverName,
        toolName: tool.name,
        descriptionHash: descHash,
        pinnedAt: new Date().toISOString(),
        schemaHash,
      };
    }
  }

  await savePins(serverName, existing);
}

export function verifyToolPin(
  serverName: string,
  tool: MCPTool,
  pins: Record<string, ToolPin>,
): void {
  const key = `${serverName}__${tool.name}`;
  const pin = pins[key];
  if (!pin) return;

  const descHash = sha256(JSON.stringify(tool.description ?? ""));
  if (pin.descriptionHash !== descHash) {
    throw new SecurityError(
      `Tool description mismatch for ${key}. Pinned: ${pin.descriptionHash}, current: ${descHash}`,
      "RUG_PULL",
    );
  }
}
