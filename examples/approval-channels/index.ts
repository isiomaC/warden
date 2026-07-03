/**
 * Warden Approval Channels Example
 *
 * Demonstrates the three approval channel implementations:
 * - StdoutApprovalChannel: interactive stdin prompt with timeout
 * - TelegramApprovalChannel: grammy bot with inline keyboard
 * - SlackApprovalChannel: webhook with fail-closed
 *
 * Run: npx tsx examples/approval-channels/index.ts
 */

import {
  StdoutApprovalChannel,
  TelegramApprovalChannel,
  SlackApprovalChannel,
} from "@warden/hook-server/approvals";

const approvalRequest = {
  tool: "delete_file",
  input: { path: "/tmp/important-data.txt" },
  reason: "Policy: confirm-destructive — Destructive operation requires human approval",
  timeoutMs: 60_000,
};

console.log("=== Warden Approval Channels ===\n");

// ---- 1. Stdout Channel ----
console.log("1. StdoutApprovalChannel — interactive stdin prompt\n");

const stdout = new StdoutApprovalChannel();
console.log("   Prompting user on stdin...\n");

const stdoutResult = await stdout.request(approvalRequest);
console.log(`\n   Result: ${stdoutResult ? "APPROVED" : "DENIED"}\n`);

// ---- 2. Telegram Channel ----
console.log("2. TelegramApprovalChannel — grammy bot with inline keyboard\n");

const botToken = process.env.WARDEN_TELEGRAM_TOKEN;
const chatId = process.env.WARDEN_TELEGRAM_CHAT_ID;

if (botToken && chatId) {
  const telegram = new TelegramApprovalChannel(botToken, chatId);
  console.log("   Sending to Telegram...");
  console.log(`   Bot will ask: "${approvalRequest.reason}"`);
  console.log("   Inline buttons: [Approve] [Deny]");
  console.log("   Waiting for human response (max 60s)...\n");

  const telegramResult = await telegram.request(approvalRequest);
  console.log(`   Result: ${telegramResult ? "APPROVED" : "DENIED"}\n`);
} else {
  console.log("   ⚠️  Skipped — set WARDEN_TELEGRAM_TOKEN and WARDEN_TELEGRAM_CHAT_ID env vars\n");
}

// ---- 3. Slack Channel ----
console.log("3. SlackApprovalChannel — webhook with fail-closed\n");

const slackWebhook = process.env.WARDEN_SLACK_WEBHOOK;

if (slackWebhook) {
  const slack = new SlackApprovalChannel(slackWebhook);
  console.log("   Posting to Slack webhook...");
  console.log("   (Webhook-only — always returns DENY after timeout)");
  console.log("   For real interactive approval, use a Slack app with callback endpoint.\n");

  const slackResult = await slack.request(approvalRequest);
  console.log(`   Result: ${slackResult ? "APPROVED" : "DENIED (fail-closed)"}\n`);
} else {
  console.log("   ⚠️  Skipped — set WARDEN_SLACK_WEBHOOK env var\n");
}

// ---- Comparison ----
console.log("Channel comparison:");
console.log("  Stdout:   local dev, interactive stdin, bounded at 60s");
console.log("  Telegram: remote approval, async bot, bounded at 60s");
console.log("  Slack:    remote approval, webhook fire-and-forget, fail-closed");
console.log("\nAll channels implement ApprovalChannel interface — swappable at init.");
