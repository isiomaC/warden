import { ulid } from "ulid";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { VaultError } from "./errors.js";

export interface TaskToken {
  tokenId: string;
  taskId: string;
  sessionId: string;
  allowedTools: string[];
  allowedPaths: string[] | undefined;
  allowedQueryPatterns: string[] | undefined;
  environment: string;
  issuedAt: string;
  expiresAt: string;
  revoked: boolean;
}

export interface MintTokenParams {
  taskId: string;
  sessionId: string;
  allowedTools: string[];
  allowedPaths?: string[];
  allowedQueryPatterns?: string[];
  environment: string;
  ttlSeconds: number;
}

export interface VaultAdapter {
  mintToken(params: MintTokenParams): TaskToken;
  verifyToken(tokenId: string): TaskToken | null;
  revokeToken(tokenId: string): void;
  revokeAllForSession(sessionId: string): void;
  tokenCount?(): number;
  revokedCount?(): number;
}

export interface PersistentVaultOptions {
  path: string;
  key: string;
}

interface EncryptedVaultEnvelope {
  version: 1;
  kdf: { name: "scrypt"; salt: string };
  cipher: { name: "aes-256-gcm"; nonce: string; tag: string; ciphertext: string };
}

function cloneTokens(tokens: Map<string, TaskToken>): Map<string, TaskToken> {
  return new Map([...tokens].map(([id, token]) => [id, { ...token, allowedTools: [...token.allowedTools], allowedPaths: token.allowedPaths && [...token.allowedPaths], allowedQueryPatterns: token.allowedQueryPatterns && [...token.allowedQueryPatterns] }]));
}

function validToken(value: unknown): value is TaskToken {
  if (!value || typeof value !== "object") return false;
  const token = value as Record<string, unknown>;
  return typeof token.tokenId === "string" && typeof token.taskId === "string" && typeof token.sessionId === "string"
    && Array.isArray(token.allowedTools) && token.allowedTools.every((tool) => typeof tool === "string")
    && (token.allowedPaths === undefined || (Array.isArray(token.allowedPaths) && token.allowedPaths.every((path) => typeof path === "string")))
    && (token.allowedQueryPatterns === undefined || (Array.isArray(token.allowedQueryPatterns) && token.allowedQueryPatterns.every((pattern) => typeof pattern === "string")))
    && typeof token.environment === "string" && typeof token.issuedAt === "string" && typeof token.expiresAt === "string"
    && typeof token.revoked === "boolean";
}

export class PersistentVault implements VaultAdapter {
  private tokens = new Map<string, TaskToken>();

  constructor(private readonly options: PersistentVaultOptions) {
    if (!options.key.trim()) throw new VaultError("Persistent vault requires WARDEN_VAULT_KEY.");
    if (!options.path) throw new VaultError("Persistent vault requires a storage path.");
    mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
    if (existsSync(options.path)) {
      if ((statSync(options.path).mode & 0o077) !== 0) {
        throw new VaultError("Persistent vault file permissions must be owner-only.");
      }
      this.tokens = this.load();
    }
    this.pruneExpired();
  }

