import { describe, expect, it } from "vitest";
import { assertSafeBindHost, isLoopbackHost } from "../src/bind";

describe("hook server bind safety", () => {
  it("recognizes loopback addresses only", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("127.4.5.6")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.4")).toBe(false);
  });

  it("requires auth before binding outside loopback", () => {
    expect(() => assertSafeBindHost("0.0.0.0")).toThrow(/WARDEN_AUTH_TOKEN is required/i);
    expect(() => assertSafeBindHost("0.0.0.0", "secret")).not.toThrow();
    expect(() => assertSafeBindHost("127.0.0.1")).not.toThrow();
  });
});
