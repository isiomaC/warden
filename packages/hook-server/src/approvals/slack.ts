import type { ApprovalChannel, ApprovalRequest } from "./types";

/**
 * Notify-only Slack channel. Incoming webhooks can post a message but cannot
 * receive the click response back — Slack interactivity requires a bot with
 * an Events API / interactive-components callback endpoint, which this class
 * does not implement. Every `request()` call posts a notification, waits out
 * the full timeout, and then denies (fail-closed). Do not configure this as
 * your only CONFIRM channel if you need a human to actually be able to
 * approve a tool call — use `TelegramApprovalChannel` or `StdoutApprovalChannel`
 * for that, or implement a real Slack Events API listener.
 */
export class SlackApprovalChannel implements ApprovalChannel {
  constructor(private readonly webhookUrl: string) {
    process.stderr.write(
      "[WARDEN] WARNING: SlackApprovalChannel is notify-only — it cannot receive Slack " +
        "button clicks and will always auto-deny after the CONFIRM timeout. Use " +
        "TelegramApprovalChannel or StdoutApprovalChannel if you need real interactive approval.\n",
    );
  }

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