  mintToken(params: MintTokenParams): TaskToken {
    const now = new Date();
    const token: TaskToken = {
      tokenId: ulid(), taskId: params.taskId, sessionId: params.sessionId,
      allowedTools: [...params.allowedTools], allowedPaths: params.allowedPaths && [...params.allowedPaths],
      allowedQueryPatterns: params.allowedQueryPatterns && [...params.allowedQueryPatterns], environment: params.environment,
      issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + params.ttlSeconds * 1000).toISOString(), revoked: false,
    };
    this.mutate(() => this.tokens.set(token.tokenId, token));
    return token;
  }

  verifyToken(tokenId: string): TaskToken | null {
    const token = this.tokens.get(tokenId);
    if (!token || token.revoked) return null;
    if (Date.now() > new Date(token.expiresAt).getTime()) {
      this.mutate(() => { token.revoked = true; this.tokens.set(tokenId, token); });
      return null;
    }
    return token;
  }

  revokeToken(tokenId: string): void {
    if (!this.tokens.has(tokenId)) return;
    this.mutate(() => { const token = this.tokens.get(tokenId)!; token.revoked = true; this.tokens.set(tokenId, token); });
  }

  revokeAllForSession(sessionId: string): void {
    if (![...this.tokens.values()].some((token) => token.sessionId === sessionId && !token.revoked)) return;
    this.mutate(() => { for (const token of this.tokens.values()) if (token.sessionId === sessionId) token.revoked = true; });
  }

  tokenCount(): number { return this.tokens.size; }
  revokedCount(): number { return [...this.tokens.values()].filter((token) => token.revoked).length; }

  private pruneExpired(): void {
    const expired = [...this.tokens.values()].filter((token) => !token.revoked && Date.now() > new Date(token.expiresAt).getTime());
    if (expired.length === 0) return;
    this.mutate(() => { for (const token of expired) token.revoked = true; });
  }

  private mutate(change: () => void): void {
    const previous = cloneTokens(this.tokens);
    try { change(); this.save(); } catch (error) { this.tokens = previous; throw error instanceof VaultError ? error : new VaultError(`Persistent vault write failed: ${error instanceof Error ? error.message : "unknown error"}`); }
  }

  private load(): Map<string, TaskToken> {
    try {
      const envelope = JSON.parse(readFileSync(this.options.path, "utf8")) as EncryptedVaultEnvelope;
      if (envelope.version !== 1 || envelope.kdf?.name !== "scrypt" || envelope.cipher?.name !== "aes-256-gcm") throw new Error("unsupported vault envelope");
      const key = scryptSync(this.options.key, Buffer.from(envelope.kdf.salt, "base64"), 32);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.cipher.nonce, "base64"));
      decipher.setAuthTag(Buffer.from(envelope.cipher.tag, "base64"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.cipher.ciphertext, "base64")), decipher.final()]);
      const tokens: unknown = JSON.parse(plaintext.toString("utf8"));
      if (!Array.isArray(tokens) || !tokens.every(validToken)) throw new Error("invalid token payload");
      return new Map(tokens.map((token) => [token.tokenId, token]));
    } catch (error) { throw new VaultError(`Persistent vault cannot be opened: ${error instanceof Error ? error.message : "unknown error"}`); }
  }

  private save(): void {
    const salt = randomBytes(16); const nonce = randomBytes(12); const key = scryptSync(this.options.key, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify([...this.tokens.values()]), "utf8"), cipher.final()]);
    const envelope: EncryptedVaultEnvelope = { version: 1, kdf: { name: "scrypt", salt: salt.toString("base64") }, cipher: { name: "aes-256-gcm", nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") } };
    const temporary = join(dirname(this.options.path), `.${this.options.path.split("/").pop()}.${randomBytes(8).toString("hex")}.tmp`);
    try { writeFileSync(temporary, JSON.stringify(envelope), { mode: 0o600 }); renameSync(temporary, this.options.path); }
    finally { rmSync(temporary, { force: true }); }
  }
}

export class LocalVault implements VaultAdapter {
  private tokens = new Map<string, TaskToken>();

  mintToken(params: MintTokenParams): TaskToken {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + params.ttlSeconds * 1000);

    const token: TaskToken = {
      tokenId: ulid(),
      taskId: params.taskId,
      sessionId: params.sessionId,
      allowedTools: params.allowedTools,
      allowedPaths: params.allowedPaths,
      allowedQueryPatterns: params.allowedQueryPatterns,
      environment: params.environment,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revoked: false,
    };

    this.tokens.set(token.tokenId, token);
    return token;
  }

  verifyToken(tokenId: string): TaskToken | null {
    const token = this.tokens.get(tokenId);
    if (!token) return null;
    if (token.revoked) return null;

    const now = new Date();
    const expires = new Date(token.expiresAt);
    if (now > expires) {
      token.revoked = true;
      return null;
    }

    return token;
  }

  revokeToken(tokenId: string): void {
    const token = this.tokens.get(tokenId);
    if (token) {
      token.revoked = true;
      this.tokens.set(tokenId, token);
    }
  }

  revokeAllForSession(sessionId: string): void {
    for (const [id, token] of this.tokens) {
      if (token.sessionId === sessionId) {
        token.revoked = true;
        this.tokens.set(id, token);
      }
    }
  }

  tokenCount(): number {
    return this.tokens.size;
  }

  revokedCount(): number {
    let count = 0;
    for (const token of this.tokens.values()) {
      if (token.revoked) count++;
    }
    return count;
  }
}
