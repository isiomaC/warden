import { describe, it, expect } from "vitest";
import { LocalVault } from "../src/vault";

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
});
