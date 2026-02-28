import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SnowflakeModule } from '../snowflake/snowflake.module';
import { CacheModule } from '../cache/cache.module';

/**
 * HealthModule exposes the /health endpoint for system monitoring.
 */
@Module({
  imports: [SnowflakeModule, CacheModule],
  controllers: [HealthController],
})
export class HealthModule {}
