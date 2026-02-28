import { Injectable, Inject, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FastPathChecker } from './pipeline/fast-path.checker';
import { EmbeddingFetcher } from './pipeline/embedding.fetcher';
import { CandidateRetriever } from './pipeline/candidate.retriever';
import { ScoringEngine } from './pipeline/scoring.engine';
import { ScoreAggregator } from './pipeline/score.aggregator';
import { MatchClassifier } from './pipeline/match.classifier';
import { BatchProcessor } from './pipeline/batch.processor';
import type { ICacheProvider } from '../common/ports/cache-provider.port';
import type { IAuditLogger } from '../common/ports/audit-logger.port';
import type { IEntityRepository } from '../common/ports/entity-repository.port';
import { INJECTION_TOKENS } from '../common/tokens/injection-tokens';
import type { ResolveRequest, ResolveResult, BatchResolveResult, CandidateScore } from '../common/models/resolution.model';
import type { Profile } from '../common/models/profile.model';
import { RESOLUTION_CONSTANTS } from '../common/constants/resolution.constants';
import { buildCacheKey, buildAuditEvent } from './resolution.helpers';

/**
 * ResolutionService is the primary orchestrator of the resolution pipeline.
 *
 * Pipeline stages (in order):
 *  1. CacheOrchestrator.get()        → return cached result if available
 *  2. FastPathChecker.check()        → fast SQL lookup for EXACT high-weight fields
 *  3. EmbeddingFetcher.fetch()       → generate embeddings for SEMANTIC/HYBRID fields
 *  4. CandidateRetriever.get()       → ANN retrieval or full scan
 *  5. ScoringEngine.scoreAll()       → apply per-field strategies in-process
 *  6. ScoreAggregator.aggregate()    → composite score per candidate
 *  7. MatchClassifier.classify()     → assign MatchType from score signals
 *  8. [if miss + createIfMissing]    → EntityRepository.upsert()
 *  9. CacheOrchestrator.set()        → write result to cache (async)
 * 10. AuditService.log()             → fire-and-forget audit write
 */
@Injectable()
export class ResolutionService {
  private readonly logger = new Logger(ResolutionService.name);

  constructor(
    private readonly fastPathChecker: FastPathChecker,
    private readonly embeddingFetcher: EmbeddingFetcher,
    private readonly candidateRetriever: CandidateRetriever,
    private readonly scoringEngine: ScoringEngine,
    private readonly scoreAggregator: ScoreAggregator,
    private readonly matchClassifier: MatchClassifier,
    private readonly batchProcessor: BatchProcessor,
    @Inject(INJECTION_TOKENS.CACHE_PROVIDER)
    private readonly cacheProvider: ICacheProvider,
    @Inject(INJECTION_TOKENS.AUDIT_LOGGER)
    private readonly auditLogger: IAuditLogger,
    @Inject(INJECTION_TOKENS.ENTITY_REPOSITORY)
    private readonly entityRepository: IEntityRepository,
  ) {}

