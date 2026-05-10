const REDACT_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9\-_]{32,}/g,
  /ghp_[a-zA-Z0-9]{32,}/g,
  /gho_[a-zA-Z0-9]{32,}/g,
  /ghu_[a-zA-Z0-9]{32,}/g,
  /ghs_[a-zA-Z0-9]{32,}/g,
  /ghr_[a-zA-Z0-9]{32,}/g,
  /Bearer\s+[\w\-\.]+\.[\w\-\.]+\.[\w\-\.]*/g,
  /xox[bpras]-[\dA-Za-z-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
];

const REDACT_REPLACEMENT = "[REDACTED]";

export function redactSecrets(input: unknown): unknown {
  if (typeof input === "string") {
    let result = input;
    for (const pattern of REDACT_PATTERNS) {
      result = result.replace(pattern, REDACT_REPLACEMENT);
    }
    return result;
  }

  if (Array.isArray(input)) {
    return input.map(redactSecrets);
  }

  if (input !== null && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      result[key] = redactSecrets(value);
    }
    return result;
  }

  return input;
}

export function hasSecrets(input: string): boolean {
  return REDACT_PATTERNS.some((p) => p.test(input));
}
