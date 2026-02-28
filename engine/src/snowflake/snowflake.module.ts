import { Module } from '@nestjs/common';
import { SnowflakeService } from './snowflake.service';
import { SnowflakeEntityRepository } from './snowflake-entity.repository';
import { SnowflakeProfileRepository } from './snowflake-profile.repository';
import { SnowflakeCortexEmbeddingProvider } from './snowflake-embedding.provider';
import { SnowflakeAuditLogger } from './snowflake-audit.logger';
import { INJECTION_TOKENS } from '../common/tokens/injection-tokens';

/**
 * SnowflakeModule provides all infrastructure adapters that depend on Snowflake.
 *
 * Each adapter is exposed via its injection token, allowing other modules to depend
 * on the abstraction (IEntityRepository) rather than the concrete implementation.
 *
 * To swap to a different database: create new adapters and swap providers here.
 * No other module needs to change.
 */
@Module({
  providers: [
    SnowflakeService,
    {
      provide: INJECTION_TOKENS.ENTITY_REPOSITORY,
      useClass: SnowflakeEntityRepository,
    },
    {
      provide: INJECTION_TOKENS.PROFILE_REPOSITORY,
      useClass: SnowflakeProfileRepository,
    },
    {
      provide: INJECTION_TOKENS.EMBEDDING_PROVIDER,
      useClass: SnowflakeCortexEmbeddingProvider,
    },
    {
      provide: INJECTION_TOKENS.AUDIT_LOGGER,
      useClass: SnowflakeAuditLogger,
    },
  ],
  exports: [
    SnowflakeService,
    INJECTION_TOKENS.ENTITY_REPOSITORY,
    INJECTION_TOKENS.PROFILE_REPOSITORY,
    INJECTION_TOKENS.EMBEDDING_PROVIDER,
    INJECTION_TOKENS.AUDIT_LOGGER,
  ],
})
export class SnowflakeModule {}
