import { Hono } from "hono";
import { MemoryLedgerStore, LocalVault, ContextManager } from "@wardenlabs/core";
import type {
  PolicyConfig,
  LedgerStore,
  VaultAdapter,
} from "@wardenlabs/core";
import { authMiddleware } from "./middleware/auth";
import { failClosedMiddleware } from "./middleware/fail-closed";
import { handleSessionEnd } from "./handlers/session-end";
import { handlePreToolUse } from "./handlers/pre-tool-use";
import { handlePostToolUse } from "./handlers/post-tool-use";
import { handlePromptSubmit } from "./handlers/prompt-submit";
import { handleConfigChange } from "./handlers/config-change";
import { StdoutApprovalChannel } from "./approvals/types";
import type { ApprovalChannel } from "./approvals/types";

export interface HookServerOptions {
  config: PolicyConfig;
  vault?: VaultAdapter;
  ledger?: LedgerStore;
  contextManager?: ContextManager;
  approvalChannel?: ApprovalChannel;
  port?: number;
}

export function createHookServer(options: HookServerOptions) {
  const vault = options.vault ?? new LocalVault();
  const ledger = options.ledger ?? new MemoryLedgerStore();
  const contextManager = options.contextManager ?? new ContextManager();
  const approvalChannel =
    options.approvalChannel ?? new StdoutApprovalChannel();

  const app = new Hono();

  app.use("*", failClosedMiddleware());

  // Session-start is the bootstrap endpoint — no auth required
  app.post("/hooks/session-start", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const sessionId = body.session_id ?? "default";
    const taskId = contextManager.createTask(sessionId).taskId;

    const token = vault.mintToken({
      taskId,
      sessionId,
      allowedTools: body.allowedTools ?? ["*"],
      environment: body.environment ?? "development",
      ttlSeconds: 3600,
    });

    return c.json({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        permissionDecision: "allow",
        permissionDecisionReason: "Warden session initialized.",
        sessionToken: token.tokenId,
        taskId,
      },
    });
  });

  const authed = new Hono();
  authed.use("*", authMiddleware(vault));

  authed.post("/hooks/session-end", handleSessionEnd(vault, contextManager, ledger));
  authed.post(
    "/hooks/pre-tool-use",
    handlePreToolUse(options.config, ledger, contextManager, approvalChannel),
  );
  authed.post("/hooks/post-tool-use", handlePostToolUse(ledger, contextManager));
  authed.post("/hooks/prompt-submit", handlePromptSubmit(ledger));
  authed.post("/hooks/config-change", handleConfigChange(ledger));

  app.route("/", authed);

  return {
    app,
    vault,
    ledger,
    contextManager,
    fetch: app.fetch,
  };
}

export function startHookServer(options: HookServerOptions) {
  const { fetch } = createHookServer(options);
  const port = options.port ?? 7429;

  const bun = (globalThis as unknown as { Bun?: { serve: (opts: { port: number; fetch: typeof fetch }) => unknown } }).Bun;
  const server = bun
    ? bun.serve({ port, fetch })
    : { port, fetch, stop: () => {} };

  return server;
}
