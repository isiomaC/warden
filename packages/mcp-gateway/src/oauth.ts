export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scope: string;
}

export class OAuthManager {
  private tokens = new Map<string, OAuthToken>();

  storeToken(serverName: string, token: OAuthToken): void {
    this.tokens.set(serverName, token);
  }

  getToken(serverName: string): OAuthToken | null {
    const token = this.tokens.get(serverName);
    if (!token) return null;

    if (new Date() > new Date(token.expiresAt)) {
      this.tokens.delete(serverName);
      return null;
    }

    return token;
  }

  hasValidToken(serverName: string): boolean {
    return this.getToken(serverName) !== null;
  }

  revokeToken(serverName: string): void {
    this.tokens.delete(serverName);
  }

  revokeAll(): void {
    this.tokens.clear();
  }
}
