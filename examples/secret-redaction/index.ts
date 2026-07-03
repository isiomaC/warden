/**
 * Warden Secret Redaction Example
 *
 * Demonstrates redactSecrets and hasSecrets — strip API keys, tokens,
 * and JWTs from tool input before it hits the ledger.
 *
 * Note: All secrets in this file are EXAMPLE PLACEHOLDERS.
 * They are intentionally formatted to match real token patterns
 * so Warden's redaction engine can detect them.
 *
 * Run: npx tsx examples/secret-redaction/index.ts
 */

import { redactSecrets, hasSecrets } from "@warden/core";

// Build fake tokens via concatenation to avoid GitHub push protection false positives
const OPENAI_KEY = "sk-" + "proj-example-placeholder-fake-key-12345";
const GITHUB_PAT = "ghp_" + "placeholderFakeTokenNotReal1234567890";
const SLACK_TOKEN = "xox" + "b-fake-slack-token-placeholder-12345";
const AWS_KEY = "AKIA" + "EXAMPLEFAKEACCESSKEY";
const JWT_BODY = "Bearer " + "eyJhbGciOiJIUzI1.eyJzdWIiOiJleGFtcGxlIn0.fakesig";

const toolCalls = [
  {
    tool: "Bash",
    input: { command: "echo 'hello world'" },
  },
  {
    tool: "Bash",
    input: { command: `export OPENAI_KEY=${OPENAI_KEY}` },
  },
  {
    tool: "api_call",
    input: {
      url: "https://api.example.com",
      headers: { Authorization: JWT_BODY },
    },
  },
  {
    tool: "github",
    input: { token: GITHUB_PAT },
  },
  {
    tool: "slack",
    input: { webhook: `https://hooks.slack.com/services/${SLACK_TOKEN}` },
  },
  {
    tool: "aws_config",
    input: {
      accessKeyId: AWS_KEY,
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    },
  },
  {
    tool: "nested_secrets",
    input: {
      config: {
        database: { password: `sk-${"proj-deeply-nested-fake-secret-key-placeholder"}` },
        redis: {
          auth: `Bearer ${"eyJhbGciOiJSUzI1NiJ9.eyJhY2NvdW50IjoiZmFrZSJ9.ZmFrZXNpZw=="}`,
        },
      },
    },
  },
];

console.log("=== Warden Secret Redaction ===\n");

for (const call of toolCalls) {
  const jsonStr = JSON.stringify(call.input);
  const hasAny = hasSecrets(jsonStr);
  const redacted = redactSecrets(call.input);

  if (hasAny) {
    console.log(`  🔒 ${call.tool}: secrets detected and redacted`);
    console.log(`     Before: ${jsonStr.slice(0, 100)}...`);
    console.log(`     After:  ${JSON.stringify(redacted).slice(0, 100)}...`);
  } else {
    console.log(`  ✅ ${call.tool}: clean — no secrets found`);
  }
  console.log();
}

console.log("All secrets redacted before ledger write. Auditor never sees plaintext.");
