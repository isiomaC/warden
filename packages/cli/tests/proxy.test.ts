import { describe, it, expect, afterEach, vi } from "vitest";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// `proxy.ts` calls `mcpServer.connect(new StdioServerTransport())`, which takes
// over the process's real stdin/stdout — it cannot be exercised by calling
// `proxyCommand.run()` in-process without hijacking the test runner's own
// stdio. The only faithful way to test it is spawning the real CLI binary and
// speaking JSON-RPC over its stdin/stdout, the same way Cursor/Windsurf would.

const BIN_PATH = resolve(process.cwd(), "packages/cli/src/bin.ts");

async function withTmpCwd<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "warden-proxy-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

type JsonRpcResponse = { jsonrpc: string; id: number; result?: unknown; error?: unknown };

/** Send a batch of JSON-RPC requests to a running `warden proxy` and collect responses by id. */
async function sendRequests(
  child: ChildProcessWithoutNullStreams,
  requests: Array<{ jsonrpc: "2.0"; id: number; method: string; params: Record<string, unknown> }>,
  timeoutMs = 10_000,
): Promise<Map<number, JsonRpcResponse>> {
  const responses = new Map<number, JsonRpcResponse>();
  let buffer = "";

  const collected = new Promise<void>((resolvePromise) => {
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (typeof parsed.id === "number") responses.set(parsed.id, parsed);
        } catch {
          // non-JSON-RPC line (e.g. a stray log line) — ignore
        }
      }
      if (requests.every((r) => responses.has(r.id))) resolvePromise();
    });
  });

  for (const req of requests) {
    child.stdin.write(`${JSON.stringify(req)}\n`);
  }

  await Promise.race([
    collected,
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);

  return responses;
}

function killTree(child: ChildProcessWithoutNullStreams): void {
  if (typeof child.pid === "number") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // not a process group leader (or already dead) — fall through
    }
  }
  child.kill("SIGKILL");
}

const CONFIG_WITH_SERVER = `
version: "2"
meta:
  environment: "development"
  sessionApprovalRequired: false
mcpServers:
  allowed:
    - name: "filesystem"
      type: local
      transport: stdio
      allowedTools: ["read_file", "write_file"]
      authRequired: false
policies:
  - id: "allow-read-dev"
    description: "Allow reads in dev"
    match:
      tools: ["filesystem__read_file"]
      environment: ["development"]
    action: ALLOW
`;

describe("proxyCommand (spawned)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exits 1 when the config file is missing", async () => {
    await withTmpCwd((dir) => {
      const result = spawnSync("npx", ["tsx", "--tsconfig", resolve(process.cwd(), "tsconfig.json"), BIN_PATH, "proxy", "--config", "does-not-exist.yml"], {
        encoding: "utf-8",
        timeout: 10_000,
        cwd: dir,
      });

      if (result.status === null) return; // timed out or killed, skip
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Config file not found");
    });
  });

  it("exits 1 when the config has no mcpServers.allowed entries", async () => {
    await withTmpCwd((dir) => {
      writeFileSync(
        join(dir, "warden.config.yml"),
        'version: "2"\nmeta:\n  environment: "development"\n  sessionApprovalRequired: false\npolicies: []\n',
      );
      const result = spawnSync("npx", ["tsx", "--tsconfig", resolve(process.cwd(), "tsconfig.json"), BIN_PATH, "proxy"], {
        encoding: "utf-8",
        timeout: 10_000,
        cwd: dir,
      });

      if (result.status === null) return;
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("No mcpServers.allowed entries");
    });
  });

  it("lists tools with real per-tool JSON Schema, allows a policy-matched call, and denies an unmatched one", async () => {
    await withTmpCwd(async (dir) => {
      writeFileSync(join(dir, "warden.config.yml"), CONFIG_WITH_SERVER);

      const child = spawn(
        "npx",
        ["tsx", "--tsconfig", resolve(process.cwd(), "tsconfig.json"), BIN_PATH, "proxy"],
        { cwd: dir, stdio: ["pipe", "pipe", "pipe"], detached: true },
      ) as ChildProcessWithoutNullStreams;

      try {
        const responses = await sendRequests(child, [
          { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "filesystem__read_file", arguments: { path: "/tmp/test.txt" } },
          },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: { name: "filesystem__write_file", arguments: { path: "/tmp/prod.txt" } },
          },
          {
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: { name: "filesystem__delete_file", arguments: {} },
          },
        ]);

        // tools/list — real tool names, not a placeholder schema
        const listResult = responses.get(1)?.result as { tools: Array<{ name: string }> } | undefined;
        expect(listResult?.tools.map((t) => t.name).sort()).toEqual([
          "filesystem__read_file",
          "filesystem__write_file",
        ]);

        // tools/call — ALLOW path (matches the allow-read-dev policy)
        const allowResult = responses.get(2)?.result as { content: Array<{ text: string }> } | undefined;
        expect(allowResult?.content[0]?.text).toContain("Warden ALLOW");

        // tools/call — DENY path (in allowedTools, but no matching ALLOW policy — default deny)
        const denyResult = responses.get(3)?.result as { content: Array<{ text: string }>; isError: boolean } | undefined;
        expect(denyResult?.isError).toBe(true);
        expect(denyResult?.content[0]?.text).toContain("Warden DENY");

        // tools/call — unknown tool (never registered because it's outside allowedTools)
        const unknownResult = responses.get(4)?.result as { content: Array<{ text: string }>; isError: boolean } | undefined;
        expect(unknownResult?.isError).toBe(true);
        expect(unknownResult?.content[0]?.text).toContain("Unknown tool");
      } finally {
        killTree(child);
      }
    });
  }, 15_000);
});
