/** Configuration for the sliding window rate limiter. */
export interface RateLimiterConfig {
  /** Max calls in the window */
  maxCalls: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Optional: per-tool limits override the global limit */
  perToolLimits?: Record<string, { maxCalls: number; windowMs: number }>;
}

/** Result of a rate-limit check. */
export interface RateLimitResult {
  /** True if the call is allowed */
  allowed: boolean;
  /** If denied, milliseconds until next allowed call */
  retryAfterMs?: number;
}

/**
 * Sliding window log rate limiter.
 *
 * Tracks per-key timestamp arrays. On each `check()`, evicts expired
 * timestamps, then compares the remaining count against the limit.
 *
 * Key formats:
 *   - "global"           → global limit
 *   - "tool:read_file"   → per-tool limit (looked up in `perToolLimits`)
 */
export class SlidingWindowRateLimiter {
  private windows: Map<string, number[]> = new Map();

  constructor(private config: RateLimiterConfig) {}

  /**
   * Check whether a call identified by `key` is allowed.
   *
   * The key convention is:
   *   "global"            → uses config.maxCalls / config.windowMs
   *   "tool:<toolName>"   → looks up perToolLimits, falls back to global
   *   anything else       → uses global limits
   */
  check(key: string): RateLimitResult {
    const { maxCalls, windowMs } = this.resolveLimits(key);
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = this.windows.get(key) ?? [];

    // Evict expired timestamps
    timestamps = timestamps.filter((t) => t > cutoff);

    if (timestamps.length >= maxCalls) {
      const oldestInWindow = timestamps[0];
      const retryAfterMs = oldestInWindow - cutoff;
      this.windows.set(key, timestamps);
      return { allowed: false, retryAfterMs };
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return { allowed: true };
  }

  /**
   * Record a call against `key` without performing a limit check.
   * Useful when call counting happens in a different path than the check.
   */
  record(key: string): void {
    const now = Date.now();
    let timestamps = this.windows.get(key) ?? [];
    timestamps.push(now);
    this.windows.set(key, timestamps);
  }

  /**
   * Reset tracked timestamps.
   * - If `key` is provided, clears only that key's window.
   * - If `key` is omitted, clears all windows.
   */
  reset(key?: string): void {
    if (key !== undefined) {
      this.windows.delete(key);
    } else {
      this.windows.clear();
    }
  }

  /**
   * Return the current count of active timestamps for a given key
   * (timestamps still within the window).
   */
  activeCount(key: string): number {
    const { windowMs } = this.resolveLimits(key);
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = this.windows.get(key) ?? [];
    return timestamps.filter((t) => t > cutoff).length;
  }

  // ─── private helpers ────────────────────────────────────────

  /**
   * Resolve maxCalls / windowMs for a key.
   *
   * - "tool:<toolName>" → check perToolLimits[toolName] first, fall back to global.
   * - anything else → global.
   */
  private resolveLimits(
    key: string,
  ): { maxCalls: number; windowMs: number } {
    if (key.startsWith("tool:")) {
      const toolName = key.slice(5);
      const override = this.config.perToolLimits?.[toolName];
      if (override) return override;
    }
    return { maxCalls: this.config.maxCalls, windowMs: this.config.windowMs };
  }
}