  /**
   * Resolves a single entity against the given profile.
   * @param request - The resolution request.
   * @param profile - The loaded profile (pre-fetched by controller).
   * @returns The resolution result.
   */
  async resolve(request: ResolveRequest, profile: Profile): Promise<ResolveResult> {
    const startTime = Date.now();
    const threshold = request.threshold ?? profile.defaultThreshold;
    const cacheKey = buildCacheKey(profile.id, request.fields, threshold);

    // Stage 1: Cache lookup
    const cached = await this.cacheProvider.get<ResolveResult>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for request ${request.requestId}`);
      return { ...cached, wasCached: true, requestId: request.requestId };
    }

    // Stage 2: Fast-path check
    const fastPathResult = await this.fastPathChecker.check(profile, request.fields);
    if (fastPathResult) {
      return this.finaliseResult(
        request, profile, fastPathResult, threshold, startTime, cacheKey,
      );
    }

    // Stage 3: Generate input embeddings for SEMANTIC/HYBRID fields
    const inputEmbeddings = await this.embeddingFetcher.fetchInputEmbeddings(
      request.fields,
      profile.semanticFields,
    );

    // Stage 4: Retrieve candidates
    const candidates = await this.candidateRetriever.getCandidates(
      profile, request.fields, inputEmbeddings,
    );

    if (candidates.length === 0) {
      return this.handleNoMatch(request, profile, threshold, startTime, cacheKey);
    }

    // Stages 5–7: Score all candidates, aggregate, classify
    const topCandidate = await this.scoreAndRankCandidates(
      candidates, profile, request.fields, inputEmbeddings,
    );

    return this.finaliseResult(
      request, profile, topCandidate, threshold, startTime, cacheKey,
    );
  }

  /**
   * Resolves a batch of entities concurrently using Promise.allSettled.
   * @param requests - Array of resolve requests.
   * @param profile - The loaded profile.
   */
  async resolveBatch(
    requests: ResolveRequest[],
    profile: Profile,
  ): Promise<BatchResolveResult> {
    return this.batchProcessor.processAll(
      requests,
      (req) => this.resolve(req, profile),
    );
  }

  /**
   * Finds all entities similar to the given fields above the threshold.
   * Unlike resolve(), this never creates entities and returns the full ranked list.
   * @param request - Resolution request (createIfMissing is ignored).
   * @param profile - The loaded profile.
   * @param limit - Maximum number of similar entities to return.
   * @returns Ranked array of candidate scores above threshold.
   */
  async findSimilar(
    request: ResolveRequest,
    profile: Profile,
    limit: number,
  ): Promise<CandidateScore[]> {
    const threshold = request.threshold ?? profile.defaultThreshold;

    const inputEmbeddings = await this.embeddingFetcher.fetchInputEmbeddings(
      request.fields,
      profile.semanticFields,
    );

    const candidates = await this.candidateRetriever.getCandidates(
      profile, request.fields, inputEmbeddings,
    );

    if (candidates.length === 0) return [];

    const scoredCandidates = await Promise.all(
      candidates.map(async (candidate) => {
        const fieldScores = await this.scoringEngine.scoreCandidate(
          candidate, profile, request.fields, inputEmbeddings,
        );
        return this.scoreAggregator.aggregate(candidate, fieldScores, profile);
      }),
    );

    return scoredCandidates
      .filter((c) => c.compositeScore >= threshold)
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, limit);
  }

  private async scoreAndRankCandidates(
    candidates: Awaited<ReturnType<CandidateRetriever['getCandidates']>>,
    profile: Profile,
    inputFields: Record<string, string>,
    inputEmbeddings: Map<string, Float32Array>,
  ): Promise<CandidateScore | null> {
    const scoredCandidates = await Promise.all(
      candidates.map(async (candidate) => {
        const fieldScores = await this.scoringEngine.scoreCandidate(
          candidate, profile, inputFields, inputEmbeddings,
        );
        return this.scoreAggregator.aggregate(candidate, fieldScores, profile);
      }),
    );

    if (scoredCandidates.length === 0) return null;

    scoredCandidates.sort((a, b) => b.compositeScore - a.compositeScore);
    return scoredCandidates[0];
  }

  private async finaliseResult(
    request: ResolveRequest,
    profile: Profile,
    candidateScore: CandidateScore | null,
    threshold: number,
    startTime: number,
    cacheKey: string,
  ): Promise<ResolveResult> {
    const matchType = this.matchClassifier.classify(candidateScore, threshold);
    const isNewEntity = matchType === 'NEW_ENTITY';
    const executionMs = Date.now() - startTime;

    let entityId: string | undefined = isNewEntity ? undefined : candidateScore?.entityId;

    if (isNewEntity && request.createIfMissing) {
      const newEntity = await this.entityRepository.upsert({
        profileId: profile.id,
        displayName: this.deriveDisplayName(request.fields, profile),
        fieldValues: request.fields,
        externalId: undefined,
        sourceSystem: request.sourceSystem,
      });
      entityId = newEntity.entityId;
    }

    const result: ResolveResult = {
      requestId: request.requestId,
      entityId,
      displayName: candidateScore?.displayName,
      matchScore: isNewEntity ? undefined : candidateScore?.compositeScore,
      matchType,
      fieldScores: candidateScore?.fieldScores ?? [],
      isNewEntity,
      isAuthoritative: false,
      wasCached: false,
      executionMs,
      resolvedAt: new Date(),
    };

    // Stage 9: Write to cache (non-blocking)
    void this.cacheProvider.set(cacheKey, result, RESOLUTION_CONSTANTS.DEFAULT_CACHE_TTL_SECONDS);

    // Stage 10: Fire-and-forget audit log
    void this.auditLogger.logResolution(
      buildAuditEvent(request, profile, result, threshold),
    );

    return result;
  }

  private async handleNoMatch(
    request: ResolveRequest,
    profile: Profile,
    threshold: number,
    startTime: number,
    cacheKey: string,
  ): Promise<ResolveResult> {
    return this.finaliseResult(request, profile, null, threshold, startTime, cacheKey);
  }

  private deriveDisplayName(
    fields: Record<string, string>,
    profile: Profile,
  ): string {
    const primaryField = profile.fields.find((f) => f.isPrimaryDisplay);
    if (primaryField && fields[primaryField.fieldName]) {
      return fields[primaryField.fieldName];
    }
    return Object.values(fields)[0] ?? 'Unknown';
  }
}
