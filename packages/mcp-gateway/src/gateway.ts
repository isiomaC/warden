import { MCPRegistry } from "./registry";
import { OAuthManager } from "./oauth";
import { checkLateralMovement } from "./lateral";
import {
  evaluate,
  tagValue,
  redactSecrets,
} from "@wardenlabs/core";
import type {
  PolicyConfig,
  LedgerStore,
  ContextManager,
  PolicyDecision,
} from "@wardenlabs/core";
import { TrustLevel as TL } from "@wardenlabs/core";
import type { ApprovalChannel } from "../../hook-server/src/approvals/types";

export interface WardenGatewayOptions {
  config: PolicyConfig;
  ledger: LedgerStore;
  contextManager: ContextManager;
  registry: MCPRegistry;
  oauth?: OAuthManager;
  approvalChannel?: ApprovalChannel | undefined;
}

export interface WrappedMCPServer {
  allowedTools: string[];
  trustLevel: (typeof TL)[keyof typeof TL];
  maxCallsPerMinute: number;
  serverName: string;
}

export class WardenGateway {
  private config: PolicyConfig;
  private ledger: LedgerStore;
  private contextManager: ContextManager;
  private registry: MCPRegistry;
  private oauth: OAuthManager;
  private approvalChannel: ApprovalChannel | undefined;
  private callCounters = new Map<string, number[]>();

  constructor(options: WardenGatewayOptions) {
    this.config = options.config;
    this.ledger = options.ledger;
    this.contextManager = options.contextManager;
    this.registry = options.registry;
    this.oauth = options.oauth ?? new OAuthManager();
    this.approvalChannel = options.approvalChannel;
  }

  wrapMCP(serverName: string, options: WrappedMCPServer) {
    this.registry.assertAllowed(serverName);

    const self = this;

    return {
      serverName,
      allowedTools: options.allowedTools,
      trustLevel: options.trustLevel,
      maxCallsPerMinute: options.maxCallsPerMinute,

      async onToolCall(
        toolName: string,
        toolInput: unknown,
        sessionId: string,
        currentTaskId: string,
      ): Promise<PolicyDecision> {
        self.registry.assertAllowed(serverName);

        if (!options.allowedTools.includes(toolName)) {
          return {
            action: "DENY" as const,
            reason: `Tool "${toolName}" not in allowed list for server "${serverName}".`,
          };
        }

        if (!self.checkRateLimit(`${serverName}__${toolName}`, options.maxCallsPerMinute)) {
          return {
            action: "CONFIRM" as const,
            reason: `Rate limit exceeded for ${serverName}/${toolName}.`,
            channel: "stdout" as const,
          };
        }

        const trustedInput = tagValue(toolInput, `mcp__${serverName}__${toolName}`, currentTaskId);

        const lateralResult = checkLateralMovement(
          currentTaskId,
          self.contextManager,
          self.config as PolicyConfig & {
            threatDetection: {
              lateralMovement: {
                enabled: boolean;
                maxMCPServersPerTaskChain: number;
                alertAction: "CONFIRM" | "DENY";
              };
            };
          },
        );

        if (lateralResult.shouldBlock) {
          self.ledger.writeSecurityEvent({
            id: `lateral_${Date.now()}`,
            timestamp: new Date().toISOString(),
            eventType: "LATERAL_MOVEMENT",
            details: {
              taskId: currentTaskId,
              serversContacted: lateralResult.serversContacted,
              maxAllowed: lateralResult.maxAllowed,
            },
          });

          return {
            action: lateralResult.alertAction,
            reason: `Lateral movement detected: ${lateralResult.serversContacted} servers contacted, max ${lateralResult.maxAllowed} allowed.`,
            channel: "stdout" as const,
          };
        }

        const decision = evaluate(self.config, {
          toolName: `${serverName}__${toolName}`,
          toolInput: toolInput as Record<string, unknown>,
          environment: self.config.meta.environment,
          trustSources: [{ source: trustedInput.source, trust: trustedInput.trust }],
          serverInAllowlist: self.registry.isAllowed(serverName),
        });

        self.contextManager.recordToolCall(currentTaskId, serverName);

        self.ledger.write({
          id: `gw_${Date.now()}`,
          previousHash: self.ledger.lastHash(),
          timestamp: new Date().toISOString(),
          sessionId,
          taskId: currentTaskId,
          tool: `${serverName}__${toolName}`,
          toolInput: redactSecrets(toolInput),
          trustLevel: trustedInput.trust,
          trustSource: trustedInput.source,
          policyRulesMatched: [],
          decision: decision.action,
          decisionReason: decision.reason,
          hash: "",
          previousEntryHash: self.ledger.lastHash(),
        });

        if (decision.action === "CONFIRM" && self.approvalChannel) {
          const approved = await self.approvalChannel.request({
            tool: `${serverName}__${toolName}`,
            input: redactSecrets(toolInput),
            reason: decision.reason,
            timeoutMs: 60_000,
          });

          return approved
            ? { action: "ALLOW" as const, reason: "Human approved." }
            : { action: "DENY" as const, reason: "Approval denied or timed out." };
        }

        return decision;
      },

      checkRateLimit: (id: string, max: number) => self.checkRateLimit(id, max),
    };
  }

  checkRateLimit(key: string, maxPerMinute: number): boolean {
    const now = Date.now();
    let timestamps = this.callCounters.get(key) ?? [];
    timestamps = timestamps.filter((t) => now - t < 60_000);
    if (timestamps.length >= maxPerMinute) return false;
    timestamps.push(now);
    this.callCounters.set(key, timestamps);
    return true;
  }

  getRegistry(): MCPRegistry {
    return this.registry;
  }

  getOAuth(): OAuthManager {
    return this.oauth;
  }
}
