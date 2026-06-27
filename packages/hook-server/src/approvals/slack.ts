import type { ApprovalChannel, ApprovalRequest } from "./types";

export class SlackApprovalChannel implements ApprovalChannel {
  constructor(private readonly webhookUrl: string) {}

  async request(req: ApprovalRequest): Promise<boolean> {
    const timeoutMs = Math.min(req.timeoutMs, 60_000);

    const payload = {
      text: [
        `*[WARDEN CONFIRM]* Tool: \`${req.tool}\``,
        `>Reason: ${req.reason}`,
        `>\`\`\`${JSON.stringify(req.input)}\`\`\``,
      ].join("\n"),
    };

    // Fire-and-forget the message post — webhook delivery is best-effort.
    fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      // Webhook delivery failed. We still wait the full timeout and deny
      // (fail-closed principle).
    });

    // Polling mechanism: wait the timeout period, then deny.
    // Real interactive approval requires a Slack app with an interactive
    // components callback endpoint — webhooks cannot receive callbacks.
    await new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    return false;
  }
}
