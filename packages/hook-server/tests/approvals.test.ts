import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  StdoutApprovalChannel,
  TimeoutApprovalChannel,
  TelegramApprovalChannel,
  SlackApprovalChannel,
} from "../src/approvals/index";
import { WebhookApprovalChannel } from "../src/approvals/index";
import type { ApprovalRequest } from "../src/approvals/index";

// ---------------------------------------------------------------------------
// Shared mock state — vi.hoisted runs before all module-level code
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  readlineQuestion: vi.fn<(query: string, cb: (answer: string) => void) => void>(),
  readlineClose: vi.fn(),
  telegramSendMessage: vi.fn(),
  telegramGetUpdates: vi.fn(),
  telegramAnswerCallbackQuery: vi.fn(),
}));

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: mocks.readlineQuestion,
    close: mocks.readlineClose,
  }),
}));

vi.mock("grammy", () => {
  class MockBot {
    api = {
      sendMessage: mocks.telegramSendMessage,
      getUpdates: mocks.telegramGetUpdates,
      answerCallbackQuery: mocks.telegramAnswerCallbackQuery,
    };
  }
  const BotSpy = vi.fn((_token: string) => {
    return new MockBot();
  });
  return { Bot: BotSpy };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    tool: "delete_file",
    input: { path: "/tmp/test.txt" },
    reason: "destructive operation requires approval",
    timeoutMs: 100, // short timeout for tests
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TimeoutApprovalChannel (baseline)
// ---------------------------------------------------------------------------

describe("TimeoutApprovalChannel", () => {
  it("should deny after the timeout", async () => {
    const channel = new TimeoutApprovalChannel();
    const result = await channel.request(makeReq({ timeoutMs: 50 }));
    expect(result).toBe(false);
  });

  it("should cap at 60 seconds", async () => {
    const channel = new TimeoutApprovalChannel();
    const started = Date.now();
    const result = await channel.request(makeReq({ timeoutMs: 50 }));
    expect(result).toBe(false);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5_000);
  });
});

// ---------------------------------------------------------------------------
// StdoutApprovalChannel
// ---------------------------------------------------------------------------

describe("StdoutApprovalChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should approve when user types "y"', async () => {
    mocks.readlineQuestion.mockImplementation(
      (_query: string, cb: (answer: string) => void) => {
        cb("y");
      },
    );

    const channel = new StdoutApprovalChannel();
    const result = await channel.request(makeReq());
    expect(result).toBe(true);
    expect(mocks.readlineClose).toHaveBeenCalled();
  });

  it('should approve when user types "yes"', async () => {
    mocks.readlineQuestion.mockImplementation(
      (_query: string, cb: (answer: string) => void) => {
        cb("  yes  ");
      },
    );

    const channel = new StdoutApprovalChannel();
    const result = await channel.request(makeReq());
    expect(result).toBe(true);
  });

  it('should deny when user types "n"', async () => {
    mocks.readlineQuestion.mockImplementation(
      (_query: string, cb: (answer: string) => void) => {
        cb("n");
      },
    );

    const channel = new StdoutApprovalChannel();
    const result = await channel.request(makeReq());
    expect(result).toBe(false);
  });

  it("should deny when user types anything else", async () => {
    mocks.readlineQuestion.mockImplementation(
      (_query: string, cb: (answer: string) => void) => {
        cb("maybe");
      },
    );

    const channel = new StdoutApprovalChannel();
    const result = await channel.request(makeReq());
    expect(result).toBe(false);
  });

  it("should deny on empty input (just pressing Enter)", async () => {
    mocks.readlineQuestion.mockImplementation(
      (_query: string, cb: (answer: string) => void) => {
        cb("");
      },
    );

    const channel = new StdoutApprovalChannel();
    const result = await channel.request(makeReq());
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TelegramApprovalChannel
// ---------------------------------------------------------------------------

describe("TelegramApprovalChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should approve when callback_data is warden_approve", async () => {
    mocks.telegramSendMessage.mockResolvedValue({ message_id: 42 });

    // First call returns the callback, second call returns empty (loop ends)
    mocks.telegramGetUpdates
      .mockResolvedValueOnce([
        {
          update_id: 1,
          callback_query: {
            id: "cb_1",
            data: "warden_approve",
            message: { message_id: 42 },
          },
        },
      ])
      .mockResolvedValue([]);

    const channel = new TelegramApprovalChannel("token", "chat-123");
    const result = await channel.request(makeReq());

    expect(result).toBe(true);
    expect(mocks.telegramSendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.telegramAnswerCallbackQuery).toHaveBeenCalledWith("cb_1");
  });

  it("should deny when callback_data is warden_deny", async () => {
    mocks.telegramSendMessage.mockResolvedValue({ message_id: 42 });

    mocks.telegramGetUpdates
      .mockResolvedValueOnce([
        {
          update_id: 2,
          callback_query: {
            id: "cb_2",
            data: "warden_deny",
            message: { message_id: 42 },
          },
        },
      ])
      .mockResolvedValue([]);

    const channel = new TelegramApprovalChannel("token", "chat-456");
    const result = await channel.request(makeReq());

    expect(result).toBe(false);
  });

  it("should deny on timeout (no callback received)", async () => {
    mocks.telegramSendMessage.mockResolvedValue({ message_id: 42 });
    mocks.telegramGetUpdates.mockResolvedValue([]);

    const channel = new TelegramApprovalChannel("token", "chat-789");
    const result = await channel.request(makeReq({ timeoutMs: 100 }));

    expect(result).toBe(false);
  });

  it("should ignore callbacks for other messages", async () => {
    mocks.telegramSendMessage.mockResolvedValue({ message_id: 42 });

    mocks.telegramGetUpdates
      .mockResolvedValueOnce([
        {
          update_id: 3,
          callback_query: {
            id: "cb_3",
            data: "warden_approve",
            message: { message_id: 99 }, // different message
          },
        },
      ])
      .mockResolvedValue([]);

    const channel = new TelegramApprovalChannel("token", "chat-0");
    const result = await channel.request(makeReq({ timeoutMs: 100 }));

    expect(result).toBe(false);
  });

  it("should lazily create the Bot instance", async () => {
    mocks.telegramSendMessage.mockResolvedValue({ message_id: 1 });
    mocks.telegramGetUpdates.mockResolvedValue([]);

    const channel = new TelegramApprovalChannel("lazy-token", "lazy-chat");
    await channel.request(makeReq({ timeoutMs: 50 }));

    const { Bot: MockBot } = await import("grammy");
    expect(MockBot).toHaveBeenCalledTimes(1);
    expect(MockBot).toHaveBeenCalledWith("lazy-token");
  });
});

