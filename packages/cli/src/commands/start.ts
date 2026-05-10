import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHookServer } from "@wardenlabs/hook-server";

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
  },
  async run({ args }) {
    const configPath = resolve(args.config);

    if (!existsSync(configPath)) {
      process.stderr.write(`Config file not found: ${configPath}\n`);
      process.stderr.write("Run 'warden init' first to create a config.\n");
      process.exit(1);
    }

    const port = Number.parseInt(args.port, 10);

    const { fetch } = createHookServer({
      config: {
        version: "2",
        meta: {
          environment: "development",
          sessionApprovalRequired: false,
        },
        policies: [
          {
            id: "block-prod-writes",
            description: "No writes to production",
            match: { tools: ["write_file", "db_write"], environment: ["production"] },
            action: "DENY",
          },
          {
            id: "confirm-destructive",
            description: "Confirm destructive ops",
            match: { tools: ["delete_file", "git_push", "send_email"] },
            action: "CONFIRM",
            channel: "stdout",
          },
          {
            id: "block-shell-injection",
            description: "Block shell injection",
            match: {
              tool: "Bash",
              inputPatterns: ["rm\\s+-rf", "curl.*\\|.*sh", "eval\\s*\\(", "wget.*\\|.*sh", "base64.*decode"],
            },
            action: "DENY",
          },
          {
            id: "allow-read-development",
            description: "Allow reads in development",
            match: {
              tools: ["read_file", "list_directory", "query"],
              trustSource: [3, 2, 1],
              environment: ["staging", "development"],
            },
            action: "ALLOW",
          },
        ],
      },
      port,
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
