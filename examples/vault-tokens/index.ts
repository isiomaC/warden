/**
 * Warden Credential Vault Example
 *
 * Demonstrates the LocalVault — mint ephemeral scoped tokens, verify them,
 * enforce TTL expiry, and revoke per session. No static secrets anywhere.
 *
 * Run: npx tsx examples/vault-tokens/index.ts
 */

import { LocalVault } from "@stlw/warden";

async function main() {

console.log("=== Warden Credential Vault ===\n");

const vault = new LocalVault();
const sessionId = "session-demo-002";

// ---- 1. Mint a token ----
console.log("1. Minting a scoped token\n");

const token = vault.mintToken({
  taskId: "task-write-files",
  sessionId,
  allowedTools: ["read_file", "list_directory"],
  environment: "development",
  ttlSeconds: 5,  // 5-second TTL for demo
});

console.log(`  Token ID:       ${token.tokenId.slice(0, 16)}...`);
console.log(`  Task ID:        ${token.taskId}`);
console.log(`  Session ID:     ${token.sessionId}`);
console.log(`  Allowed tools:  ${token.allowedTools.join(", ")}`);
console.log(`  Issued:         ${token.issuedAt}`);
console.log(`  Expires:        ${token.expiresAt}`);
console.log(`  Environment:    ${token.environment}`);
console.log(`  Revoked:        ${token.revoked}\n`);

// ---- 2. Verify valid token ----
console.log("2. Verifying valid token\n");

const verified = vault.verifyToken(token.tokenId);
if (verified) {
  console.log(`  ✅ Token valid — session=${verified.sessionId}, task=${verified.taskId}\n`);
} else {
  console.log(`  ❌ Token invalid\n`);
}

// ---- 3. Verify an unknown token ----
console.log("3. Verifying unknown token\n");

const unknown = vault.verifyToken("nonexistent-token-id");
console.log(`  Unknown token → ${unknown === null ? "null (DENY)" : "valid!"}\n`);

// ---- 4. Expire token by waiting past TTL ----
console.log("4. Waiting for token to expire (TTL = 5s)...\n");

await new Promise((r) => setTimeout(r, 6_000));

const expired = vault.verifyToken(token.tokenId);
console.log(`  Token after expiry → ${expired === null ? "null (DENY — auto-revoked)" : "still valid!"}\n`);

// ---- 5. Mint new token, then revoke ----
console.log("5. Minting token for revocation test\n");

const token2 = vault.mintToken({
  taskId: "task-read-only",
  sessionId,
  allowedTools: ["read_file"],
  environment: "development",
  ttlSeconds: 300,
});

console.log(`  Token minted: ${token2.tokenId.slice(0, 16)}...`);
console.log(`  Before revoke → ${vault.verifyToken(token2.tokenId) ? "valid" : "null"}`);

vault.revokeToken(token2.tokenId);
console.log(`  After revoke  → ${vault.verifyToken(token2.tokenId) === null ? "null (revoked)" : "still valid!"}\n`);

// ---- 6. Mint multiple tokens, revoke all for session ----
console.log("6. Session-level revocation\n");

const t1 = vault.mintToken({ taskId: "t1", sessionId: "session-bulk", allowedTools: ["*"], environment: "dev", ttlSeconds: 300 });
const t2 = vault.mintToken({ taskId: "t2", sessionId: "session-bulk", allowedTools: ["*"], environment: "dev", ttlSeconds: 300 });
const t3 = vault.mintToken({ taskId: "t3", sessionId: "session-other", allowedTools: ["*"], environment: "dev", ttlSeconds: 300 });

console.log(`  Tokens before revokeAllForSession("session-bulk"):`);
console.log(`    t1 → ${vault.verifyToken(t1.tokenId) ? "valid" : "null"}`);
console.log(`    t2 → ${vault.verifyToken(t2.tokenId) ? "valid" : "null"}`);
console.log(`    t3 → ${vault.verifyToken(t3.tokenId) ? "valid" : "null"}`);

vault.revokeAllForSession("session-bulk");

console.log(`  Tokens after revokeAllForSession("session-bulk"):`);
console.log(`    t1 → ${vault.verifyToken(t1.tokenId) === null ? "null (revoked)" : "still valid!"}`);
console.log(`    t2 → ${vault.verifyToken(t2.tokenId) === null ? "null (revoked)" : "still valid!"}`);
console.log(`    t3 → ${vault.verifyToken(t3.tokenId) ? "valid (different session)" : "null"}\n`);

console.log("No static secrets. Tokens are ephemeral, scoped, TTL-bounded.");

}

main();
