// packages/core/cache.ts
//
// A lightweight, generic in-process TTL cache.
//
// Why not Redis?  This service runs as a single Node process backed by
// in-memory Maps (see ProductModel).  Adding a Redis round-trip would be
// slower than the work it avoids.  This cache gives the same semantics
// (TTL, invalidation by key or namespace) with zero network overhead.
//
// Usage:
//   import { Cache } from "../../core/cache";
//   const productCache = new Cache<Product>({ ttl: 5 * 60 * 1000 });
//   productCache.set("prod_001", product);
//   productCache.get("prod_001"); // Product | undefined
//   productCache.delete("prod_001");
//   productCache.clear();

import { logger } from "./logger";

export interface CacheOptions {
  /** Time-to-live in milliseconds.  Entries older than this are evicted. */
  ttl: number;
  /**
   * How often the eviction sweep runs.  Defaults to `ttl / 2`, minimum 30 s.
   * Pass 0 to disable automatic sweeps (manual eviction only).
   */
  sweepIntervalMs?: number;
  /** Human-readable name shown in log lines. */
  name?: string;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class Cache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly ttl: number;
  private readonly name: string;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: CacheOptions) {
    this.ttl  = options.ttl;
    this.name = options.name ?? "cache";

    const interval =
      options.sweepIntervalMs !== undefined
        ? options.sweepIntervalMs
        : Math.max(30_000, Math.floor(options.ttl / 2));

    if (interval > 0) {
      this.sweepTimer = setInterval(() => this._sweep(), interval);
      // Don't block process exit
      if (typeof this.sweepTimer.unref === "function") {
        this.sweepTimer.unref();
      }
    }
  }

  /** Return a cached value, or `undefined` if missing / expired. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Store a value.  Optionally override the instance-level TTL for this key. */
  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttl),
    });
  }

  /**
   * Return a cached value if present, otherwise call `loader`, cache the
   * result, and return it.  This is the primary API for hot read paths.
   */
  async getOrSet(key: string, loader: () => T | Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  }

  /** Remove a single key. */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Remove all keys whose name starts with `prefix`.
   * Useful for namespace-level invalidation, e.g. invalidating all
   * "products:list:*" entries when a product is created or updated.
   */
  deleteByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /** Evict all entries. */
  clear(): void {
    this.store.clear();
  }

  /** Number of live (non-expired) entries. */
  get size(): number {
    const now = Date.now();
    let count = 0;
    for (const entry of this.store.values()) {
      if (now <= entry.expiresAt) count++;
    }
    return count;
  }

  /** Stop the background sweep timer (call during graceful shutdown). */
  destroy(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private _sweep(): void {
    const now     = Date.now();
    let   removed = 0;

    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info("Cache sweep completed", {
        cache:   this.name,
        removed,
        remaining: this.store.size,
      });
    }
  }
}
