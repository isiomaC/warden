import { describe, expect, it } from "vitest";
import { resolveApprovalChannel } from "../src/commands/start.js";

describe("warden start", () => {
  it("selects the signed webhook channel when webhook is the only configured channel", async () => {
    const { channel } = resolveApprovalChannel({
      version: "2",
      meta: { environment: "staging", sessionApprovalRequired: true },
      policies: [],
      approvalChannels: {
        webhook: {
          requestUrl: "https://approvals.example.test/warden/requests",
          statusUrl: "https://approvals.example.test/warden/status",
          sharedSecret: "test-webhook-secret",
        },
      },
    }, false);

    expect(channel?.channel).toBe("webhook");
  }, 10_000);
});
