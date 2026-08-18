import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createHookServer,
  AutoApproveApprovalChannel,
  TelegramApprovalChannel,
} from "@warden/hook-server";
import { FileConfigSource } from "@warden/core";
import type { ApprovalChannelConfig, PolicyConfig } from "@warden/core";
import type { ApprovalChannel } from "@warden/hook-server";
import { resolveRuntimeConfig } from "../runtime-config";
import type { RuntimeConfig } from "../runtime-config";

function resolveEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

function createChannelFromConfig(ac: ApprovalChannelConfig): ApprovalChannel | undefined {
  if (ac.telegram?.botToken && ac.telegram?.chatId) {
    const botToken = resolveEnv(ac.telegram.botToken);
    const chatId = resolveEnv(ac.telegram.chatId);
    if (botToken && chatId) {
      process.stderr.write(`Using Telegram approval channel (chat: ${chatId})\n`);
      return new TelegramApprovalChannel(botToken, chatId);
    }
  }

  return undefined;
}

function resolveApprovalChannel(config: PolicyConfig, autoApprove: boolean): { channel?: ApprovalChannel } {
  if (autoApprove) {
    return { channel: new AutoApproveApprovalChannel() };
  }

  const ac = config.approvalChannels;
  if (!ac?.telegram) return {}; // no telegram configured — use the default (StdoutApprovalChannel in createHookServer)

  const channel = createChannelFromConfig(ac);
  return channel ? { channel } : {};
}

export const startCommand = defineCommand({
  meta: {
    name: "start",
    description: "Start the Warden hook server for Claude Code integration",
  },
  args: {
    config: {
      type: "string",
      description: "Path to warden.config.yml",
      default: "warden.config.yml",
    },
    port: {
      type: "string",
      description: "Port to listen on",
      default: "7429",
    },
    db: {
      type: "string",
      description: "Override the ledger database path from warden.config.yml",
      default: "",
    },
    pins: {
      type: "string",
      description: "Path to the supply-chain pins file",
      default: ".warden/pins.json",
    },
    "auto-approve": {
      type: "boolean",
      description: "Auto-approve all confirmation prompts (skip interactive y/N)",
      default: false,
    },
  },
  async run({ args }) {
    const configPath = resolve(args.config);

    if (!existsSync(configPath)) {
      process.stderr.write(`Config file not found: ${configPath}\n`);
      process.stderr.write("Run 'warden init' first to create a config.\n");
      process.exit(1);
    }

    const port = Number.parseInt(args.port, 10);

    const configSource = new FileConfigSource(configPath);
    const config = await configSource.load();
    const runtime = resolveRuntimeConfig(config as PolicyConfig & RuntimeConfig, args.db || undefined);

    if (runtime.dbPath) {
      const dbDir = resolve(runtime.dbPath, "..");
      if (!existsSync(dbDir)) {
        const { mkdirSync } = await import("node:fs");
        mkdirSync(dbDir, { recursive: true });
      }
    }

    if (args["auto-approve"]) {
      process.stderr.write("⚠️  --auto-approve enabled: all confirmations will be automatically approved.\n");
    }

    const { channel } = resolveApprovalChannel(config, args["auto-approve"]);

    const { fetch } = createHookServer({
      config,
      port,
      pinsPath: resolve(args.pins),
      tokenTTLSeconds: runtime.tokenTTLSeconds,
      ...(runtime.dbPath ? { dbPath: resolve(runtime.dbPath) } : {}),
      ...(channel ? { approvalChannel: channel } : {}),
    });

    const bun = (globalThis as unknown as { Bun?: { serve: (opts: { port: number; fetch: typeof fetch }) => { port: number } } }).Bun;

    if (bun) {
      const server = bun.serve({ port, fetch });
      process.stdout.write(`Warden hook server running on http://localhost:${server.port}\n`);
    } else {
      const { createServer } = await import("node:http");
      createServer(async (req, res) => {
        const url = `http://localhost${req.url}`;
        const body = req.method !== "GET" && req.method !== "HEAD"
          ? await new Promise<string>((ok) => {
              let d = ""; req.on("data", (c) => d += c); req.on("end", () => ok(d));
            })
          : undefined;
        const response = await fetch(new Request(url, {
          method: req.method ?? "GET",
          headers: req.headers as Record<string, string>,
          body: body || null,
        }));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      }).listen(port, () => {
        process.stdout.write(`Warden hook server running on http://localhost:${port} (Node.js)\n`);
      });
    }

    process.stdout.write("Press Ctrl+C to stop.\n");
  },
});
