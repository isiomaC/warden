import type { ApprovalChannel, ApprovalRequest } from "./types";

export class WebhookApprovalChannel implements ApprovalChannel {
  constructor(
    private readonly webhookUrl: string,
    private readonly pollUrl: string,
  ) {}

  async request(req: ApprovalRequest): Promise<boolean> {
    const timeoutMs = Math.min(req.timeoutMs, 60_000);

    const payload = {
      tool: req.tool,
      reason: req.reason,
      input: req.input,
    };

    // Fire-and-forget the approval request POST
    fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
          headers: { Accept: "application/json" },
        });

        if (response.ok) {
          const body = (await response.json()) as {
            status: string;
          };

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
