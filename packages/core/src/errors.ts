export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly code: "RUG_PULL" | "SHADOW_MCP" | "TAMPER" | "INJECTION" | "CONFIG_CHANGE" | "TOKEN_EXPIRED" | "TOKEN_REVOKED" | "UNAUTHORIZED" | "LATERAL_MOVEMENT" | "SUPPLY_CHAIN" = "UNAUTHORIZED",
  ) {
    super(message);
    this.name = "SecurityError";
  }
}

export class QuarantineError extends Error {
  constructor(
    message: string,
    public readonly strippedContext: string[],
  ) {
    super(message);
    this.name = "QuarantineError";
  }
}

export class ApprovalTimeoutError extends Error {
  constructor(toolName: string) {
    super(`Approval timeout for tool: ${toolName}`);
    this.name = "ApprovalTimeoutError";
  }
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export class LedgerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerIntegrityError";
  }
}
