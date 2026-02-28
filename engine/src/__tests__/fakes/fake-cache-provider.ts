import type { ICacheProvider } from '../../common/ports/cache-provider.port';
import { RESOLUTION_CONSTANTS } from '../../common/constants/resolution.constants';

/** In-memory cache entry with optional TTL. */
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * In-memory ICacheProvider for tests.
 * Supports TTL expiry, prefix-based deletion, and flush.
 * No Redis connection required.
 */
export class FakeCacheProvider implements ICacheProvider {
  private readonly store = new Map<string, CacheEntry>();

  /** Tracks set() calls for assertion in tests. */
  readonly setCalls: Array<{ key: string; ttlSeconds: number }> = [];

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    this.setCalls.push({ key, ttlSeconds });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deleteByProfile(profileId: string): Promise<void> {
    const prefix = `${RESOLUTION_CONSTANTS.CACHE_KEY_PREFIX}:${profileId}`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  async flush(): Promise<void> {
    this.store.clear();
    this.setCalls.length = 0;
  }

  /** Returns the number of entries currently in the cache. */
  size(): number {
    return this.store.size;
  }
}
