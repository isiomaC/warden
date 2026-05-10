import type { TrustLevel } from "./trust";

export type PolicyAction = "ALLOW" | "DENY" | "CONFIRM" | "QUARANTINE";

export type PolicyDecision =
  | { action: "ALLOW"; reason: string }
  | { action: "DENY"; reason: string }
  | { action: "CONFIRM"; reason: string; channel: "telegram" | "slack" | "stdout" }
  | { action: "QUARANTINE"; reason: string; strippedContext: string[] };

export interface PolicyRule {
  id: string;
  description: string;
  match: {
    tools?: string[];
    environment?: string[];
    trustSource?: TrustLevel[];
    trustLevel?: TrustLevel[];
    nextTool?: string[];
    serverNotInAllowlist?: boolean;
    inputPatterns?: string[];
    tool?: string;
  };
  action: PolicyAction;
  channel?: "telegram" | "slack" | "stdout";
  timeoutSeconds?: number;
}

export interface PolicyConfig {
  version: string;
  meta: {
    environment: string;
    sessionApprovalRequired: boolean;
  };
  policies: PolicyRule[];
}

export interface EvaluateInput {
  toolName: string;
  toolInput: Record<string, unknown>;
  environment: string;
  trustSources: { source: string; trust: TrustLevel }[];
  serverInAllowlist: boolean;
}

function matchRule(rule: PolicyRule, input: EvaluateInput): boolean {
  const m = rule.match;

  if (m.serverNotInAllowlist !== undefined) {
    if (m.serverNotInAllowlist && !input.serverInAllowlist) return true;
  }

  if (m.tools && m.tools.length > 0) {
    if (!m.tools.includes(input.toolName)) return false;
  }

  if (m.tool && m.tool !== input.toolName) return false;

  if (m.environment && m.environment.length > 0) {
    if (!m.environment.includes(input.environment)) return false;
  }

  if (m.trustSource && m.trustSource.length > 0) {
    const hasTrust = input.trustSources.some((ts) =>
      m.trustSource!.includes(ts.trust),
    );
    if (!hasTrust) return false;
  }

  if (m.trustLevel && m.trustLevel.length > 0) {
    const hasLevel = input.trustSources.some((ts) =>
      m.trustLevel!.includes(ts.trust),
    );
    if (!hasLevel) return false;
  }

  if (m.inputPatterns && m.inputPatterns.length > 0) {
    const inputStr = JSON.stringify(input.toolInput);
    const hasPattern = m.inputPatterns.some((p) => new RegExp(p, "i").test(inputStr));
    if (!hasPattern) return false;
  }

  if (m.nextTool && m.nextTool.length > 0) {
    if (!m.nextTool.includes(input.toolName)) return false;
  }

  return true;
}

function ruleToDecision(rule: PolicyRule, _input: EvaluateInput): PolicyDecision {
  switch (rule.action) {
    case "ALLOW":
      return { action: "ALLOW", reason: `Policy: ${rule.id} — ${rule.description}` };
    case "DENY":
      return { action: "DENY", reason: `Policy: ${rule.id} — ${rule.description}` };
    case "CONFIRM":
      return {
        action: "CONFIRM",
        reason: `Policy: ${rule.id} — ${rule.description}`,
        channel: rule.channel ?? "stdout",
      };
    case "QUARANTINE":
      return {
        action: "QUARANTINE",
        reason: `Policy: ${rule.id} — ${rule.description}`,
        strippedContext: [],
      };
  }
}

export function resolveConflicts(decisions: PolicyDecision[]): PolicyDecision {
  const deny = decisions.find((d) => d.action === "DENY");
  if (deny) return deny;

  const quarantine = decisions.find((d) => d.action === "QUARANTINE");
  if (quarantine) return quarantine;

  const confirm = decisions.find((d) => d.action === "CONFIRM");
  if (confirm) return confirm;

  const allow = decisions.find((d) => d.action === "ALLOW");
  if (allow) return allow;

  return { action: "DENY", reason: "No matching policy rule. Default deny." };
}

export function evaluatePolicies(
  config: PolicyConfig,
  input: EvaluateInput,
): PolicyDecision[] {
  return config.policies
    .filter((rule) => matchRule(rule, input))
    .map((rule) => ruleToDecision(rule, input));
}

export function evaluate(
  config: PolicyConfig,
  input: EvaluateInput,
): PolicyDecision {
  const decisions = evaluatePolicies(config, input);
  return resolveConflicts(decisions);
}
