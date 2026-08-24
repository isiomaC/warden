export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ApprovalRequestInput<Action = unknown, Resource = unknown> {
  requestId: string;
  requesterId: string;
  action: Action;
  resource: Resource;
  requestedAt: string;
  expiresAt: string;
}

export interface ApprovalRequest<Action = unknown, Resource = unknown> extends ApprovalRequestInput<Action, Resource> {
  status: ApprovalStatus;
  approverId?: string;
  resolvedAt?: string;
}

export interface ApprovalResolution {
  decision: "APPROVED" | "REJECTED";
  approverId: string;
  resolvedAt: string;
}

function timestamp(value: string, field: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new TypeError(`${field} must be an ISO timestamp`);
  return result;
}

export function createApprovalRequest<Action, Resource>(
  input: ApprovalRequestInput<Action, Resource>,
): ApprovalRequest<Action, Resource> {
  if (!input.requestId || !input.requesterId) throw new TypeError("Approval request and requester ids are required");
  if (timestamp(input.expiresAt, "expiresAt") <= timestamp(input.requestedAt, "requestedAt")) {
    throw new TypeError("Approval expiry must follow its request time");
  }
  return { ...structuredClone(input), status: "PENDING" };
}

export function resolveApproval<Action, Resource>(
  request: ApprovalRequest<Action, Resource>,
  resolution: ApprovalResolution,
): ApprovalRequest<Action, Resource> {
  if (request.status !== "PENDING") throw new Error("Approval request is already resolved");
  if (!resolution.approverId) throw new TypeError("Authenticated approver id is required");
  const resolvedAt = timestamp(resolution.resolvedAt, "resolvedAt");
  if (resolvedAt > timestamp(request.expiresAt, "expiresAt")) throw new Error("Approval request has expired");
  if (resolvedAt < timestamp(request.requestedAt, "requestedAt")) throw new Error("Approval cannot predate its request");
  return {
    ...structuredClone(request),
    status: resolution.decision,
    approverId: resolution.approverId,
    resolvedAt: resolution.resolvedAt,
  };
}
