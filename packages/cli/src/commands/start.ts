import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHookServer } from "@wardenlabs/hook-server";
import { FileConfigSource } from "@wardenlabs/core";

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
      description: "Path to SQLite ledger database",
      default: ".warden/ledger.db",
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

    const dbDir = resolve(args.db, "..");
    if (!existsSync(dbDir)) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dbDir, { recursive: true });
    }

    const { fetch } = createHookServer({
      config,
      port,
      dbPath: resolve(args.db),
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
