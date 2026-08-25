import { AUTHORIZATION_LIMITS, assertSafeValue } from "./validation.js";

export type DecisionEffect = "ALLOW" | "DENY" | "PENDING_APPROVAL";

export interface EvaluationRequest<
  Subject = unknown,
  Action = unknown,
  Resource = unknown,
  Context = unknown,
> {
  subject: Subject;
  action: Action;
  resource: Resource;
  context?: Context;
}

export interface DecisionReason {
  code: "RULE_MATCHED" | "NO_MATCH" | "EVALUATION_ERROR";
  ruleId?: string;
  message?: string;
}

export interface Decision {
  effect: DecisionEffect;
  policyId: string;
  policyVersion: number;
  matchedRules: string[];
  reasons: DecisionReason[];
}

export interface ConditionReference {
  name: string;
  value?: unknown;
}

export interface AuthorizationRule {
  id: string;
  effect: DecisionEffect;
  conditions: ConditionReference[];
}

export interface AuthorizationPolicy {
  id: string;
  version: number;
  rules: AuthorizationRule[];
}

export interface ConditionDefinition {
  name: string;
  evaluate(
    request: EvaluationRequest,
    expected: unknown,
    resolved?: unknown,
  ): boolean | Promise<boolean>;
}

export interface ResolverDefinition {
  name: string;
  resolve(request: EvaluationRequest): unknown | Promise<unknown>;
}

export interface WardenExtension {
  name: string;
  version: string;
  conditions?: ConditionDefinition[];
  resolvers?: ResolverDefinition[];
}

export interface WardenOptions {
  extensions?: WardenExtension[];
  resolverTimeoutMs?: number;
}

export interface Warden {
  evaluate(policy: AuthorizationPolicy, request: EvaluationRequest): Promise<Decision>;
}

const DEFAULT_RESOLVER_TIMEOUT_MS = 1_000;

export function definePolicy(policy: AuthorizationPolicy): AuthorizationPolicy {
  if (!policy.id || !Number.isSafeInteger(policy.version) || policy.version < 1) {
    throw new TypeError("Policy id and positive integer version are required");
  }
  if (policy.rules.length > AUTHORIZATION_LIMITS.maxRules) {
    throw new TypeError(`Policy exceeds the ${AUTHORIZATION_LIMITS.maxRules} rule limit`);
  }
  const ruleIds = new Set<string>();
  for (const rule of policy.rules) {
    if (!rule.id || ruleIds.has(rule.id)) throw new TypeError("Policy rule ids must be unique and non-empty");
    ruleIds.add(rule.id);
    if (!Array.isArray(rule.conditions)) throw new TypeError(`Rule ${rule.id} conditions must be an array`);
    if (rule.conditions.length > AUTHORIZATION_LIMITS.maxConditionsPerRule) {
      throw new TypeError(`Rule ${rule.id} exceeds the ${AUTHORIZATION_LIMITS.maxConditionsPerRule} condition limit`);
    }
  }
  return policy;
}

function withTimeout<T>(value: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Resolver timed out")), timeoutMs);
    void value.then(
      (result) => { clearTimeout(timer); resolve(result); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function createWarden(options: WardenOptions = {}): Warden {
  const conditions = new Map<string, ConditionDefinition>();
  const resolvers = new Map<string, ResolverDefinition>();
  for (const extension of options.extensions ?? []) {
    if (!extension.name || !extension.version) throw new TypeError("Extension name and version are required");
    for (const condition of extension.conditions ?? []) {
      if (!condition.name || conditions.has(condition.name)) throw new TypeError(`Duplicate condition: ${condition.name}`);
      conditions.set(condition.name, condition);
    }
    for (const resolver of extension.resolvers ?? []) {
      if (!resolver.name || resolvers.has(resolver.name)) throw new TypeError(`Duplicate resolver: ${resolver.name}`);
      resolvers.set(resolver.name, resolver);
    }
  }
  const timeoutMs = options.resolverTimeoutMs ?? DEFAULT_RESOLVER_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > AUTHORIZATION_LIMITS.maxResolverTimeoutMs) {
    throw new TypeError(`Resolver timeout must be between 0 and ${AUTHORIZATION_LIMITS.maxResolverTimeoutMs}ms`);
  }

  return {
    async evaluate(policy, request) {
      let policyId = "";
      let policyVersion = 0;
      try {
        assertSafeValue(policy, "policy");
        assertSafeValue(request, "request");
        definePolicy(policy);
        policyId = policy.id;
        policyVersion = policy.version;
        for (const rule of policy.rules) {
          for (const reference of rule.conditions) {
            assertSafeValue(reference.value, `policy.rules.${rule.id}.conditions.${reference.name}.value`);
          }
        }
        const matched: AuthorizationRule[] = [];
        for (const rule of policy.rules) {
          let matches = true;
          for (const reference of rule.conditions) {
            const separator = reference.name.indexOf(":");
            const resolverName = separator > 0 ? reference.name.slice(0, separator) : undefined;
            const conditionName = separator > 0 ? reference.name.slice(separator + 1) : reference.name;
            const condition = conditions.get(conditionName);
            let resolved: unknown;
            if (resolverName) {
              const resolver = resolvers.get(resolverName);
              if (!resolver) throw new Error(`Unknown resolver: ${resolverName}`);
              resolved = await withTimeout(Promise.resolve(resolver.resolve(request)), timeoutMs);
            }
            if (!condition) throw new Error(`Unknown condition: ${conditionName}`);
            if (!await condition.evaluate(request, reference.value, resolved)) {
              matches = false;
              break;
            }
          }
          if (matches) matched.push(rule);
        }

        const matchedRules = matched.map((rule) => rule.id);
        const winner = matched.find((rule) => rule.effect === "DENY")
          ?? matched.find((rule) => rule.effect === "PENDING_APPROVAL")
          ?? matched.find((rule) => rule.effect === "ALLOW");
        if (!winner) {
          return { effect: "DENY", policyId, policyVersion, matchedRules, reasons: [{ code: "NO_MATCH" }] };
        }
        return {
          effect: winner.effect,
          policyId,
          policyVersion,
          matchedRules,
          reasons: matched.map((rule) => ({ code: "RULE_MATCHED", ruleId: rule.id })),
        };
      } catch (error) {
        return {
          effect: "DENY",
          policyId,
          policyVersion,
          matchedRules: [],
          reasons: [{ code: "EVALUATION_ERROR", message: error instanceof Error ? error.message : "Unknown evaluation error" }],
        };
      }
    },
  };
}
