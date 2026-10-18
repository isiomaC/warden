import type { Context } from "hono";
import { readFileSync } from "node:fs";
import {
  sha256,
  checkSupplyChain,
  parseLockDeps,
  TrustLevel,
  generateId,
} from "@stlw/warden";
import type {
  PolicyConfig,
  VaultAdapter,
  LedgerStore,
  ContextStore,
  PackagePin,
} from "@stlw/warden";
import type { ApprovalChannel } from "../approvals/types.js";

const VALID_ENVIRONMENTS = ["development", "staging", "production"];

function loadPins(pinsPath: string): Record<string, PackagePin> {
  try {
    const raw = readFileSync(pinsPath, "utf-8");
    return JSON.parse(raw) as Record<string, PackagePin>;
  } catch {
    return {};
  }
}

function readLockDeps() {
  const lockPath = `${process.cwd()}/package-lock.json`;
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const lockJson = JSON.parse(raw) as Record<
      string,
      Record<string, { version?: string; integrity?: string }>
    >;
    const packages = lockJson.packages ?? {};
    const filtered: Record<string, { version: string; integrity: string }> = {};
    for (const [key, info] of Object.entries(packages)) {
      if (!key) continue;
      if (!info.version || !info.integrity) continue;
      filtered[key] = {
        version: info.version,
        integrity: info.integrity,
      };
    }
    return parseLockDeps(filtered);
  } catch {
    return [];
  }
}

export function handleSessionStart(
  config: PolicyConfig,
  vault: VaultAdapter,
  ledger: LedgerStore,
  contextManager: ContextStore,
  ttlSeconds: number,
  pinsPath: string = `${process.cwd()}/.warden/pins.json`,
  approvalChannel?: ApprovalChannel,
) {
  return async (c: Context) => {
    const body = await c.req.json().catch(() => undefined);
    const deny = (reason: string, status: 200 | 400 = 200) => c.json({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }, status);

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return deny("Warden: Session start requires a valid JSON object.", 400);
    }

    const input = body as Record<string, unknown>;
    const sessionId = input.session_id;
    const allowedToolsInput = input.allowedTools;
    const allowedPathsInput = input.allowedPaths;
    const environment = input.environment ?? "development";

    if (typeof sessionId !== "string" || sessionId.trim() === "") {
      return deny("Warden: session_id must be a non-empty string.", 400);
    }

    if (!Array.isArray(allowedToolsInput) || allowedToolsInput.length === 0 ||
        !allowedToolsInput.every((tool) => typeof tool === "string" && tool.trim() !== "")) {
      return c.json({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          permissionDecision: "deny",
          permissionDecisionReason: "Warden: allowedTools must be a non-empty array.",
        },
      }, 400);
    }

    if (allowedPathsInput !== undefined &&
        (!Array.isArray(allowedPathsInput) || !allowedPathsInput.every((path) => typeof path === "string" && path.trim() !== ""))) {
      return deny("Warden: allowedPaths must be an array of non-empty strings.", 400);
    }

    const allowedTools = allowedToolsInput as string[];
    const allowedPaths = allowedPathsInput as string[] | undefined;

    if (typeof environment !== "string") {
      return deny("Warden: environment must be a string.", 400);
    }

    if (!VALID_ENVIRONMENTS.includes(environment)) {
      return deny(`Warden: invalid environment "${environment}". Must be one of: ${VALID_ENVIRONMENTS.join(", ")}.`, 400);
    }

    // Supply-chain check — only if pins are configured
    const pinned = loadPins(pinsPath);
    if (Object.keys(pinned).length > 0) {
      const deps = readLockDeps();
      const report = checkSupplyChain(deps, pinned);
      if (!report.clean) {
        const details = report.violations
          .map(
            (v) =>
              `[${v.type}] ${v.package}${
                v.pinned ? ` (pinned: ${v.pinned}, current: ${v.current})` : ` (${v.version})`
              }`,
          )
          .join("; ");

        return c.json({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            permissionDecision: "deny",
            permissionDecisionReason:
              `Warden: Supply chain violations detected. ${details}. Run 'warden supply-chain --baseline'.`,
          },
        });
      }
    }

    // Session approval gate — if config requires it and a channel is configured
    if (config.meta.sessionApprovalRequired && approvalChannel) {
      const approved = await approvalChannel.request({
        tool: "session-start",
        input: { sessionId, allowedTools, environment },
        reason: "Session approval required by warden.config.yml (meta.sessionApprovalRequired: true)",
        timeoutMs: 60_000,
      });
      if (!approved) {
        return c.json({
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            permissionDecision: "deny",
            permissionDecisionReason: "Warden: Session denied by approval channel.",
          },
        });
      }
    }

    const taskContext = contextManager.createTask(sessionId);
    const taskId = taskContext.taskId;

    const configHash = sha256(JSON.stringify(config));

    ledger.write({
      id: generateId("ledger"),
      previousHash: ledger.lastHash(),
      timestamp: new Date().toISOString(),
      sessionId,
      taskId,
      tool: "session-start",
      toolInput: { configHash },
      trustLevel: TrustLevel.SYSTEM,
      trustSource: "warden",
      policyRulesMatched: [],
      decision: "ALLOW",
      decisionReason: `Warden session initialized. Config hash: ${configHash}`,
      hash: "",
      previousEntryHash: ledger.lastHash(),
    });

    const token = vault.mintToken({
      taskId,
      sessionId,
      allowedTools,
      ...(allowedPaths !== undefined ? { allowedPaths } : {}),
      environment,
      ttlSeconds,
    });

    return c.json({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        permissionDecision: "allow",
        permissionDecisionReason: `Warden session initialized. Config hash: ${configHash}`,
        sessionToken: token.tokenId,
        taskId,
      },
    });
  };
}
