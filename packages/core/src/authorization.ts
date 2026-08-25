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
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const EFFECTS = new Set<DecisionEffect>(["ALLOW", "DENY", "PENDING_APPROVAL"]);

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${field} must be a valid identifier`);
  }
}

function assertPolicy(policy: unknown): asserts policy is AuthorizationPolicy {
  if (policy === null || typeof policy !== "object") throw new TypeError("Policy must be an object");
  const candidate = policy as Partial<AuthorizationPolicy>;
  assertIdentifier(candidate.id, "Policy id");
  if (!Number.isSafeInteger(candidate.version) || (candidate.version ?? 0) < 1) {
    throw new TypeError("Policy version must be a positive safe integer");
  }
  if (!Array.isArray(candidate.rules)) throw new TypeError("Policy rules must be an array");
  if (candidate.rules.length > AUTHORIZATION_LIMITS.maxRules) {
    throw new TypeError(`Policy exceeds the ${AUTHORIZATION_LIMITS.maxRules} rule limit`);
  }
  const ruleIds = new Set<string>();
  for (const rule of candidate.rules) {
    if (rule === null || typeof rule !== "object") throw new TypeError("Policy rules must be objects");
    assertIdentifier(rule.id, "Policy rule id");
    if (ruleIds.has(rule.id)) throw new TypeError("Policy rule ids must be unique");
    ruleIds.add(rule.id);
    if (!EFFECTS.has(rule.effect)) throw new TypeError(`Rule ${rule.id} has an invalid effect`);
    if (!Array.isArray(rule.conditions)) throw new TypeError(`Rule ${rule.id} conditions must be an array`);
    if (rule.conditions.length > AUTHORIZATION_LIMITS.maxConditionsPerRule) {
      throw new TypeError(`Rule ${rule.id} exceeds the ${AUTHORIZATION_LIMITS.maxConditionsPerRule} condition limit`);
    }
    for (const condition of rule.conditions) {
      if (condition === null || typeof condition !== "object") {
        throw new TypeError(`Rule ${rule.id} conditions must be objects`);
      }
      const separator = typeof condition.name === "string" ? condition.name.indexOf(":") : -1;
      if (separator > 0 && condition.name.indexOf(":", separator + 1) === -1) {
        assertIdentifier(condition.name.slice(0, separator), `Rule ${rule.id} resolver name`);
        assertIdentifier(condition.name.slice(separator + 1), `Rule ${rule.id} condition name`);
      } else {
        assertIdentifier(condition.name, `Rule ${rule.id} condition name`);
      }
    }
  }
}

function assertOwnFunction(value: object, property: string, field: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
    throw new TypeError(`${field} must be an own data property containing a function`);
  }
}

function assertExtension(extension: unknown): asserts extension is WardenExtension {
  if (extension === null || typeof extension !== "object") throw new TypeError("Extension must be an object");
  const candidate = extension as Partial<WardenExtension>;
  assertIdentifier(candidate.name, "Extension name");
  if (typeof candidate.version !== "string" || candidate.version.length === 0 || candidate.version.length > 64) {
    throw new TypeError("Extension version must be a non-empty string of at most 64 characters");
  }
  if (candidate.conditions !== undefined && !Array.isArray(candidate.conditions)) {
    throw new TypeError("Extension conditions must be an array");
  }
  if (candidate.resolvers !== undefined && !Array.isArray(candidate.resolvers)) {
    throw new TypeError("Extension resolvers must be an array");
  }
  for (const condition of candidate.conditions ?? []) {
    if (condition === null || typeof condition !== "object") throw new TypeError("Condition must be an object");
    assertIdentifier(condition.name, "Condition name");
    assertOwnFunction(condition, "evaluate", `Condition ${condition.name} evaluate`);
  }
  for (const resolver of candidate.resolvers ?? []) {
    if (resolver === null || typeof resolver !== "object") throw new TypeError("Resolver must be an object");
    assertIdentifier(resolver.name, "Resolver name");
    assertOwnFunction(resolver, "resolve", `Resolver ${resolver.name} resolve`);
  }
}

function assertResolverTimeout(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > AUTHORIZATION_LIMITS.maxResolverTimeoutMs) {
    throw new TypeError(`Resolver timeout must be an integer from 1 to ${AUTHORIZATION_LIMITS.maxResolverTimeoutMs}`);
  }
}

export function definePolicy(policy: AuthorizationPolicy): AuthorizationPolicy {
  assertPolicy(policy);
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
  if (!Array.isArray(options.extensions ?? [])) throw new TypeError("Extensions must be an array");
  for (const extension of options.extensions ?? []) {
    assertExtension(extension);
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
  assertResolverTimeout(timeoutMs);

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
            const result = await condition.evaluate(request, reference.value, resolved);
            if (typeof result !== "boolean") throw new TypeError(`Condition ${conditionName} must return a boolean`);
            if (!result) {
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
