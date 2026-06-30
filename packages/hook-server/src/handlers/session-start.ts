import type { Context } from "hono";
import {
  sha256,
  checkSupplyChain,
  parseLockDeps,
  TrustLevel,
  generateId,
} from "@warden/core";
import type {
  PolicyConfig,
  VaultAdapter,
  LedgerStore,
  ContextStore,
  PackagePin,
} from "@warden/core";

const VALID_ENVIRONMENTS = ["development", "staging", "production"];

function loadPins(pinsPath: string): Record<string, PackagePin> {
  try {
    const raw = require("node:fs").readFileSync(pinsPath, "utf-8");
    return JSON.parse(raw) as Record<string, PackagePin>;
  } catch {
    return {};
  }
}

function readLockDeps() {
  const lockPath = `${process.cwd()}/package-lock.json`;
  try {
    const raw = require("node:fs").readFileSync(lockPath, "utf-8");
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
) {
  return async (c: Context) => {
    const body = await c.req.json().catch(() => ({}));
    const sessionId: string = body.session_id ?? "default";
    const allowedTools: string[] = body.allowedTools ?? ["*"];
    const environment: string = body.environment ?? "development";

    if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
      return c.json({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          permissionDecision: "deny",
          permissionDecisionReason: "Warden: allowedTools must be a non-empty array.",
        },
      });
    }

    if (!VALID_ENVIRONMENTS.includes(environment)) {
      return c.json({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          permissionDecision: "deny",
          permissionDecisionReason: `Warden: invalid environment "${environment}". Must be one of: ${VALID_ENVIRONMENTS.join(", ")}.`,
        },
      });
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
              `Warden: Supply chain violations detected. ${details}. Run 'warden supply-chain approve'.`,
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
