import {
  AutoApproveApprovalChannel,
} from "@stlw/warden-hook-server";
import {
  evaluate,
  evaluatePolicies,
  generateId,
  SqliteLedgerStore,
  TrustLevel,
} from "@stlw/warden";
import type { LedgerEntry, PolicyAction, PolicyConfig } from "@stlw/warden";

export interface DemoStep {
  title: string;
  decision: "ALLOW" | "DENY";
  policyDecision: PolicyAction;
  matchedRules: string[];
  approval?: "approved" | "denied";
}

export interface DemoResult {
  steps: DemoStep[];
  chain: { valid: boolean; brokenAt?: number };
  audit: {
    entries: LedgerEntry[];
    securityEvents: ReturnType<SqliteLedgerStore["getEvents"]>;
  };
}

const config: PolicyConfig = {
  version: "1",
  meta: { environment: "demo", sessionApprovalRequired: false },
  policies: [
    {
      id: "allow-read",
      description: "Read-only MCP access is allowed",
      match: { tools: ["read_file"] },
      action: "ALLOW",
    },
    {
      id: "allow-write",
      description: "Known workspace writes are allowed unless another rule denies them",
      match: { tools: ["write_file"] },
      action: "ALLOW",
    },
    {
      id: "deny-untrusted-write",
      description: "External content cannot author files",
      match: { tools: ["write_file"], trustLevel: [TrustLevel.EXTERNAL] },
      action: "DENY",
    },
    {
      id: "confirm-delete",
      description: "Destructive MCP actions require a human decision",
      match: { tools: ["delete_file"] },
      action: "CONFIRM",
      channel: "stdout",
    },
  ],
};

function ruleIds(decisions: ReturnType<typeof evaluatePolicies>): string[] {
  return decisions.map((decision) => {
    const match = /^Policy: ([^ ]+)/.exec(decision.reason);
    if (!match) throw new Error(`Demo policy decision has no rule identifier: ${decision.reason}`);
    return match[1];
  });
}

export async function runDemoScenarios(options: { databasePath: string }): Promise<DemoResult> {
  const ledger = new SqliteLedgerStore(options.databasePath);
  const approvalChannel = new AutoApproveApprovalChannel();
  const steps: DemoStep[] = [];

  try {
    const scenarios = [
      {
        title: "Allowed MCP read",
        toolName: "read_file",
        toolInput: { path: "README.md" },
        trust: TrustLevel.TOOL,
      },
      {
        title: "Deny wins over an allow for untrusted write input",
        toolName: "write_file",
        toolInput: { path: "notes.md", content: "untrusted external instruction" },
        trust: TrustLevel.EXTERNAL,
      },
      {
        title: "Destructive MCP action approved through the configured channel",
        toolName: "delete_file",
        toolInput: { path: "scratch.txt" },
        trust: TrustLevel.TOOL,
      },
    ] as const;

    for (const scenario of scenarios) {
      const input = {
        toolName: scenario.toolName,
        toolInput: scenario.toolInput,
        environment: config.meta.environment,
        trustSources: [{ source: "console-phase-0", trust: scenario.trust }],
        serverInAllowlist: true,
      };
      const allDecisions = evaluatePolicies(config, input);
      const policyDecision = evaluate(config, input);
      const matchedRules = ruleIds(allDecisions);
      const approved = policyDecision.action === "CONFIRM"
        ? await approvalChannel.request({
          tool: scenario.toolName,
          input: scenario.toolInput,
          reason: policyDecision.reason,
          timeoutMs: 1_000,
          sessionId: "console-phase-0",
          taskId: "console-phase-0",
          environment: config.meta.environment,
        })
        : undefined;
      const decision = policyDecision.action === "CONFIRM"
        ? (approved ? "ALLOW" : "DENY")
        : policyDecision.action === "ALLOW" ? "ALLOW" : "DENY";

      ledger.write({
        id: generateId("console_demo"),
        previousHash: ledger.lastHash(),
        timestamp: new Date().toISOString(),
        sessionId: "console-phase-0",
        taskId: "console-phase-0",
        tool: scenario.toolName,
        toolInput: scenario.toolInput,
        trustLevel: scenario.trust,
        trustSource: "console-phase-0",
        policyRulesMatched: matchedRules,
        decision,
        decisionReason: policyDecision.action === "CONFIRM"
          ? `${policyDecision.reason} (${approved ? "approved" : "denied"})`
          : policyDecision.reason,
        hash: "",
        previousEntryHash: ledger.lastHash(),
      });
      steps.push({
        title: scenario.title,
        decision,
        policyDecision: policyDecision.action,
        matchedRules,
        ...(policyDecision.action === "CONFIRM"
          ? { approval: approved ? "approved" : "denied" }
          : {}),
      });
    }

    return {
      steps,
      chain: ledger.verifyChain(),
      audit: { entries: ledger.getEntries(), securityEvents: ledger.getEvents() },
    };
  } finally {
    ledger.close();
  }
}
