/**
 * Warden Approval Channels Example
 *
 * Demonstrates the two approval channel implementations:
 * - StdoutApprovalChannel: interactive stdin prompt with timeout
 * - TelegramApprovalChannel: grammy bot with inline keyboard
 *
 * Run: npx tsx examples/approval-channels/index.ts
 */

import {
  StdoutApprovalChannel,
  TelegramApprovalChannel,
} from "@warden/hook-server";

const approvalRequest = {
  tool: "delete_file",
  input: { path: "/tmp/important-data.txt" },
  reason: "Policy: confirm-destructive — Destructive operation requires human approval",
  timeoutMs: 60_000,
  environment: "production",
  sessionId: "example-session",
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
  console.log("   Skipped — set WARDEN_TELEGRAM_TOKEN and WARDEN_TELEGRAM_CHAT_ID env vars\n");
}

// ---- Comparison ----
console.log("Channel comparison:");
console.log("  Stdout:   local dev, interactive stdin, bounded at 60s");
console.log("  Telegram: remote approval, async bot with inline buttons, bounded at 60s");
console.log("\nAll channels implement ApprovalChannel interface — swappable at init.");
