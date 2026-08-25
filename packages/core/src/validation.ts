export const AUTHORIZATION_LIMITS = {
  maxRules: 1_000,
  maxConditionsPerRule: 64,
  maxDepth: 16,
  maxNodes: 10_000,
  maxStringLength: 64 * 1024,
  maxResolverTimeoutMs: 30_000,
} as const;

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function assertPlainRecord(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${field} must be a plain object`);
  }
}

export function assertSafeValue(value: unknown, field: string): void {
  const ancestors = new Set<object>();
  let nodes = 0;

  function visit(current: unknown, path: string, depth: number): void {
    nodes += 1;
    if (nodes > AUTHORIZATION_LIMITS.maxNodes) {
      throw new TypeError(`${field} exceeds the node limit`);
    }
    if (depth > AUTHORIZATION_LIMITS.maxDepth) {
      throw new TypeError(`${field} exceeds the nesting limit`);
    }

    if (current === null || current === undefined || typeof current === "boolean") return;
    if (typeof current === "string") {
      if (current.length > AUTHORIZATION_LIMITS.maxStringLength) {
        throw new TypeError(`${path} exceeds the string length limit`);
      }
      return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError(`${path} must be a finite number`);
      return;
    }
    if (typeof current !== "object") throw new TypeError(`${path} has an unsupported value type`);

    const prototype = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only arrays and plain objects`);
    }
    if (ancestors.has(current)) throw new TypeError(`${path} contains a cycle`);
    ancestors.add(current);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key === "symbol") throw new TypeError(`${path} contains a symbol key`);
        if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`${path} contains forbidden key ${key}`);
        const descriptor = descriptors[key];
        if (descriptor.get || descriptor.set || !("value" in descriptor)) {
          throw new TypeError(`${path}.${key} must not be an accessor`);
        }
        visit(descriptor.value, `${path}.${key}`, depth + 1);
      }
    } finally {
      ancestors.delete(current);
    }
  }

  visit(value, field, 0);
}
