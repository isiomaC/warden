import type { TrustLevel } from "./trust";
import { TrustLevel as TL } from "./trust";

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|above|all)\s+instructions/i,
  /you\s+are\s+now\s+a/i,
  /disregard\s+(your|the)\s+(system\s+)?prompt/i,
  /new\s+instructions?\s*:/i,
  /\[system\]/i,
  /override\s+your\s+(safety|security|policy)/i,
  /act\s+as\s+(if\s+you\s+are|a)\s+(?!an?\s+AI)/i,
  /do\s+not\s+follow\s+(the\s+)?rules/i,
  /pretend\s+(you\s+)?(are|have\s+no)/i,
];

const INDIRECT_INJECTION_PATTERNS: RegExp[] = [
  /\[INST\]/i,
  /<\|system\|>/i,
  /###\s*System:/i,
  /\{\{.*instructions.*\}\}/i,
];

export interface ScanResult {
  clean: boolean;
  patterns?: string[];
  recommendation?: "BLOCK" | "CONFIRM" | "ALLOW";
}

export function scanForInjection(
  prompt: string,
  trustLevel: TrustLevel,
): ScanResult {
  if (trustLevel === TL.SYSTEM) {
    return { clean: true };
  }

  const directHits = INJECTION_PATTERNS.filter((p) => p.test(prompt));
  const indirectHits = INDIRECT_INJECTION_PATTERNS.filter((p) => p.test(prompt));
  const allHits = [...directHits, ...indirectHits];

  if (allHits.length > 0) {
    return {
      clean: false,
      patterns: allHits.map((p) => p.source),
      recommendation:
        trustLevel === TL.EXTERNAL
          ? "BLOCK"
          : "CONFIRM",
    };
  }

  return { clean: true };
}
