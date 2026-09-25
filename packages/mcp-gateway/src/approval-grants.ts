import { generateId, sha256 } from "@stlw/warden";

export interface ApprovalGrantInput {
  sessionId: string;
  taskId: string;
  canonicalAction: string;
  input: Record<string, unknown>;
  expiresInMs?: number;
}

export interface ApprovalGrant {
  id: string;
  expiresAt: string;
}

interface StoredApprovalGrant extends ApprovalGrant {
  sessionId: string;
  taskId: string;
  canonicalAction: string;
  inputHash: string;
}

export interface ApprovalGrantScope {
  sessionId: string;
  taskId: string;
  canonicalAction: string;
  input: Record<string, unknown>;
}

const DEFAULT_EXPIRY_MS = 60_000;

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Approval input must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  throw new TypeError(`Unsupported approval input: ${typeof value}`);
}

function inputHash(input: Record<string, unknown>): string {
  return sha256(canonicalize(input));
}

export class ApprovalGrantStore {
  private readonly grants = new Map<string, StoredApprovalGrant>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  issue(input: ApprovalGrantInput): ApprovalGrant {
    if (!input.sessionId || !input.taskId || !input.canonicalAction) {
      throw new TypeError("Approval grants require session, task, and canonical action IDs");
    }
    const expiresInMs = input.expiresInMs ?? DEFAULT_EXPIRY_MS;
    if (!Number.isSafeInteger(expiresInMs) || expiresInMs < 1) {
      throw new TypeError("Approval grant expiry must be a positive safe integer");
    }
    const stored: StoredApprovalGrant = {
      id: generateId("grant"),
      expiresAt: new Date(this.now().getTime() + expiresInMs).toISOString(),
      sessionId: input.sessionId,
      taskId: input.taskId,
      canonicalAction: input.canonicalAction,
      inputHash: inputHash(input.input),
    };
    this.grants.set(stored.id, stored);
    return { id: stored.id, expiresAt: stored.expiresAt };
  }

  consume(grantId: string | undefined, scope: ApprovalGrantScope): boolean {
    if (!grantId) return false;
    const grant = this.grants.get(grantId);
    if (!grant) return false;
    if (Date.parse(grant.expiresAt) <= this.now().getTime()) {
      this.grants.delete(grantId);
      return false;
    }
    if (
      grant.sessionId !== scope.sessionId
      || grant.taskId !== scope.taskId
      || grant.canonicalAction !== scope.canonicalAction
      || grant.inputHash !== inputHash(scope.input)
    ) return false;
    this.grants.delete(grantId);
    return true;
  }
}
