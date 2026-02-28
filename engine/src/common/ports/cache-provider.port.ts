/**
 * Port interface for the layered cache system (L0: in-process LRU, L1: Redis).
 * The resolution pipeline uses this to cache resolve results and avoid
 * redundant Snowflake + embedding calls for repeated inputs.
 */
export interface ICacheProvider {
  /**
   * Retrieves a cached value by key.
   * @returns The typed value, or null if not found or expired.
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Stores a value with a TTL.
   * @param key - Cache key.
   * @param value - Value to store (will be JSON-serialised).
   * @param ttlSeconds - Time-to-live in seconds.
   */
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;

  /**
   * Removes a single key from all cache layers.
   */
  delete(key: string): Promise<void>;

  /**
   * Removes all cached entries for a profile (by key prefix).
   * Called when a profile's configuration changes or entities are updated.
   * @param profileId - Profile scope for key prefix matching.
   */
  deleteByProfile(profileId: string): Promise<void>;

  /**
   * Removes all cached entries from all layers.
   * Used by the global cache invalidation endpoint.
   */
  flush(): Promise<void>;
}
