import { Module } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { ProfilesController } from './profiles.controller';
import { SnowflakeModule } from '../snowflake/snowflake.module';
import { CacheModule } from '../cache/cache.module';

/**
 * ProfilesModule manages resolution profile configuration.
 * Exports ProfilesService so ResolutionModule's controller can use it.
 */
@Module({
  imports: [SnowflakeModule, CacheModule],
  providers: [ProfilesService],
  controllers: [ProfilesController],
  exports: [ProfilesService],
})
export class ProfilesModule {}
