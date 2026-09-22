import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { VaultError } from "../src/errors";
import { LocalVault, PersistentVault } from "../src/vault";

const vaultParams = {
  taskId: "task_1",
  sessionId: "session_1",
  allowedTools: ["read_file"],
  environment: "development",
  ttlSeconds: 300,
};

describe("LocalVault", () => {
  describe("mintToken", () => {
    it("should create a token with correct properties", () => {
      const vault = new LocalVault();
      const token = vault.mintToken({
        taskId: "task_1",
        sessionId: "session_1",
        allowedTools: ["read_file"],
        environment: "development",
        ttlSeconds: 300,
      });

      expect(token.tokenId).toBeTruthy();
      expect(token.taskId).toBe("task_1");
      expect(token.sessionId).toBe("session_1");
      expect(token.allowedTools).toEqual(["read_file"]);
      expect(token.environment).toBe("development");
      expect(token.revoked).toBe(false);
      expect(token.issuedAt).toBeTruthy();
      expect(token.expiresAt).toBeTruthy();
    });
  });

  describe("verifyToken", () => {
    it("should return token for valid, non-expired, non-revoked token", () => {
      const vault = new LocalVault();
      const token = vault.mintToken({
        taskId: "task_1",
        sessionId: "session_1",
        allowedTools: ["read_file"],
        environment: "development",
        ttlSeconds: 300,
      });
      expect(vault.verifyToken(token.tokenId)).not.toBeNull();
    });

    it("should return null for unknown token", () => {
      const vault = new LocalVault();
      expect(vault.verifyToken("nonexistent")).toBeNull();
    });

    it("should return null for revoked token", () => {
      const vault = new LocalVault();
      const token = vault.mintToken({
        taskId: "task_1",
        sessionId: "session_1",
        allowedTools: ["read_file"],
        environment: "development",
        ttlSeconds: 300,
      });
      vault.revokeToken(token.tokenId);
      expect(vault.verifyToken(token.tokenId)).toBeNull();
    });
  });

  describe("revokeAllForSession", () => {
    it("should revoke all tokens for a session", () => {
      const vault = new LocalVault();
      const t1 = vault.mintToken({
        taskId: "task_1",
        sessionId: "session_a",
        allowedTools: ["read_file"],
        environment: "development",
        ttlSeconds: 300,
      });
      const t2 = vault.mintToken({
        taskId: "task_2",
        sessionId: "session_b",
        allowedTools: ["read_file"],
        environment: "development",
        ttlSeconds: 300,
      });

      vault.revokeAllForSession("session_a");

      expect(vault.verifyToken(t1.tokenId)).toBeNull();
      expect(vault.verifyToken(t2.tokenId)).not.toBeNull();
    });
  });

  describe("tokenCount", () => {
    it("should return 0 when no tokens exist", () => {
      const vault = new LocalVault();
      expect(vault.tokenCount()).toBe(0);
    });

    it("should return correct count after minting", () => {
      const vault = new LocalVault();
      vault.mintToken({
        taskId: "task_1",
        sessionId: "session_a",
        allowedTools: ["read_file"],
        environment: "development",
        ttlSeconds: 300,
      });
      vault.mintToken({
        taskId: "task_2",
        sessionId: "session_b",
        allowedTools: ["write_file"],
        environment: "development",
        ttlSeconds: 300,
      });
      expect(vault.tokenCount()).toBe(2);
    });
  });

  describe("revokedCount", () => {
    it("should return 0 when no tokens have been revoked", () => {
      const vault = new LocalVault();
      vault.mintToken({
        taskId: "task_1",
        sessionId: "session_a",
        allowedTools: ["read_file"],
        environment: "development",
        ttlSeconds: 300,
      });
      expect(vault.revokedCount()).toBe(0);
    });

    it("should return correct count of revoked tokens", () => {
      const vault = new LocalVault();
      const t1 = vault.mintToken({
        taskId: "task_1",
        sessionId: "session_a",
        allowedTools: ["read_file"],
        environment: "development",
        ttlSeconds: 300,
      });
      vault.mintToken({
        taskId: "task_2",
        sessionId: "session_b",
        allowedTools: ["read_file"],
        environment: "development",
        ttlSeconds: 300,
      });

      vault.revokeToken(t1.tokenId);
      expect(vault.revokedCount()).toBe(1);
    });
  });
});

describe("PersistentVault", () => {
  function withVaultPath(test: (path: string) => void) {
    const directory = mkdtempSync(join(tmpdir(), "warden-persistent-vault-"));
    try {
      test(join(directory, "vault.enc"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("restores an unexpired token after reconstruction with the same key", () => withVaultPath((path) => {
    const vault = new PersistentVault({ path, key: "test-vault-key" });
    const token = vault.mintToken(vaultParams);

    expect(new PersistentVault({ path, key: "test-vault-key" }).verifyToken(token.tokenId))
      .toMatchObject({ tokenId: token.tokenId });
    expect(readFileSync(path, "utf8")).not.toContain(token.tokenId);
  }));

  it("fails closed for a missing key, wrong key, tampered envelope, or unsupported version", () => withVaultPath((path) => {
    expect(() => new PersistentVault({ path, key: "" })).toThrow(VaultError);

    const vault = new PersistentVault({ path, key: "test-vault-key" });
    vault.mintToken(vaultParams);
    expect(() => new PersistentVault({ path, key: "wrong-key" })).toThrow(VaultError);

    writeFileSync(path, "{\"version\":2}", { mode: 0o600 });
    expect(() => new PersistentVault({ path, key: "test-vault-key" })).toThrow(VaultError);
  }));

  it("persists individual and session revocation without leaking bearer tokens", () => withVaultPath((path) => {
    const vault = new PersistentVault({ path, key: "test-vault-key" });
    const revoked = vault.mintToken(vaultParams);
    const sessionRevoked = vault.mintToken({ ...vaultParams, taskId: "task_2", sessionId: "session_2" });
    vault.revokeToken(revoked.tokenId);
    vault.revokeAllForSession("session_2");

    const restored = new PersistentVault({ path, key: "test-vault-key" });
    expect(restored.verifyToken(revoked.tokenId)).toBeNull();
    expect(restored.verifyToken(sessionRevoked.tokenId)).toBeNull();
    expect(readFileSync(path, "utf8")).not.toContain(revoked.tokenId);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  }));

  it("rejects unsafe vault permissions and persists expiry revocation", () => withVaultPath((path) => {
    const vault = new PersistentVault({ path, key: "test-vault-key" });
    const expired = vault.mintToken({ ...vaultParams, ttlSeconds: -1 });
    expect(vault.verifyToken(expired.tokenId)).toBeNull();
    expect(new PersistentVault({ path, key: "test-vault-key" }).verifyToken(expired.tokenId)).toBeNull();

    chmodSync(path, 0o644);
    expect(() => new PersistentVault({ path, key: "test-vault-key" })).toThrow(VaultError);
  }));
});
