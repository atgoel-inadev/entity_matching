import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ProfilesModule } from './profiles/profiles.module';
import { ResolutionModule } from './resolution/resolution.module';
import { EntitiesModule } from './entities/entities.module';
import { StrategiesModule } from './strategies/strategies.module';
import { SnowflakeModule } from './snowflake/snowflake.module';
import { CacheModule } from './cache/cache.module';
import { HealthModule } from './health/health.module';

/**
 * Root application module. Imports all feature modules and configures
 * global infrastructure (config, throttler).
 *
 * Module dependency order:
 *   SnowflakeModule → provides repository/embedding adapters
 *   CacheModule     → provides ICacheProvider adapter
 *   StrategiesModule → provides StrategyRegistry
 *   ProfilesModule  → depends on SnowflakeModule + CacheModule
 *   EntitiesModule  → depends on SnowflakeModule + CacheModule
 *   ResolutionModule → depends on all of the above
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 1000,
      },
    ]),
    SnowflakeModule,
    CacheModule,
    StrategiesModule,
    ProfilesModule,
    EntitiesModule,
    ResolutionModule,
    HealthModule,
  ],
})
export class AppModule {}
