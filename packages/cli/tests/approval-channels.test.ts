import { describe, expect, it } from "vitest";
import { createProxyApprovalChannels } from "../src/approval-channels.js";

describe("createProxyApprovalChannels", () => {
  it("resolves Telegram credentials and preserves the approver allow-list", () => {
    const channels = createProxyApprovalChannels({
      telegram: {
        botToken: "${BOT_TOKEN}",
        chatId: "${CHAT_ID}",
        approverUserIds: [123, 456],
      },
    }, { BOT_TOKEN: "test-token", CHAT_ID: "-10001" });

    expect(channels.telegram).toMatchObject({ channel: "telegram" });
    expect((channels.telegram as unknown as { approverUserIds: Set<number> }).approverUserIds)
      .toEqual(new Set([123, 456]));
  });

  it("creates a webhook channel only when all required settings resolve", () => {
    expect(createProxyApprovalChannels({ webhook: {
      requestUrl: "${REQUEST_URL}",
      statusUrl: "${STATUS_URL}",
      sharedSecret: "${WEBHOOK_SECRET}",
    } }, {
      REQUEST_URL: "https://example.test/request",
      STATUS_URL: "https://example.test/status",
      WEBHOOK_SECRET: "secret",
    }).webhook).toMatchObject({ channel: "webhook" });

    expect(createProxyApprovalChannels({ webhook: {
      requestUrl: "${REQUEST_URL}", statusUrl: "${STATUS_URL}", sharedSecret: "${WEBHOOK_SECRET}",
    } }, {}).webhook).toBeUndefined();
  });
});
