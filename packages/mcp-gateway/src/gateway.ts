import { MCPRegistry } from "./registry";
import { OAuthManager } from "./oauth";
import { checkLateralMovement } from "./lateral";
import {
  evaluate,
  tagValue,
  redactSecrets,
  SlidingWindowRateLimiter,
  WardenLogger,
  parseLogLevel,
} from "@wardenlabs/core";
import type {
  PolicyConfig,
  LedgerStore,
  ContextStore,
  PolicyDecision,
  RateLimiterConfig,
} from "@wardenlabs/core";
import { TrustLevel as TL } from "@wardenlabs/core";
import type { ApprovalChannel } from "../../hook-server/src/approvals/types";

export interface WardenGatewayOptions {
  config: PolicyConfig;
  ledger: LedgerStore;
  contextManager: ContextStore;
  registry: MCPRegistry;
  oauth?: OAuthManager;
  approvalChannel?: ApprovalChannel | undefined;
  logger?: WardenLogger;
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
  private contextManager: ContextStore;
  private registry: MCPRegistry;
  private oauth: OAuthManager;
  private approvalChannel: ApprovalChannel | undefined;
  private rateLimiter: SlidingWindowRateLimiter;
  private logger: WardenLogger;

  constructor(options: WardenGatewayOptions) {
    this.config = options.config;
    this.ledger = options.ledger;
    this.contextManager = options.contextManager;
    this.registry = options.registry;
    this.oauth = options.oauth ?? new OAuthManager();
    this.approvalChannel = options.approvalChannel;
    this.logger = options.logger ?? new WardenLogger("mcp-gateway", parseLogLevel(process.env.LOG_LEVEL));

    // Build rate-limiter config from policy config's rateLimits block,
    // falling back to sensible defaults.
    const rateLimits = (options.config as unknown as Record<string, unknown>).rateLimits as
      | { global?: RateLimiterConfig; perTool?: Record<string, { maxCalls: number; windowMs: number }> }
      | undefined;

    this.rateLimiter = new SlidingWindowRateLimiter({
      maxCalls: rateLimits?.global?.maxCalls ?? 1000,
      windowMs: rateLimits?.global?.windowMs ?? 60_000,
      ...(rateLimits?.perTool !== undefined ? { perToolLimits: rateLimits.perTool } : {}),
    });
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

        // Sliding-window rate-limit check (before policy evaluation).
        // Per-tool limits are resolved from the gateway config.
        const rateKey = `tool:${toolName}`;
        const rateCheck = self.rateLimiter.check(rateKey);
        if (!rateCheck.allowed) {
          self.logger.warn("Rate limit exceeded.", {
            serverName,
            toolName,
            retryAfterMs: rateCheck.retryAfterMs,
          });
          return {
            action: "DENY" as const,
            reason: `Rate limit exceeded for ${serverName}/${toolName}. Retry after ${rateCheck.retryAfterMs}ms.`,
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

          self.logger.warn("Lateral movement detected.", {
            taskId: currentTaskId,
            serversContacted: lateralResult.serversContacted,
            maxAllowed: lateralResult.maxAllowed,
            alertAction: lateralResult.alertAction,
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

      checkRateLimit: (key: string) => self.rateLimiter.check(key),
    };
  }

  /** Delegate to the sliding-window rate limiter. */
  checkRateLimit(key: string): { allowed: boolean; retryAfterMs?: number } {
    return this.rateLimiter.check(key);
  }

  getRegistry(): MCPRegistry {
    return this.registry;
  }

  getOAuth(): OAuthManager {
    return this.oauth;
  }
}
