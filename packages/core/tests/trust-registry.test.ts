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
});
