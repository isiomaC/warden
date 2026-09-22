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

  it("enables persistent vault storage only when explicitly configured", () => {
    expect(resolveRuntimeConfig({ vault: { persistence: true } })).toMatchObject({
      persistentVaultPath: ".warden/vault.enc",
    });
    expect(resolveRuntimeConfig({ vault: { persistence: true, path: ".warden/session.enc" } }))
      .toMatchObject({ persistentVaultPath: ".warden/session.enc" });
    expect(resolveRuntimeConfig({ vault: { persistence: false } }).persistentVaultPath).toBeUndefined();
  });

  it("rejects invalid persistent vault settings", () => {
    expect(() => resolveRuntimeConfig({ vault: { persistence: "true" as unknown as boolean } })).toThrow("vault.persistence");
    expect(() => resolveRuntimeConfig({ vault: { persistence: true, path: "" } })).toThrow("vault.path");
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
