const REDACT_PATTERNS: RegExp[] = [
  /sk[-_](?:live|test|proj)?[-_]?[a-zA-Z0-9\-_]{24,}/g,
  /ghp_[a-zA-Z0-9]{32,}/g,
  /gho_[a-zA-Z0-9]{32,}/g,
  /ghu_[a-zA-Z0-9]{32,}/g,
  /ghs_[a-zA-Z0-9]{32,}/g,
  /ghr_[a-zA-Z0-9]{32,}/g,
  /Bearer\s+[\w\-\.]+\.[\w\-\.]+\.[\w\-\.]*/g,
  /xox[bpras]-[\dA-Za-z-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@]+@/gi,
];

const KEY_VALUE = /\b(password|passwd|secret|token|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi;

const REDACT_REPLACEMENT = "[REDACTED]";
const SECRET_KEY = /^(password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key)$/i;

export function redactSecrets(input: unknown): unknown {
  if (typeof input === "string") {
    let result = input;
    for (const pattern of REDACT_PATTERNS) {
      result = result.replace(pattern, REDACT_REPLACEMENT);
    }
    return result.replace(KEY_VALUE, `$1$2${REDACT_REPLACEMENT}`);
  }

  if (Array.isArray(input)) {
    return input.map(redactSecrets);
  }

  if (input !== null && typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      result[key] = SECRET_KEY.test(key) && typeof value === "string" ? REDACT_REPLACEMENT : redactSecrets(value);
    }
    return result;
  }

  return input;
}

export function hasSecrets(input: string): boolean {
  return REDACT_PATTERNS.some((p) => p.test(input));
}
