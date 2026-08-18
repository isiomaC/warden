import { describe, expect, it } from "vitest";
import { resolveRuntimeConfig, validateProxyEntries } from "../src/runtime-config";

describe("runtime config wiring", () => {
  it("honors YAML ledger and vault settings", () => {
    expect(resolveRuntimeConfig({
      ledger: { type: "sqlite", path: ".warden/custom.db" },
      vault: { tokenTTLSeconds: 900 },
    })).toEqual({ dbPath: ".warden/custom.db", tokenTTLSeconds: 900 });
  });

  it("supports an explicitly in-memory ledger", () => {
    expect(resolveRuntimeConfig({ ledger: { type: "memory" } })).toEqual({
      tokenTTLSeconds: 3600,
    });
  });

  it("lets an explicit CLI database path override YAML", () => {
    expect(resolveRuntimeConfig(
      { ledger: { type: "sqlite", path: ".warden/config.db" } },
      ".warden/flag.db",
    ).dbPath).toBe(".warden/flag.db");
  });

  it("rejects proxy entries without a transport endpoint", () => {
    expect(validateProxyEntries([
      { name: "local", transport: "stdio", allowedTools: ["read"] },
      { name: "remote", transport: "http", allowedTools: ["search"] },
    ])).toEqual([
      'MCP server "local" uses stdio but has no command.',
      'MCP server "remote" uses HTTP but has no url.',
    ]);
  });
});
