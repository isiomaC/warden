import { Bot } from "grammy";
import type { ApprovalChannel, ApprovalRequest } from "./types";

export class TelegramApprovalChannel implements ApprovalChannel {
  private bot: Bot | null = null;
  private readonly botToken: string;
  private readonly chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  private getBot(): Bot {
    if (!this.bot) {
      this.bot = new Bot(this.botToken);
    }
    return this.bot;
  }

  async request(req: ApprovalRequest): Promise<boolean> {
    const timeoutMs = Math.min(req.timeoutMs, 60_000);
    const bot = this.getBot();

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: "warden_approve" },
          { text: "Deny", callback_data: "warden_deny" },
        ],
      ],
    };

    const messageText = [
      `[WARDEN CONFIRM] Tool: ${req.tool}`,
      `Reason: ${req.reason}`,
      `Input: ${JSON.stringify(req.input)}`,
    ].join("\n");

    const sent = await bot.api.sendMessage(this.chatId, messageText, {
      reply_markup: inlineKeyboard,
    });

    const messageId = sent.message_id;
    const deadline = Date.now() + timeoutMs;
    let lastUpdateId = 0;

    while (Date.now() < deadline) {
      const remainingSec = Math.max(
        Math.floor((deadline - Date.now()) / 1000),
        0,
      );

      const updates = await bot.api.getUpdates({
        offset: lastUpdateId + 1,
        timeout: Math.min(remainingSec, 10),
        allowed_updates: ["callback_query"],
      });

      for (const update of updates) {
        lastUpdateId = update.update_id;
        const cb = update.callback_query;
        if (
          cb !== undefined &&
          cb.message !== undefined &&
          cb.message.message_id === messageId
        ) {
          await bot.api.answerCallbackQuery(cb.id);
          return cb.data === "warden_approve";
        }
      }
    }

    return false;
  }
}
