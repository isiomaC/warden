import type { ApprovalChannel, ApprovalRequest } from "./types.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { generateId } from "@stlw/warden";

function signature(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function signaturesMatch(expected: string, actual: unknown): boolean {
  if (typeof actual !== "string" || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export class WebhookApprovalChannel implements ApprovalChannel {
  readonly channel = "webhook" as const;
  constructor(
    private readonly webhookUrl: string,
    private readonly pollUrl: string,
    private readonly sharedSecret?: string,
  ) {}

  async request(req: ApprovalRequest): Promise<boolean> {
    const timeoutMs = Math.min(req.timeoutMs, 60_000);
    const requestId = req.requestId ?? generateId("approval");

    const payload = {
      requestId,
      tool: req.tool,
      reason: req.reason,
      input: req.input,
    };

    // Fire-and-forget the approval request POST
    const payloadText = JSON.stringify(payload);
    fetch(this.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.sharedSecret ? { "X-Warden-Approval-Signature": signature(this.sharedSecret, payloadText) } : {}),
      },
      body: payloadText,
    }).catch(() => {
      // Webhook delivery failed. Continue polling and apply
      // fail-closed principle on timeout.
    });

    // Poll the status endpoint until approved, denied, or timeout
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const remainingMs = Math.max(deadline - Date.now(), 0);
      const pollInterval = Math.min(remainingMs, 2_000);

      try {
        const response = await fetch(this.pollUrl, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Warden-Approval-Request-Id": requestId,
            ...(this.sharedSecret ? { "X-Warden-Approval-Signature": signature(this.sharedSecret, requestId) } : {}),
          },
        });

        if (response.ok) {
          const body = (await response.json()) as {
            requestId: string;
            status: string;
            signature?: string;
          };

          if (body.requestId !== requestId) return false;
          if (this.sharedSecret && !signaturesMatch(
            signature(this.sharedSecret, `${body.requestId}:${body.status}`),
            body.signature,
          )) return false;
          if (body.status === "approved") return true;
          if (body.status === "denied") return false;
        }
      } catch {
        // Poll request failed; wait and retry
      }

      // Wait before next poll
      await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
    }

    return false;
  }
}
