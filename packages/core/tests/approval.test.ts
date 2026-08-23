import { describe, expect, it } from "vitest";
import { createApprovalRequest, resolveApproval } from "../src/approval";

describe("generic approval contract", () => {
  it("records authenticated requester and approver evidence", () => {
    const request = createApprovalRequest({
      requestId: "approval-1",
      requesterId: "actor-1",
      action: { type: "document.delete" },
      resource: { id: "document-1" },
      requestedAt: "2026-08-23T00:00:00.000Z",
      expiresAt: "2026-08-23T00:05:00.000Z",
    });

    expect(resolveApproval(request, {
      decision: "APPROVED",
      approverId: "human-1",
      resolvedAt: "2026-08-23T00:01:00.000Z",
    })).toMatchObject({ status: "APPROVED", approverId: "human-1" });
  });

  it("fails closed for expired and already-resolved requests", () => {
    const request = createApprovalRequest({
      requestId: "approval-1",
      requesterId: "actor-1",
      action: {},
      resource: {},
      requestedAt: "2026-08-23T00:00:00.000Z",
      expiresAt: "2026-08-23T00:01:00.000Z",
    });
    expect(() => resolveApproval(request, {
      decision: "APPROVED",
      approverId: "human-1",
      resolvedAt: "2026-08-23T00:02:00.000Z",
    })).toThrow(/expired/i);

    const resolved = resolveApproval(request, {
      decision: "REJECTED",
      approverId: "human-1",
      resolvedAt: "2026-08-23T00:00:30.000Z",
    });
    expect(() => resolveApproval(resolved, {
      decision: "APPROVED",
      approverId: "human-2",
      resolvedAt: "2026-08-23T00:00:40.000Z",
    })).toThrow(/resolved/i);
  });
});
