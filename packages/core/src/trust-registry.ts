import { sha256 } from "./hash";
import { TrustLevel } from "./trust";

export interface TrustedOutput {
  hash: string;
  trust: TrustLevel;
  source: string;
  timestamp: string;
}

export interface TrustRegistryStore {
  register(output: unknown, trust: TrustLevel, source: string): string;
  lookup(value: unknown): TrustLevel | undefined;
  clear(): void;
}

export class TrustRegistry implements TrustRegistryStore {
  private registry = new Map<string, TrustedOutput>();

  register(output: unknown, trust: TrustLevel, source: string): string {
    const serialized = typeof output === "string" ? output : JSON.stringify(output);
    const hash = sha256(serialized);

    if (!this.registry.has(hash)) {
      this.registry.set(hash, {
        hash,
        trust,
        source,
        timestamp: new Date().toISOString(),
      });
    }

    return hash;
  }

  lookup(value: unknown): TrustLevel | undefined {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    const hash = sha256(serialized);
    const entry = this.registry.get(hash);
    return entry?.trust;
  }

  clear(): void {
    this.registry.clear();
  }
}

/**
 * Strip values from input that are tagged with EXTERNAL trust in the registry.
 * Recursively handles nested objects.
 */
export function sanitizeExternalValues(
  input: Record<string, unknown>,
  registry: TrustRegistryStore,
): { sanitized: Record<string, unknown>; stripped: string[] } {
  const sanitized: Record<string, unknown> = {};
  const stripped: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    const trust = registry.lookup(value);
    if (trust === TrustLevel.EXTERNAL) {
      stripped.push(key);
      continue;
    }

    // Recursively sanitize nested objects
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = sanitizeExternalValues(
        value as Record<string, unknown>,
        registry,
      );
      // If the object had all its keys stripped, don't include it
      if (Object.keys(nested.sanitized).length > 0) {
        sanitized[key] = nested.sanitized;
      } else {
        stripped.push(key);
      }
      stripped.push(...nested.stripped.map((k) => `${key}.${k}`));
    } else {
      sanitized[key] = value;
    }
  }

  return { sanitized, stripped };
}
