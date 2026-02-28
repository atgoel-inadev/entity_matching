import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LRUCache } from 'lru-cache';

/** Cache entry shape stored in the LRU. */
interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/**
 * InProcessLRUCacheService provides L0 in-process caching using lru-cache.
 *
 * Characteristics:
 * - Instant reads (no network hop)
 * - Evicted on process restart
 * - Does not survive horizontal scaling (each process has its own LRU)
 * - Supplements Redis (L1), not replaces it
 */
@Injectable()
export class InProcessLRUCacheService {
  private readonly logger = new Logger(InProcessLRUCacheService.name);
  private readonly lru: LRUCache<string, CacheEntry<unknown>>;

  constructor(private readonly configService: ConfigService) {
    const maxSize = parseInt(this.configService.get<string>('LRU_MAX_RESULTS', '1000'), 10);
    this.lru = new LRUCache({ max: maxSize });
    this.logger.log(`LRU cache initialised with max=${maxSize} entries`);
  }

  /**
   * Retrieves a cached value, or null if absent or expired.
   * @param key - Cache key.
   */
  get<T>(key: string): T | null {
    const entry = this.lru.get(key) as CacheEntry<T> | undefined;

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.lru.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Stores a value with a TTL.
   * @param key - Cache key.
   * @param value - Value to store.
   * @param ttlSeconds - Time-to-live in seconds.
   */
  set<T>(key: string, value: T, ttlSeconds: number): void {
    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    this.lru.set(key, entry as CacheEntry<unknown>);
  }

  /**
   * Removes a single key.
   */
  delete(key: string): void {
    this.lru.delete(key);
  }

  /**
   * Removes all keys matching a prefix.
   * Used for profile-scoped cache invalidation.
   */
  deleteByPrefix(prefix: string): void {
    for (const key of this.lru.keys()) {
      if (key.startsWith(prefix)) {
        this.lru.delete(key);
      }
    }
  }

  /**
   * Clears all entries.
   */
  flush(): void {
    this.lru.clear();
    this.logger.log('LRU cache flushed');
  }
}
