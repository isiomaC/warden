import { ulid } from "ulid";

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
}
