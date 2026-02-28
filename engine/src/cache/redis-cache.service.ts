import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheError } from '../common/errors/domain-errors';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';

/**
 * RedisCacheService provides L1 distributed caching using ioredis.
 *
 * Characteristics:
 * - Survives process restart
 * - Shared across all horizontally-scaled instances
 * - ~1ms network latency vs instant LRU reads
 * - Used as fallback when L0 LRU misses
 */
@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private redis!: Redis;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  /** Creates the Redis connection on module init. */
  async onModuleInit(): Promise<void> {
    const redisUrl = this.configService.get<string>(
      'REDIS_URL',
      'redis://localhost:6379/0',
    );

    try {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
        retryStrategy: () => null, // Don't retry failed connections
      });

      this.redis.on('error', (err) => {
        this.logger.warn('Redis connection error (non-fatal)', err);
        this.isConnected = false;
      });

      this.redis.on('connect', () => {
        this.isConnected = true;
        this.logger.log(`Redis connected: ${redisUrl}`);
      });

      await this.redis.ping();
      this.isConnected = true;
      this.logger.log(`Redis connected and verified: ${redisUrl}`);
    } catch (error) {
      this.isConnected = false;
      this.logger.warn(
        'Redis connection failed — continuing without L1 cache (degraded mode)',
        error,
      );
      // Application continues without Redis — L0 LRU cache will still work
    }
  }

  /** Disconnects from Redis on module destroy. */
  async onModuleDestroy(): Promise<void> {
    if (this.redis && this.isConnected) {
      try {
        await this.redis.quit();
        this.isConnected = false;
        this.logger.log('Redis disconnected');
      } catch (error) {
        this.logger.warn('Redis disconnect failed', error);
      }
    }
  }

  /**
   * Retrieves a cached value by key.
   * @returns The parsed value, or null if not found.
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isConnected) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (error) {
      this.logger.warn(`Redis GET failed for key ${key}`, error);
      return null; // Degrade gracefully — do not throw on cache miss
    }
  }

  /**
   * Stores a JSON-serialised value with a TTL.
   * @param key - Cache key.
   * @param value - Value to serialise and store.
   * @param ttlSeconds - Expiry in seconds.
   */
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (error) {
      this.logger.warn(`Redis SET failed for key ${key}`, error);
      // Non-fatal: a failed write means the next read will re-compute
    }
  }

  /**
   * Removes a single key.
   */
  async delete(key: string): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.warn(`Redis DELETE failed for key ${key}`, error);
    }
  }

  /**
   * Removes all keys matching a prefix pattern.
   * Uses SCAN to avoid blocking on large keyspaces.
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    if (!this.isConnected) return 0;
    try {
      const pattern = `${prefix}*`;
      let cursor = '0';
      let deleted = 0;

      do {
        const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;

        if (keys.length > 0) {
          await this.redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      return deleted;
    } catch (error) {
      this.logger.warn(`Redis DELETE by prefix failed for ${prefix}`, error);
      return 0;
    }
  }

  /**
   * Flushes the current Redis database.
   * USE WITH CAUTION — only for global cache invalidation endpoint.
   */
  async flush(): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.redis.flushdb();
      this.logger.warn('Redis FLUSHDB executed — all cached data cleared');
    } catch (error) {
      this.logger.warn('Redis FLUSH failed', error);
    }
  }
}
