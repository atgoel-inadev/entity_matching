import { Module } from '@nestjs/common';
import { EntitiesService } from './entities.service';
import { EntitiesController } from './entities.controller';
import { SnowflakeModule } from '../snowflake/snowflake.module';
import { ProfilesModule } from '../profiles/profiles.module';

/**
 * EntitiesModule manages entity lifecycle (bulk load, list, delete).
 */
@Module({
  imports: [SnowflakeModule, ProfilesModule],
  providers: [EntitiesService],
  controllers: [EntitiesController],
  exports: [EntitiesService],
})
export class EntitiesModule {}
