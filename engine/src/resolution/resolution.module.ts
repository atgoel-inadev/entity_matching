import { Module } from '@nestjs/common';
import { ResolutionService } from './resolution.service';
import { ResolutionController } from './resolution.controller';
import { FastPathChecker } from './pipeline/fast-path.checker';
import { EmbeddingFetcher } from './pipeline/embedding.fetcher';
import { CandidateRetriever } from './pipeline/candidate.retriever';
import { ScoringEngine } from './pipeline/scoring.engine';
import { ScoreAggregator } from './pipeline/score.aggregator';
import { MatchClassifier } from './pipeline/match.classifier';
import { BatchProcessor } from './pipeline/batch.processor';
import { StrategiesModule } from '../strategies/strategies.module';
import { SnowflakeModule } from '../snowflake/snowflake.module';
import { CacheModule } from '../cache/cache.module';
import { ProfilesModule } from '../profiles/profiles.module';

/**
 * ResolutionModule wires the complete resolution pipeline.
 *
 * Imports:
 *  - StrategiesModule: provides StrategyRegistry to ScoringEngine
 *  - SnowflakeModule: provides ENTITY_REPOSITORY, EMBEDDING_PROVIDER, AUDIT_LOGGER tokens
 *  - CacheModule: provides CACHE_PROVIDER token
 *  - ProfilesModule: provides ProfilesService to ResolutionController
 */
@Module({
  imports: [StrategiesModule, SnowflakeModule, CacheModule, ProfilesModule],
  providers: [
    FastPathChecker,
    EmbeddingFetcher,
    CandidateRetriever,
    ScoringEngine,
    ScoreAggregator,
    MatchClassifier,
    BatchProcessor,
    ResolutionService,
  ],
  controllers: [ResolutionController],
  exports: [ResolutionService],
})
export class ResolutionModule {}
