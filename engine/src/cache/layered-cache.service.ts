import { Injectable, Logger } from '@nestjs/common';
import type { ICacheProvider } from '../common/ports/cache-provider.port';
import { InProcessLRUCacheService } from './lru-cache.service';
import { RedisCacheService } from './redis-cache.service';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';

/**
 * LayeredCacheService implements ICacheProvider with a two-layer cache:
 *   L0: InProcessLRUCacheService (instant, per-process)
 *   L1: RedisCacheService (shared, survives restart)
 *
 * Read strategy (L0-first):
 *   1. Check L0 (LRU) — return if found
 *   2. Check L1 (Redis) — if found, populate L0 and return
 *   3. Cache miss — caller computes and calls set()
 *
 * Write strategy (write-through):
 *   - Writes to L0 immediately
 *   - Writes to L1 asynchronously (non-blocking)
 */
@Injectable()
export class LayeredCacheService implements ICacheProvider {
  private readonly logger = new Logger(LayeredCacheService.name);

  constructor(
    private readonly l0Cache: InProcessLRUCacheService,
    private readonly l1Cache: RedisCacheService,
  ) {}

  /**
   * Retrieves a value from the cache, checking L0 before L1.
   * On L1 hit, populates L0 for subsequent fast access.
   */
  async get<T>(key: string): Promise<T | null> {
    const l0Hit = this.l0Cache.get<T>(key);
    if (l0Hit !== null) return l0Hit;

    const l1Hit = await this.l1Cache.get<T>(key);

    if (l1Hit !== null) {
      this.l0Cache.set(key, l1Hit, RESOLUTION_CONSTANTS.DEFAULT_CACHE_TTL_SECONDS);
    }

    return l1Hit;
  }

  /**
   * Stores a value in both cache layers.
   * L1 write is non-blocking — does not affect response latency.
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.l0Cache.set(key, value, ttlSeconds);
    void this.l1Cache.set(key, value, ttlSeconds).catch((error) => {
      this.logger.warn(`L1 cache write failed for key ${key}`, error);
    });
  }

  /**
   * Removes a key from both cache layers.
   */
  async delete(key: string): Promise<void> {
    this.l0Cache.delete(key);
    await this.l1Cache.delete(key);
  }

  /**
   * Removes all cached entries for a profile (by key prefix).
   * Called on profile config changes or entity updates.
   */
  async deleteByProfile(profileId: string): Promise<void> {
    const prefix = `${RESOLUTION_CONSTANTS.CACHE_KEY_PREFIX}:${profileId}`;
    this.l0Cache.deleteByPrefix(prefix);
    const deleted = await this.l1Cache.deleteByPrefix(prefix);
    this.logger.log(`Invalidated ${deleted} cache entries for profile ${profileId}`);
  }

  /**
   * Flushes all entries from both cache layers.
   */
  async flush(): Promise<void> {
    this.l0Cache.flush();
    await this.l1Cache.flush();
    this.logger.warn('All cache layers flushed');
  }
}
