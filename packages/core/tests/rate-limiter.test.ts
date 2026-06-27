import { describe, it, expect, beforeEach } from "vitest";
import { SlidingWindowRateLimiter } from "../src/rate-limiter";
import type { RateLimiterConfig } from "../src/rate-limiter";

describe("SlidingWindowRateLimiter", () => {
  const defaultConfig: RateLimiterConfig = {
    maxCalls: 5,
    windowMs: 60_000,
  };

  let limiter: SlidingWindowRateLimiter;

  beforeEach(() => {
    limiter = new SlidingWindowRateLimiter({ ...defaultConfig });
  });

  describe("basic sliding window", () => {
    it("should allow calls up to the limit", () => {
      for (let i = 0; i < 5; i++) {
        const result = limiter.check("global");
        expect(result.allowed).toBe(true);
      }
    });

    it("should deny calls beyond the limit", () => {
      for (let i = 0; i < 5; i++) {
        limiter.check("global");
      }
      const result = limiter.check("global");
      expect(result.allowed).toBe(false);
    });

    it("should return retryAfterMs when denied", () => {
      for (let i = 0; i < 5; i++) {
        limiter.check("global");
      }
      const result = limiter.check("global");
      expect(result.allowed).toBe(false);
      expect(typeof result.retryAfterMs).toBe("number");
      expect(result.retryAfterMs!).toBeGreaterThanOrEqual(0);
    });
  });

  describe("independent keys", () => {
    it("should have separate windows for different keys", () => {
      // Exhaust key-A
      for (let i = 0; i < 5; i++) {
        limiter.check("tool:keyA");
      }
      expect(limiter.check("tool:keyA").allowed).toBe(false);

      // Key-B should still be allowed
      expect(limiter.check("tool:keyB").allowed).toBe(true);
    });

    it("should not bleed between keys", () => {
      limiter.check("tool:read_file");
      limiter.check("tool:read_file");
      limiter.check("tool:read_file");

      // write_file should start from 0
      limiter.check("tool:write_file");
      limiter.check("tool:write_file");

      expect(limiter.activeCount("tool:read_file")).toBe(3);
      expect(limiter.activeCount("tool:write_file")).toBe(2);
    });
  });

  describe("per-tool limits", () => {
    it("should use per-tool override when configured", () => {
      const toolLimiter = new SlidingWindowRateLimiter({
        maxCalls: 100,
        windowMs: 60_000,
        perToolLimits: {
          write_file: { maxCalls: 2, windowMs: 60_000 },
        },
      });

      // Per-tool limit is 2 for write_file
      toolLimiter.check("tool:write_file");
      toolLimiter.check("tool:write_file");
      expect(toolLimiter.check("tool:write_file").allowed).toBe(false);

      // read_file should use global limit (100)
      for (let i = 0; i < 10; i++) {
        expect(toolLimiter.check("tool:read_file").allowed).toBe(true);
      }
    });

    it("should fall back to global when tool has no override", () => {
      const toolLimiter = new SlidingWindowRateLimiter({
        maxCalls: 3,
        windowMs: 60_000,
        perToolLimits: {
          shell: { maxCalls: 1, windowMs: 60_000 },
        },
      });

      // shell uses per-tool limit of 1
      toolLimiter.check("tool:shell");
      expect(toolLimiter.check("tool:shell").allowed).toBe(false);

      // unknown_tool uses global limit of 3
      for (let i = 0; i < 3; i++) {
        expect(toolLimiter.check("tool:unknown_tool").allowed).toBe(true);
      }
      expect(toolLimiter.check("tool:unknown_tool").allowed).toBe(false);
    });

    it("should respect per-tool windowMs independent of global", () => {
      const toolLimiter = new SlidingWindowRateLimiter({
        maxCalls: 5,
        windowMs: 60_000,
        perToolLimits: {
          bursty: { maxCalls: 3, windowMs: 1 }, // essentially tight window
        },
      });

      // First 3 within the 1ms window should be allowed
      toolLimiter.check("tool:bursty");
      toolLimiter.check("tool:bursty");
      toolLimiter.check("tool:bursty");

      // 4th call within the same ms tick — denied
      const denied = toolLimiter.check("tool:bursty");
      expect(denied.allowed).toBe(false);
    });
  });

  describe("window expiry", () => {
    it("should not count calls outside the window", async () => {
      const shortLimiter = new SlidingWindowRateLimiter({
        maxCalls: 2,
        windowMs: 100, // very short window
      });

      shortLimiter.check("tool:expire-test");
      shortLimiter.check("tool:expire-test");

      // Wait for window to expire
      await new Promise((r) => setTimeout(r, 150));

      // After expiry, calls should be allowed again
      const result = shortLimiter.check("tool:expire-test");
      expect(result.allowed).toBe(true);
    });

    it("should allow calls at the boundary after expiry", async () => {
      const shortLimiter = new SlidingWindowRateLimiter({
        maxCalls: 1,
        windowMs: 50,
      });

      shortLimiter.check("tool:boundary");
      expect(shortLimiter.check("tool:boundary").allowed).toBe(false);

      await new Promise((r) => setTimeout(r, 60));

      // Window expired, should be allowed now
      expect(shortLimiter.check("tool:boundary").allowed).toBe(true);
    });
  });

  describe("reset()", () => {
    it("should clear a specific key's window", () => {
      limiter.check("tool:keep");
      limiter.check("tool:keep");

      // Exhaust the reset key
      for (let i = 0; i < 5; i++) {
        limiter.check("tool:to-reset");
      }
      expect(limiter.check("tool:to-reset").allowed).toBe(false);

      limiter.reset("tool:to-reset");

      // After reset, calls should be allowed again
      expect(limiter.check("tool:to-reset").allowed).toBe(true);

      // Other keys should be unaffected
      expect(limiter.activeCount("tool:keep")).toBe(2);
    });

    it("should clear all windows when called with no argument", () => {
      for (let i = 0; i < 5; i++) {
        limiter.check("tool:a");
      }
      limiter.check("tool:b");
      limiter.check("tool:b");

      limiter.reset();

      // All windows should be empty
      expect(limiter.activeCount("tool:a")).toBe(0);
      expect(limiter.activeCount("tool:b")).toBe(0);

      // All keys should be allowed fresh
      expect(limiter.check("tool:a").allowed).toBe(true);
      expect(limiter.check("tool:b").allowed).toBe(true);
    });

    it("should be a no-op for an unknown key", () => {
      limiter.check("tool:exists");
      limiter.reset("tool:nonexistent");
      expect(limiter.activeCount("tool:exists")).toBe(1);
    });
  });

  describe("record()", () => {
    it("should count against the window", () => {
      for (let i = 0; i < 4; i++) {
        limiter.record("tool:record-test");
      }

      // One more should be allowed (limit is 5)
      expect(limiter.check("tool:record-test").allowed).toBe(true);

      // But now we are at exactly 5, so next should deny
      expect(limiter.check("tool:record-test").allowed).toBe(false);
    });

    it("should increment without performing a check", () => {
      // record() does not return a result — it just adds a timestamp
      limiter.record("tool:no-check");
      limiter.record("tool:no-check");

      expect(limiter.activeCount("tool:no-check")).toBe(2);

      // check() will then see both recorded timestamps
      limiter.check("tool:no-check");
      limiter.check("tool:no-check");
      limiter.check("tool:no-check");
      // That's 5 total (2 recorded + 3 checked)
      expect(limiter.check("tool:no-check").allowed).toBe(false);
    });
  });

  describe("activeCount()", () => {
    it("should return 0 for an untouched key", () => {
      expect(limiter.activeCount("tool:untouched")).toBe(0);
    });

    it("should return the correct count after calls", () => {
      limiter.check("tool:counted");
      limiter.check("tool:counted");
      limiter.check("tool:counted");
      expect(limiter.activeCount("tool:counted")).toBe(3);
    });

    it("should not count expired timestamps", async () => {
      const shortLimiter = new SlidingWindowRateLimiter({
        maxCalls: 10,
        windowMs: 50,
      });

      shortLimiter.check("tool:short-lived");
      shortLimiter.check("tool:short-lived");
      expect(shortLimiter.activeCount("tool:short-lived")).toBe(2);

      await new Promise((r) => setTimeout(r, 60));

      // After window expiry, activeCount should reflect eviction
      expect(shortLimiter.activeCount("tool:short-lived")).toBe(0);
    });
  });
});
