import { Module } from '@nestjs/common';
import { InProcessLRUCacheService } from './lru-cache.service';
import { RedisCacheService } from './redis-cache.service';
import { LayeredCacheService } from './layered-cache.service';
import { INJECTION_TOKENS } from '../common/tokens/injection-tokens';

/**
 * CacheModule provides the layered cache system (L0: LRU, L1: Redis).
 *
 * Exports CACHE_PROVIDER token bound to LayeredCacheService.
 * Other modules consume ICacheProvider via the token, never the concrete class.
 */
@Module({
  providers: [
    InProcessLRUCacheService,
    RedisCacheService,
    LayeredCacheService,
    {
      provide: INJECTION_TOKENS.CACHE_PROVIDER,
      useClass: LayeredCacheService,
    },
  ],
  exports: [
    INJECTION_TOKENS.CACHE_PROVIDER,
    LayeredCacheService,
    RedisCacheService,
  ],
})
export class CacheModule {}
