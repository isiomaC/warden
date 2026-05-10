import { sha256 } from "./hash";

export const TrustLevel = {
  SYSTEM: 3,
  AGENT: 2,
  TOOL: 1,
  EXTERNAL: 0,
} as const;

export type TrustLevel = (typeof TrustLevel)[keyof typeof TrustLevel];

export interface TrustedValue<T = unknown> {
  value: T;
  trust: TrustLevel;
  source: string;
  taskId: string;
  hash: string;
  timestamp: string;
}

function inferTrust(source: string): TrustLevel {
  if (source === "system_prompt" || source === "warden_config") {
    return TrustLevel.SYSTEM;
  }
  if (source.startsWith("mcp__")) {
    return TrustLevel.TOOL;
  }
  return TrustLevel.EXTERNAL;
}

export function tagValue<T>(
  value: T,
  source: string,
  taskId: string,
): TrustedValue<T> {
  const trust = inferTrust(source);
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return {
    value,
    trust,
    source,
    taskId,
    hash: sha256(serialized),
    timestamp: new Date().toISOString(),
  };
}

export function canPromote(from: TrustLevel, to: TrustLevel): boolean {
  return from >= to;
}

export function lowestTrust(values: TrustedValue[]): TrustLevel {
  if (values.length === 0) return TrustLevel.SYSTEM;
  return Math.min(...values.map((v) => v.trust)) as TrustLevel;
}
