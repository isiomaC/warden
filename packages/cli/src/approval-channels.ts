import { TelegramApprovalChannel, WebhookApprovalChannel } from "@stlw/warden-hook-server";
import type { ApprovalChannel } from "@stlw/warden-hook-server";

export interface ProxyApprovalConfig {
  telegram?: { botToken?: string; chatId?: string; approverUserIds?: number[] };
  webhook?: { requestUrl?: string; statusUrl?: string; sharedSecret?: string };
}

function resolveEnv(value: string, environment: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => environment[name] ?? "");
}

export function createProxyApprovalChannels(
  config: ProxyApprovalConfig | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): Partial<Record<"telegram" | "webhook", ApprovalChannel>> {
  const telegram = config?.telegram;
  const botToken = telegram?.botToken ? resolveEnv(telegram.botToken, environment) : "";
  const chatId = telegram?.chatId ? resolveEnv(telegram.chatId, environment) : "";
  const webhook = config?.webhook;
  const requestUrl = webhook?.requestUrl ? resolveEnv(webhook.requestUrl, environment) : "";
  const statusUrl = webhook?.statusUrl ? resolveEnv(webhook.statusUrl, environment) : "";
  const sharedSecret = webhook?.sharedSecret ? resolveEnv(webhook.sharedSecret, environment) : "";

  return {
    ...(botToken && chatId ? {
      telegram: new TelegramApprovalChannel(botToken, chatId, telegram?.approverUserIds),
    } : {}),
    ...(requestUrl && statusUrl && sharedSecret ? {
      webhook: new WebhookApprovalChannel(requestUrl, statusUrl, sharedSecret),
    } : {}),
  };
}
