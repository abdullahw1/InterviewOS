export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number | null;
}

interface SlidingWindowEntry {
  timestamps: number[];
}

export class RateLimiter {
  private windows: Map<string, SlidingWindowEntry> = new Map();
  private config: RateLimitConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;
    // Run cleanup every 60 seconds to remove expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
    // Allow the timer to not block process exit
    if (this.cleanupInterval && typeof this.cleanupInterval === 'object' && 'unref' in this.cleanupInterval) {
      this.cleanupInterval.unref();
    }
  }

  check(key: string): RateLimitResult {
    try {
      const now = Date.now();
      const windowStart = now - this.config.windowMs;

      let entry = this.windows.get(key);
      if (!entry) {
        entry = { timestamps: [] };
        this.windows.set(key, entry);
      }

      // Filter to only timestamps within the current window
      entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

      if (entry.timestamps.length < this.config.maxRequests) {
        // Allowed — record this request
        entry.timestamps.push(now);
        return {
          allowed: true,
          remaining: this.config.maxRequests - entry.timestamps.length,
          retryAfterMs: null,
        };
      }

      // Rejected — calculate when the oldest request in the window expires
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + this.config.windowMs - now;

      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(retryAfterMs, 1),
      };
    } catch {
      // Fail open: if anything goes wrong, allow the request
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        retryAfterMs: null,
      };
    }
  }

  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [key, entry] of this.windows.entries()) {
      entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);
      if (entry.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Pre-configured instances
export const apiRateLimiter = new RateLimiter({ maxRequests: 30, windowMs: 60_000 });
export const authRateLimiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });
