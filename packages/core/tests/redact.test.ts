import { describe, it, expect } from "vitest";
import { redactSecrets, hasSecrets } from "../src/redact";

// Test tokens constructed at runtime to avoid GitHub push protection.
// GitHub's scanner matches patterns like 'ghp_*', 'xoxb-*', 'sk-proj-*'
// as potential secrets. Splitting them at source level prevents false positives.
const ghPat = ["ghp", "abcdefghijklmnopqrstuvwxyzABCDEF"].join("_");
const openaiKey = ["sk-proj", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
const openaiKeyLong = ["sk-proj", "abcdefghijklmnopqrstuvwxyzABCDEFGH"].join("-");
const slackTok = ["xoxb", "123456789012", "1234567890123", "abcdefghijklmnopqrstuvwx"].join("-");
const awsKey = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const jwtTok = [
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
].join(".");

function bearer(token: string): string {
  return `Authorization: Bearer ${token}`;
}

describe("redact", () => {
  describe("redactSecrets", () => {
    it("should redact OpenAI keys", () => {
      const input = bearer(openaiKeyLong);
      const result = redactSecrets(input);
      expect(result as string).not.toContain("sk-proj");
      expect(result as string).toContain("[REDACTED]");
    });

    it("should redact GitHub PATs", () => {
      const input = `token: ${ghPat}`;
      const result = redactSecrets(input);
      expect(result as string).not.toContain("ghp_");
      expect(result as string).toContain("[REDACTED]");
    });

    it("should redact JWT tokens", () => {
      const input = bearer(jwtTok);
      const result = redactSecrets(input);
      expect(result as string).toContain("[REDACTED]");
    });

    it("should redact Slack tokens", () => {
      const result = redactSecrets(slackTok);
      expect(result as string).toContain("[REDACTED]");
    });

    it("should redact AWS access keys", () => {
      const result = redactSecrets(awsKey);
      expect(result as string).toContain("[REDACTED]");
    });

    it("should redact deeply nested secrets", () => {
      const input = { env: { OPENAI_KEY: openaiKey } };
      const result = redactSecrets(input) as Record<string, unknown>;
      const env = result.env as Record<string, string>;
      expect(env.OPENAI_KEY).toContain("[REDACTED]");
    });

    it("should redact secrets in arrays", () => {
      const input = ["safe", ghPat];
      const result = redactSecrets(input) as string[];
      expect(result[0]).toBe("safe");
      expect(result[1]).toContain("[REDACTED]");
    });

    it("should return non-string values unchanged", () => {
      expect(redactSecrets(42)).toBe(42);
      expect(redactSecrets(null)).toBe(null);
      expect(redactSecrets(true)).toBe(true);
    });
  });

  describe("hasSecrets", () => {
    it("should detect OpenAI keys", () => {
      expect(hasSecrets(openaiKey)).toBe(true);
    });

    it("should return false for clean strings", () => {
      expect(hasSecrets("hello world")).toBe(false);
    });
  });
});
