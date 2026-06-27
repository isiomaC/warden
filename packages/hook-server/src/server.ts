import { Hono } from "hono";
import {
  MemoryLedgerStore,
  SqliteLedgerStore,
  LocalVault,
  ContextManager,
  TrustRegistry,
  WardenLogger,
  LogLevel,
  parseLogLevel,
} from "@warden/core";
import type {
  PolicyConfig,
  LedgerStore,
  VaultAdapter,
  ContextStore,
} from "@warden/core";
import { authMiddleware } from "./middleware/auth";
import { failClosedMiddleware } from "./middleware/fail-closed";
import { handleSessionStart } from "./handlers/session-start";
import { handleSessionEnd } from "./handlers/session-end";
import { handlePreToolUse } from "./handlers/pre-tool-use";
import { handlePostToolUse } from "./handlers/post-tool-use";
import { handlePromptSubmit } from "./handlers/prompt-submit";
import { handleConfigChange } from "./handlers/config-change";
import { StdoutApprovalChannel } from "./approvals/index";
import type { ApprovalChannel } from "./approvals/index";

export interface HookServerOptions {
  config: PolicyConfig;
  vault?: VaultAdapter;
  ledger?: LedgerStore;
  contextManager?: ContextStore;
  approvalChannel?: ApprovalChannel;
  port?: number;
  dbPath?: string;
  tokenTTLSeconds?: number;
  logLevel?: LogLevel;
}

export function createHookServer(options: HookServerOptions) {
  const vault = options.vault ?? new LocalVault();
  const ledger = options.ledger ?? (options.dbPath
    ? new SqliteLedgerStore(options.dbPath)
    : new MemoryLedgerStore());
  const contextManager = options.contextManager ?? new ContextManager();
  const approvalChannel =
    options.approvalChannel ?? new StdoutApprovalChannel();
  const trustRegistry = new TrustRegistry();
  const ttlSeconds = options.tokenTTLSeconds ?? 3600;
  const startTime = Date.now();

  const logLevel = options.logLevel ?? parseLogLevel(process.env.LOG_LEVEL);
  const logger = new WardenLogger("hook-server", logLevel);

  logger.info("Warden hook server initializing.", {
    port: options.port ?? 7429,
    logLevel: LogLevel[logLevel],
    dbPath: options.dbPath ?? "memory",
    approvalChannel: approvalChannel.constructor.name,
  });

  const app = new Hono();

  // Health and metrics endpoints (no auth required)
  app.get("/health", (c) => {
    const entries = ledger.getEntries();
    const chainResult = ledger.verifyChain();
    const activeTaskList = contextManager.listActiveTasks?.() ?? [];
    const activeSessions = new Set(activeTaskList.map((t) => t.sessionId)).size;

    return c.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      chainValid: chainResult.valid,
      ledgerEntries: entries.length,
      activeSessions,
      activeTasks: activeTaskList.length,
    });
  });

  app.get("/metrics", (c) => {
    const entries = ledger.getEntries();
    const events = ledger.getEvents();
    const chainResult = ledger.verifyChain();
    const tokenCount = vault.tokenCount?.() ?? 0;
    const revoked = vault.revokedCount?.() ?? 0;

    return c.json({
      decisions: {
        ALLOW: entries.filter((e) => e.decision === "ALLOW").length,
        DENY: entries.filter((e) => e.decision === "DENY").length,
        CONFIRM: entries.filter((e) => e.decision === "CONFIRM").length,
        QUARANTINE: entries.filter((e) => e.decision === "QUARANTINE").length,
      },
      securityEvents: events.length,
      chainValid: chainResult.valid,
      vault: {
        activeTokens: tokenCount - revoked,
        revokedTokens: revoked,
      },
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  app.use("*", failClosedMiddleware(logger));

  app.post("/hooks/session-start", handleSessionStart(options.config, vault, ledger, contextManager, ttlSeconds));

  const authed = new Hono();
  authed.use("*", authMiddleware(vault));

  authed.post("/hooks/session-end", handleSessionEnd(vault, contextManager, ledger));
  authed.post(
    "/hooks/pre-tool-use",
    handlePreToolUse(options.config, ledger, contextManager, trustRegistry, approvalChannel),
  );
  authed.post("/hooks/post-tool-use", handlePostToolUse(ledger, contextManager, trustRegistry));
  authed.post("/hooks/prompt-submit", handlePromptSubmit(ledger));
  authed.post("/hooks/config-change", handleConfigChange(ledger));

  app.route("/", authed);

  return {
    app,
    vault,
    ledger,
    contextManager,
    trustRegistry,
    logger,
    fetch: app.fetch,
  };
}

export function startHookServer(options: HookServerOptions) {
  const { fetch, logger } = createHookServer(options);
  const port = options.port ?? 7429;

  const bun = (globalThis as unknown as { Bun?: { serve: (opts: { port: number; fetch: typeof fetch }) => unknown } }).Bun;
  const server = bun
    ? bun.serve({ port, fetch })
    : { port, fetch, stop: () => {} };

  logger.info("Hook server listening.", { port });

  return server;
}