// ---------------------------------------------------------------------------
// SlackApprovalChannel
// ---------------------------------------------------------------------------

describe("SlackApprovalChannel", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should deny after timeout (webhooks cannot receive callbacks)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "ok",
    });
    globalThis.fetch = mockFetch;

    const channel = new SlackApprovalChannel("https://hooks.slack.com/test");
    const started = Date.now();
    const result = await channel.request(makeReq({ timeoutMs: 100 }));

    expect(result).toBe(false);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(90);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("should still deny when webhook fetch fails (fail-closed)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    globalThis.fetch = mockFetch;

    const channel = new SlackApprovalChannel("https://hooks.slack.com/bad");
    const result = await channel.request(makeReq({ timeoutMs: 50 }));

    expect(result).toBe(false);
  });

  it("should respect timeoutMs cap of 60s", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = mockFetch;

    const channel = new SlackApprovalChannel("https://hooks.slack.com/test");
    const started = Date.now();
    const result = await channel.request(makeReq({ timeoutMs: 50 }));

    expect(result).toBe(false);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5_000);
  });
});

// ---------------------------------------------------------------------------
// WebhookApprovalChannel
// ---------------------------------------------------------------------------

describe("WebhookApprovalChannel", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should approve when poll endpoint returns approved", async () => {
    const mockFetch = vi.fn(async (url: unknown, _init?: unknown) => {
      const urlStr = typeof url === "string" ? url : String(url);

      if (urlStr === "https://webhook.example.com/warden/approve") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr === "https://webhook.example.com/warden/status") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "approved" }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const channel = new WebhookApprovalChannel(
      "https://webhook.example.com/warden/approve",
      "https://webhook.example.com/warden/status",
    );
    const result = await channel.request(makeReq({ timeoutMs: 5000 }));

    expect(result).toBe(true);
  });

  it("should deny when poll endpoint returns denied", async () => {
    const mockFetch = vi.fn(async (url: unknown, _init?: unknown) => {
      const urlStr = typeof url === "string" ? url : String(url);

      if (urlStr === "https://webhook.example.com/warden/approve") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr === "https://webhook.example.com/warden/status") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "denied" }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const channel = new WebhookApprovalChannel(
      "https://webhook.example.com/warden/approve",
      "https://webhook.example.com/warden/status",
    );
    const result = await channel.request(makeReq({ timeoutMs: 5000 }));

    expect(result).toBe(false);
  });

  it("should deny on timeout (poll never approves or denies)", async () => {
    const mockFetch = vi.fn(async (url: unknown, _init?: unknown) => {
      const urlStr = typeof url === "string" ? url : String(url);

      if (urlStr === "https://webhook.example.com/warden/approve") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr === "https://webhook.example.com/warden/status") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "pending" }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const channel = new WebhookApprovalChannel(
      "https://webhook.example.com/warden/approve",
      "https://webhook.example.com/warden/status",
    );
    const started = Date.now();
    const result = await channel.request(makeReq({ timeoutMs: 100 }));

    expect(result).toBe(false);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });

  it("should deny when poll endpoint returns non-ok status", async () => {
    const mockFetch = vi.fn(async (url: unknown, _init?: unknown) => {
      const urlStr = typeof url === "string" ? url : String(url);

      if (urlStr === "https://webhook.example.com/warden/approve") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr === "https://webhook.example.com/warden/status") {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: "internal" }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const channel = new WebhookApprovalChannel(
      "https://webhook.example.com/warden/approve",
      "https://webhook.example.com/warden/status",
    );
    const result = await channel.request(makeReq({ timeoutMs: 100 }));

    expect(result).toBe(false);
  });

  it("should deny when poll endpoint fetch throws (network error)", async () => {
    const mockFetch = vi.fn(async (url: unknown, _init?: unknown) => {
      const urlStr = typeof url === "string" ? url : String(url);

      if (urlStr === "https://webhook.example.com/warden/approve") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr === "https://webhook.example.com/warden/status") {
        throw new Error("ECONNREFUSED");
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const channel = new WebhookApprovalChannel(
      "https://webhook.example.com/warden/approve",
      "https://webhook.example.com/warden/status",
    );
    const result = await channel.request(makeReq({ timeoutMs: 100 }));

    expect(result).toBe(false);
  });

  it("should respect timeoutMs cap of 60 seconds", async () => {
    const mockFetch = vi.fn(async (url: unknown, _init?: unknown) => {
      const urlStr = typeof url === "string" ? url : String(url);

      if (urlStr === "https://webhook.example.com/warden/approve") {
        return { ok: true, status: 200, json: async () => ({}) };
      }
      if (urlStr === "https://webhook.example.com/warden/status") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "pending" }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const channel = new WebhookApprovalChannel(
      "https://webhook.example.com/warden/approve",
      "https://webhook.example.com/warden/status",
    );
    const started = Date.now();
    const result = await channel.request(makeReq({ timeoutMs: 50 }));

    expect(result).toBe(false);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(5_000);
  });

  it("should still deny on timeout when webhook POST fails (fail-closed)", async () => {
    const mockFetch = vi.fn(async (url: unknown, _init?: unknown) => {
      const urlStr = typeof url === "string" ? url : String(url);

      if (urlStr === "https://webhook.example.com/warden/approve") {
        throw new Error("network error");
      }
      if (urlStr === "https://webhook.example.com/warden/status") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "pending" }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

    const channel = new WebhookApprovalChannel(
      "https://webhook.example.com/warden/approve",
      "https://webhook.example.com/warden/status",
    );
    const result = await channel.request(makeReq({ timeoutMs: 50 }));

    expect(result).toBe(false);
  });
});
