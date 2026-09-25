import { MCPRegistry } from "./registry.js";
import { ApprovalGrantStore, type ApprovalGrant } from "./approval-grants.js";
export { MCPRegistry } from "./registry.js";
export { OAuthManager } from "./oauth.js";
import { OAuthManager } from "./oauth.js";
import { checkLateralMovement } from "./lateral.js";
import {
  evaluatePolicies,
  resolveConflicts,
  tagValue,
  redactSecrets,
  extractPaths,
  isPathAllowed,
  SlidingWindowRateLimiter,
  WardenLogger,
  parseLogLevel,
  generateId,
} from "@stlw/warden";
import type {
  PolicyConfig,
  LedgerStore,
  ContextStore,
  PolicyDecision,
  RateLimiterConfig,
} from "@stlw/warden";
import { TrustLevel as TL } from "@stlw/warden";
import type { ApprovalChannel } from "@stlw/warden-hook-server";

export interface WardenGatewayOptions {
  config: PolicyConfig;
  ledger: LedgerStore;
  contextManager: ContextStore;
  registry: MCPRegistry;
  oauth?: OAuthManager;
  approvalChannel?: ApprovalChannel | undefined;
  approvalGrants?: ApprovalGrantStore;
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
  private approvalGrants: ApprovalGrantStore;
  private rateLimiter: SlidingWindowRateLimiter;
  private logger: WardenLogger;

  constructor(options: WardenGatewayOptions) {
    this.config = options.config;
    this.ledger = options.ledger;
    this.contextManager = options.contextManager;
    this.registry = options.registry;
    this.oauth = options.oauth ?? new OAuthManager();
    this.approvalChannel = options.approvalChannel;
    this.approvalGrants = options.approvalGrants ?? new ApprovalGrantStore();
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
      listTools<T extends { name: string }>(tools: T[]): T[] {
        return self.listTools(serverName, tools, options.trustLevel);
      },

      async onToolCall(
        toolName: string,
        toolInput: unknown,
        sessionId: string,
        currentTaskId: string,
        approvalGrantId?: string,
      ): Promise<PolicyDecision> {
        self.registry.assertAllowed(serverName);

        if (!options.allowedTools.includes(toolName) || !self.registry.isToolAllowed(serverName, toolName)) {
          return {
            action: "DENY" as const,
            reason: `Tool "${toolName}" not in allowed list for server "${serverName}".`,
          };
        }

        const serverEntry = self.registry.getAllowed(serverName);

        // Path allowlist enforcement — reject if tool input references a path outside allowedPaths
        if (serverEntry?.allowedPaths && serverEntry.allowedPaths.length > 0) {
          const paths = extractPaths(toolInput);
          const denied = paths.filter((p) => !isPathAllowed(p, serverEntry.allowedPaths!));
          if (denied.length > 0) {
            return {
              action: "DENY" as const,
              reason: `Path not in allowedPaths for "${serverName}": ${denied.join(", ")}`,
            };
          }
        }

        if (serverEntry?.authRequired && !self.oauth.hasValidToken(serverName)) {
          self.logger.warn("Tool call denied — no valid OAuth token for server.", {
            serverName,
            toolName,
          });
          return {
            action: "DENY" as const,
            reason: `Server "${serverName}" requires OAuth authorization, but no valid token is present. Call oauth.storeToken("${serverName}", ...) first.`,
          };
        }

        // Sliding-window rate-limit check (before policy evaluation).
        // Per-tool limits are resolved from the gateway config.
        const canonicalAction = self.registry.canonicalAction(serverName, toolName);
        const rateKey = `tool:${canonicalAction}`;
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
            id: generateId("lateral"),
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

        const decision = self.evaluateAction(
          serverName,
          toolName,
          toolInput as Record<string, unknown>,
          trustedInput.source,
          trustedInput.trust,
        );

        self.contextManager.recordToolCall(currentTaskId, serverName);

        self.ledger.write({
          id: generateId("gw"),
          previousHash: self.ledger.lastHash(),
          timestamp: new Date().toISOString(),
          sessionId,
          taskId: currentTaskId,
          tool: canonicalAction,
          toolInput: redactSecrets(toolInput),
          trustLevel: trustedInput.trust,
          trustSource: trustedInput.source,
          policyRulesMatched: [],
          decision: decision.action,
          decisionReason: decision.reason,
          hash: "",
          previousEntryHash: self.ledger.lastHash(),
        });

        if (decision.action === "CONFIRM" && self.approvalGrants.consume(approvalGrantId, {
          sessionId,
          taskId: currentTaskId,
          canonicalAction,
          input: toolInput as Record<string, unknown>,
        })) {
          return { action: "ALLOW" as const, reason: "Approval grant accepted." };
        }

        if (decision.action === "CONFIRM" && self.approvalChannel) {
          const approved = await self.approvalChannel.request({
            tool: canonicalAction,
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

  listTools<T extends { name: string }>(
    serverName: string,
    tools: T[],
    trustLevel: (typeof TL)[keyof typeof TL] = TL.TOOL,
  ): T[] {
    this.registry.assertAllowed(serverName);
    return tools.filter((tool) => this.registry.isToolAllowed(serverName, tool.name) && this.evaluateAction(
      serverName,
      tool.name,
      {},
      `mcp__${serverName}__${tool.name}`,
      trustLevel,
    ).action === "ALLOW");
  }

  async requestApprovalGrant(request: {
    sessionId: string;
    taskId: string;
    serverName: string;
    toolName: string;
    toolInput: Record<string, unknown>;
  }): Promise<ApprovalGrant | undefined> {
    this.registry.assertAllowed(request.serverName);
    if (!this.registry.isToolAllowed(request.serverName, request.toolName)) return undefined;
    const canonicalAction = this.registry.canonicalAction(request.serverName, request.toolName);
    const decision = this.evaluateAction(
      request.serverName,
      request.toolName,
      request.toolInput,
      `mcp__${request.serverName}__${request.toolName}`,
      TL.TOOL,
    );
    if (decision.action !== "CONFIRM" || !this.approvalChannel) return undefined;
    const approved = await this.approvalChannel.request({
      tool: canonicalAction,
      input: redactSecrets(request.toolInput),
      reason: decision.reason,
      timeoutMs: 60_000,
    });
    if (!approved) return undefined;
    return this.approvalGrants.issue({
      sessionId: request.sessionId,
      taskId: request.taskId,
      canonicalAction,
      input: request.toolInput,
    });
  }

  private evaluateAction(
    serverName: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    trustSource: string,
    trustLevel: (typeof TL)[keyof typeof TL],
  ): PolicyDecision {
    const canonicalAction = this.registry.canonicalAction(serverName, toolName);
    const legacyAction = `${serverName}__${toolName}`;
    const buildInput = (action: string) => ({
      toolName: action,
      toolInput,
      environment: this.config.meta.environment,
      trustSources: [{ source: trustSource, trust: trustLevel }],
      serverInAllowlist: true,
    });
    return resolveConflicts([
      ...evaluatePolicies(this.config, buildInput(canonicalAction)),
      ...evaluatePolicies(this.config, buildInput(legacyAction)),
    ]);
  }
}
