import type { PolicyConfig, PolicyRule } from "./policy.js";

const TOP_LEVEL_KEYS = new Set(["version", "meta", "policies", "approvalChannels", "ledger", "vault", "mcpServers", "lateralMovement", "threatDetection"]);
const META_KEYS = new Set(["environment", "sessionApprovalRequired"]);
const RULE_KEYS = new Set(["id", "description", "match", "action", "channel", "webhookUrl", "pollUrl", "timeoutSeconds"]);
const MATCH_KEYS = new Set(["tools", "environment", "trustSource", "trustLevel", "nextTool", "serverNotInAllowlist", "inputPatterns", "tool"]);
const ACTIONS = new Set(["ALLOW", "DENY", "CONFIRM", "QUARANTINE"]);
const CHANNELS = new Set(["telegram", "stdout", "webhook"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid config: "${label}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, keys: Set<string>, label: string): void {
  const unknown = Object.keys(value).filter((key) => !keys.has(key));
  if (unknown.length > 0) throw new Error(`Invalid config: unknown ${label} key(s): ${unknown.join(", ")}.`);
}

function stringList(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim() !== "")) {
    throw new Error(`Invalid config: "${label}" must be a non-empty array of strings.`);
  }
}

export function validatePolicyConfig(value: unknown): PolicyConfig {
  const config = record(value, "root");
  rejectUnknownKeys(config, TOP_LEVEL_KEYS, "top-level");
  if (typeof config.version !== "string" || config.version.trim() === "") {
    throw new Error('Invalid config: "version" must be a non-empty string.');
  }

  const meta = record(config.meta, "meta");
  rejectUnknownKeys(meta, META_KEYS, "meta");
  if (typeof meta.environment !== "string" || meta.environment.trim() === "") {
    throw new Error('Invalid config: "meta.environment" must be a non-empty string.');
  }
  if (meta.sessionApprovalRequired !== undefined && typeof meta.sessionApprovalRequired !== "boolean") {
    throw new Error('Invalid config: "meta.sessionApprovalRequired" must be a boolean.');
  }
  if (!Array.isArray(config.policies)) throw new Error('Invalid config: "policies" must be an array.');

  for (const [index, item] of config.policies.entries()) {
    const label = `policies[${index}]`;
    const rule = record(item, label);
    rejectUnknownKeys(rule, RULE_KEYS, label);
    if (typeof rule.id !== "string" || rule.id.trim() === "") throw new Error(`Invalid config: ${label}.id must be a non-empty string.`);
    if (typeof rule.description !== "string") throw new Error(`Invalid config: ${label}.description must be a string.`);
    if (typeof rule.action !== "string" || !ACTIONS.has(rule.action)) throw new Error(`Invalid config: ${label}.action is unknown.`);

    if (rule.match === null || rule.match === undefined) throw new Error(`Invalid config: ${label}.match must contain at least one condition.`);
    const match = record(rule.match, `${label}.match`);
    rejectUnknownKeys(match, MATCH_KEYS, `${label}.match`);
    if (Object.keys(match).length === 0) throw new Error(`Invalid config: ${label}.match must contain at least one condition.`);
    for (const key of ["tools", "environment", "trustSource", "trustLevel", "nextTool", "inputPatterns"] as const) {
      if (match[key] !== undefined) stringList(match[key], `${label}.match.${key}`);
    }
    if (match.tool !== undefined && (typeof match.tool !== "string" || match.tool.trim() === "")) {
      throw new Error(`Invalid config: ${label}.match.tool must be a non-empty string.`);
    }
    if (match.serverNotInAllowlist !== undefined && typeof match.serverNotInAllowlist !== "boolean") {
      throw new Error(`Invalid config: ${label}.match.serverNotInAllowlist must be a boolean.`);
    }
    if (rule.channel !== undefined && (typeof rule.channel !== "string" || !CHANNELS.has(rule.channel))) {
      throw new Error(`Invalid config: ${label}.channel is unknown.`);
    }
    if (rule.timeoutSeconds !== undefined && (!Number.isInteger(rule.timeoutSeconds) || (rule.timeoutSeconds as number) <= 0)) {
      throw new Error(`Invalid config: ${label}.timeoutSeconds must be a positive integer.`);
    }
    for (const key of ["webhookUrl", "pollUrl"] as const) {
      if (rule[key] !== undefined && typeof rule[key] !== "string") throw new Error(`Invalid config: ${label}.${key} must be a string.`);
    }
  }

  // Keep the public type assertion after validating the policy-bearing fields.
  return config as unknown as PolicyConfig & { policies: PolicyRule[] };
}
