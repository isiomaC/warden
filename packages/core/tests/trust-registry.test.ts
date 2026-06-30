import { describe, it, expect } from "vitest";
import { TrustRegistry } from "../src/trust-registry";
import { TrustLevel } from "../src/trust";

describe("TrustRegistry", () => {
  it("should register and lookup a value", () => {
    const reg = new TrustRegistry();
    reg.register("file content from web", TrustLevel.EXTERNAL, "read_file");
    expect(reg.lookup("file content from web")).toBe(TrustLevel.EXTERNAL);
  });

  it("should return undefined for unregistered values", () => {
    const reg = new TrustRegistry();
    expect(reg.lookup("unknown")).toBeUndefined();
  });

  it("should register different values separately", () => {
    const reg = new TrustRegistry();
    reg.register("trusted output", TrustLevel.TOOL, "mcp__filesystem");
    reg.register("untrusted output", TrustLevel.EXTERNAL, "web_scrape");
    expect(reg.lookup("trusted output")).toBe(TrustLevel.TOOL);
    expect(reg.lookup("untrusted output")).toBe(TrustLevel.EXTERNAL);
  });

  it("should clear all registrations", () => {
    const reg = new TrustRegistry();
    reg.register("value", TrustLevel.EXTERNAL, "test");
    expect(reg.lookup("value")).toBe(TrustLevel.EXTERNAL);
    reg.clear();
    expect(reg.lookup("value")).toBeUndefined();
  });

  it("should handle object values", () => {
    const reg = new TrustRegistry();
    const obj = { path: "/etc/passwd", content: "secret" };
    reg.register(obj, TrustLevel.EXTERNAL, "read_file");
    expect(reg.lookup(obj)).toBe(TrustLevel.EXTERNAL);
  });

  it("should not overwrite existing registrations", () => {
    const reg = new TrustRegistry();
    reg.register("shared value", TrustLevel.EXTERNAL, "source-a");
    reg.register("shared value", TrustLevel.SYSTEM, "source-b");
    expect(reg.lookup("shared value")).toBe(TrustLevel.EXTERNAL);
  });

  it("should log a warning when a re-registration attempts a different trust level", () => {
    const warnings: Array<[string, Record<string, unknown> | undefined]> = [];
    const logger = { warn: (msg: string, ctx?: Record<string, unknown>) => warnings.push([msg, ctx]) };
    const reg = new TrustRegistry(logger as never);

    reg.register("shared value", TrustLevel.EXTERNAL, "source-a");
    reg.register("shared value", TrustLevel.SYSTEM, "source-b");

    expect(warnings).toHaveLength(1);
    expect(warnings[0]![0]).toContain("re-registration conflict");
    expect(warnings[0]![1]).toMatchObject({
      existingTrust: TrustLevel.EXTERNAL,
      existingSource: "source-a",
      attemptedTrust: TrustLevel.SYSTEM,
      attemptedSource: "source-b",
    });
  });

  it("should not log when re-registering the same value with identical trust and source", () => {
    const warnings: Array<unknown> = [];
    const logger = { warn: (...args: unknown[]) => warnings.push(args) };
    const reg = new TrustRegistry(logger as never);

    reg.register("shared value", TrustLevel.TOOL, "source-a");
    reg.register("shared value", TrustLevel.TOOL, "source-a");

    expect(warnings).toHaveLength(0);
  });
});
